// A pool of workers which run the engine of sbmlsim-core: each worker (`worker.mjs`) holds a
// runtime of the loader (`loader.mjs`), so the simulations of a page run in parallel and off its
// main thread, with the bits of the main thread.
//
// Plain ECMAScript without dependencies and without APIs of Node, so it runs in browsers as well:
//
//   import { createPool } from "./pool.mjs";
//   const pool = await createPool({ engine, mathlib }); // WebAssembly.Modules or bytes
//   await pool.addModel("decay", modelWasm, modelJson);  // a Module or bytes; the text of
//                                                        // model.json or its object
//   const { columns, nRows, values } = await pool.simulate("decay", request, { signal });
//   pool.close();
//
// `engine.wasm`, `mathlib.wasm` and every model are compiled once, on the thread which creates
// the pool, and posted to the workers as `WebAssembly.Module`s, which a structured clone shares
// instead of copying (`js/test/workers.test.mjs`). The workers are created when the queue needs
// them, up to `workers`; a model is posted to a worker before the first request of it the worker
// runs, once per worker.
//
// The requests run in the order they were made (a FIFO queue), one at a time per worker. A
// request whose `signal` aborts is rejected with the reason of the signal: a queued one is
// dropped from the queue and never runs, a running one finishes in its worker (a simulation is
// one synchronous call of the engine) and its result is discarded. An error of the engine
// (`EngineError` of `loader.mjs`, e.g. an integration which fails) rejects only its request; a
// worker which crashes rejects the request it ran and is replaced by a new one. The values of a
// result are a `Float64Array` whose buffer the worker transfers, so nothing is copied twice.
//
// In a browser a worker is `new Worker(url, { type: "module" })`; `createWorker(url)` creates
// another, e.g. a worker thread of Node (`(url) => new Worker(url)` of `node:worker_threads`). A
// worker is anything with `postMessage(message, transfer)`, `terminate()` and either
// `addEventListener` (the events `message` and `error` of a Web Worker) or `on` (the events
// `message` and `error` of a worker thread, whose `message` gives the data itself).

import { EngineError, createRuntime } from "./loader.mjs";

/** The URL of the script of a worker, next to this module. */
export const WORKER_URL = new URL("./worker.mjs", import.meta.url);

/**
 * The number of workers of a pool without one: the logical processors but one (the main thread),
 * at least 1 and at most 8.
 */
export function defaultWorkers() {
  const cores = globalThis.navigator?.hardwareConcurrency ?? 2;
  return Math.max(1, Math.min(8, cores - 1));
}

/** The URLs of the module scripts which start a worker of another origin, by its script. */
const trampolines = new Map();

/**
 * A module worker of a browser.
 *
 * A browser starts a worker only from a script of the origin of the page, so a pool of a module
 * which a page loads from another origin (a CDN such as jsDelivr or unpkg, which allow the
 * requests of every origin) starts its workers from a module of the page's own (a `blob:` URL)
 * whose only line imports the script of the worker; the worker then runs in the global scope of
 * that module and imports the loader next to its script.
 */
function browserWorker(url) {
  if (typeof globalThis.Worker !== "function") {
    throw new Error("this host has no Web Workers: give the pool a createWorker");
  }
  const script = new URL(url, globalThis.location?.href);
  const origin = globalThis.location?.origin;
  if (origin === undefined || origin === "null" || script.origin === origin) {
    return new globalThis.Worker(script, { type: "module" });
  }
  let trampoline = trampolines.get(script.href);
  if (trampoline === undefined) {
    const source = `import ${JSON.stringify(script.href)};\n`;
    trampoline = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    trampolines.set(script.href, trampoline);
  }
  return new globalThis.Worker(trampoline, { type: "module" });
}

/** Listens to the messages and the errors of a Web Worker or of a worker thread of Node. */
function listen(worker, onMessage, onError) {
  if (typeof worker.on === "function") {
    worker.on("message", onMessage);
    worker.on("error", onError);
    worker.on("messageerror", onError);
  } else {
    worker.addEventListener("message", (event) => onMessage(event.data));
    worker.addEventListener("error", (event) => {
      event.preventDefault?.();
      onError(event.error ?? new Error(event.message ?? "the worker failed"));
    });
    worker.addEventListener("messageerror", () => onError(new Error("a message of the worker could not be read")));
  }
}

/** The error of a request which the worker answered with an error (see `worker.mjs`). */
function remoteError(fields) {
  if (fields.kind !== undefined && fields.name === "EngineError") {
    const error = new EngineError(fields.kind, fields.detail ?? fields.message, { flag: fields.flag, time: fields.time });
    if (fields.message) error.message = fields.message;
    return error;
  }
  const error = new Error(fields.message);
  if (fields.name) error.name = fields.name;
  return error;
}

/**
 * Creates a pool of workers. `engine` and `mathlib` are `WebAssembly.Module`s or their bytes,
 * checked and compiled here once; `workers` is the most workers (`defaultWorkers()` without),
 * `createWorker(url)` creates one (a module worker of the browser without), `workerUrl` is the
 * script of a worker (`WORKER_URL` without). Resolves to the pool, see the module comment.
 */
export async function createPool({
  engine,
  mathlib,
  workers = defaultWorkers(),
  createWorker = browserWorker,
  workerUrl = WORKER_URL,
}) {
  if (!Number.isInteger(workers) || workers < 1) {
    throw new Error(`a pool needs at least one worker, not ${workers}`);
  }
  const runtime = await createRuntime({ engine, mathlib });
  const models = new Map();
  const slots = [];
  const queue = [];
  let nextId = 1;
  let closed = false;

  /** Settles a job once; later answers of it are ignored. */
  const settle = (job, error, result) => {
    if (job.settled) return;
    job.settled = true;
    job.signal?.removeEventListener("abort", job.onAbort);
    if (error) job.reject(error);
    else job.resolve(result);
  };

  const spawn = () => {
    const slot = { worker: createWorker(workerUrl), models: new Set(), job: null, dead: false };
    listen(
      slot.worker,
      (message) => {
        const job = slot.job;
        if (!job || message?.id !== job.id) return;
        slot.job = null;
        if (message.type === "result") {
          settle(job, null, { columns: message.columns, nRows: message.nRows, values: message.values });
        } else {
          settle(job, remoteError(message.error ?? {}));
        }
        pump();
      },
      (error) => {
        // a worker which crashed: its request fails, the slot is replaced
        if (slot.dead) return;
        slot.dead = true;
        const index = slots.indexOf(slot);
        if (index >= 0) slots.splice(index, 1);
        slot.worker.terminate();
        if (slot.job) settle(slot.job, error instanceof Error ? error : new Error(String(error)));
        slot.job = null;
        pump();
      },
    );
    slot.worker.postMessage({ type: "init", ...runtime.modules });
    slots.push(slot);
    return slot;
  };

  /** Starts the queued jobs on the idle workers, creating workers up to the most. */
  const pump = () => {
    while (!closed && queue.length > 0) {
      const key = queue[0].key;
      const idle = slots.filter((slot) => !slot.job);
      const slot = idle.find((s) => s.models.has(key)) ?? idle[0] ?? (slots.length < workers ? spawn() : null);
      if (!slot) return;
      const job = queue.shift();
      if (!slot.models.has(job.key)) {
        const { module, description } = models.get(job.key);
        slot.worker.postMessage({ type: "model", key: job.key, module, description });
        slot.models.add(job.key);
      }
      slot.job = job;
      slot.worker.postMessage({ type: "simulate", id: job.id, key: job.key, request: job.request });
    }
  };

  return {
    /** The most workers of the pool. */
    size: workers,

    /** The compiled modules of the runtime. */
    modules: runtime.modules,

    /**
     * Adds a model under a key: `model` is a `WebAssembly.Module` or the bytes of `model.wasm`
     * (compiled here once), `description` the text of `model.json` or its object. A Promise;
     * a key which exists already is refused.
     */
    async addModel(key, model, description) {
      if (closed) throw new Error("the pool is closed");
      if (models.has(key)) throw new Error(`the pool has a model ${key} already`);
      const text = typeof description === "string" ? description : JSON.stringify(description);
      const module = model instanceof WebAssembly.Module ? model : await WebAssembly.compile(model);
      if (models.has(key)) throw new Error(`the pool has a model ${key} already`);
      models.set(key, { module, description: text });
    },

    /** Whether the pool has a model under a key. */
    hasModel(key) {
      return models.has(key);
    },

    /**
     * Simulates a request of `simulation/1` (an object or its JSON text) on the model `key` in
     * a worker; resolves to `{ columns, nRows, values }` as `instance.simulate` of the loader,
     * the values a `Float64Array`. `signal` (an `AbortSignal`) drops the request, see the module
     * comment.
     */
    simulate(key, request, { signal } = {}) {
      return new Promise((resolve, reject) => {
        if (closed) throw new Error("the pool is closed");
        if (!models.has(key)) throw new Error(`the pool has no model ${key}`);
        signal?.throwIfAborted();
        const job = { id: nextId++, key, request, signal, resolve, reject, settled: false };
        job.onAbort = () => {
          const index = queue.indexOf(job);
          if (index >= 0) queue.splice(index, 1);
          settle(job, signal.reason);
        };
        signal?.addEventListener("abort", job.onAbort, { once: true });
        queue.push(job);
        pump();
      });
    },

    /**
     * Terminates the workers; every queued and running request is rejected, and the pool takes
     * no more.
     */
    close() {
      if (closed) return;
      closed = true;
      const error = new Error("the pool is closed");
      for (const job of queue.splice(0)) settle(job, error);
      for (const slot of slots.splice(0)) {
        slot.dead = true;
        slot.worker.terminate();
        if (slot.job) settle(slot.job, error);
      }
    },
  };
}
