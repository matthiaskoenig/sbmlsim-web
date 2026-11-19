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
// runs, until its retained instance is evicted by maxWorkerModels.
//
// The requests run in the order they were made (a FIFO queue), one at a time per worker. A
// request whose `signal` aborts is rejected with the reason of the signal: a queued one is
// dropped from the queue and never runs. A running one discards its result, or is terminated
// when hardAbort is enabled. Dispatched work has a 30-second deadline by default (0 disables). An error of the engine
// (`EngineError` of `loader.mjs`, e.g. an integration which fails) rejects only its request; a
// worker which crashes rejects the request it ran and is replaced by a new one. The values of a
// result are a `Float64Array` whose buffer the worker transfers, so nothing is copied twice.
//
// In a browser a worker is `new Worker(url, { type: "module" })`; `createWorker(url)` creates
// another, e.g. a worker thread of Node (`(url) => new Worker(url)` of `node:worker_threads`). A
// worker is anything with `postMessage(message, transfer)`, `terminate()` and either
// `addEventListener` (the events `message` and `error` of a Web Worker) or `on` (the events
// `message` and `error` of a worker thread, whose `message` gives the data itself).

import { EngineError, createRuntime, validateModelBytes, MAX_MEMORY_PAGES, ENGINE_SECTION } from "./loader.mjs";

const poolPlanStates = new WeakMap();
const preparedJob = Symbol("prepared job");

/** Opaque pool request, invalidated by close or model removal. */
export class PreparedPoolSimulation {
  constructor(token, state) {
    if (token !== poolPlanStates) throw new TypeError("use pool.prepare()");
    poolPlanStates.set(this, state);
  }
  get nValues() { return poolPlanStates.get(this).nValues; }
  close() { poolPlanStates.get(this).close(); }
}

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
    worker.on("exit", (code) => onError(new Error(`the worker exited (${code})`)));
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
  if (fields.kind !== undefined && ["EngineError", "UnsupportedError"].includes(fields.name)) {
    const error = new EngineError(fields.kind, fields.detail ?? fields.message, { flag: fields.flag, time: fields.time });
    if (fields.message) error.message = fields.message;
    error.name = fields.name;
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
  maxWorkers = 32,
  maxQueuedJobs = 1024,
  maxQueuedBytes = 64 * 2 ** 20,
  maxModelBytes = 128 * 2 ** 20,
  maxModels = 128,
  maxWorkerModels = 8,
  maxMemoryPages,
  maxTotalMemoryBytes = 2 ** 31,
  maxModuleBytes = 32 * 2 ** 20,
  maxDescriptionBytes = 16 * 2 ** 20,
  maxRequestBytes = 16 * 2 ** 20,
  deadlineMs = 30000,
  hardAbort = false,
}) {
  if (!Number.isInteger(workers) || workers < 1) {
    throw new Error(`a pool needs at least one worker, not ${workers}`);
  }
  for (const [name, value] of Object.entries({ maxWorkers, maxQueuedJobs, maxQueuedBytes, maxModelBytes, maxModels, maxWorkerModels, maxTotalMemoryBytes, maxModuleBytes, maxDescriptionBytes, maxRequestBytes })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer`);
  }
  if (workers > maxWorkers) throw new Error(`workers exceeds maxWorkers (${maxWorkers})`);
  const checkDeadline = (value) => {
    if (!Number.isFinite(value) || value < 0 || value > 2147483647) throw new Error("deadlineMs must be between 0 and 2147483647");
  };
  checkDeadline(deadlineMs);
  const checkModuleSize = (module) => {
    if (!(module instanceof WebAssembly.Module) && module?.byteLength > maxModuleBytes) {
      throw new Error(`module exceeds maxModuleBytes (${maxModuleBytes})`);
    }
  };
  checkModuleSize(engine);
  checkModuleSize(mathlib);
  const runtime = await createRuntime({ engine, mathlib, maxMemoryPages });
  const retained = workers * Math.min(maxWorkerModels, maxModels);
  const aggregatePages = Math.floor(maxTotalMemoryBytes / 65536 / retained);
  const sections = WebAssembly.Module.customSections(runtime.modules.engine, ENGINE_SECTION);
  const minimum = JSON.parse(new TextDecoder().decode(sections[0])).memory_minimum_pages;
  if (aggregatePages < minimum) {
    throw new Error(`maxTotalMemoryBytes (${maxTotalMemoryBytes}) cannot fit ${retained} retained instances at the engine minimum (${minimum} pages)`);
  }
  if (maxMemoryPages !== undefined && maxMemoryPages > aggregatePages) {
    throw new Error(`maxMemoryPages (${maxMemoryPages}) exceeds maxTotalMemoryBytes (${maxTotalMemoryBytes}) for ${retained} retained instances; lower workers/maxWorkerModels or raise the total budget`);
  }
  maxMemoryPages ??= Math.min(MAX_MEMORY_PAGES, aggregatePages);

  // Count UTF-8 bytes without allocating another encoded copy of large JSON strings.
  const checkTextSize = (text, maximum, name) => {
    if (typeof text !== "string") throw new Error(`${name} must serialize to JSON text`);
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code < 128) bytes += 1;
      else if (code < 2048) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
      if (bytes > maximum) throw new Error(`${name} exceeds its byte limit (${maximum})`);
    }
    return bytes;
  };
  const models = new Map();
  const plans = new Map();
  let nextPlanId = 1;
  const loadingModels = new Set();
  const slots = [];
  const queue = new Map();
  let queuedBytes = 0;
  let modelBytes = 0;
  const dequeue = (job) => {
    if (queue.delete(job.id)) queuedBytes -= job.bytes;
  };
  let pumping = false;
  let nextId = 1;
  let closed = false;

  /** Settles a job once; later answers of it are ignored. */
  const settle = (job, error, result, failed = true) => {
    if (job.settled) return;
    job.settled = true;
    job.signal?.removeEventListener("abort", job.onAbort);
    if (failed) job.reject(error);
    else job.resolve(result);
  };

  const stop = (worker) => {
    try { Promise.resolve(worker.terminate()).catch(() => {}); } catch { /* already stopped */ }
  };

  const spawn = () => {
    const slot = { worker: createWorker(workerUrl), models: new Set(), plans: new Set(), job: null, dead: false };
    try {
      listen(
        slot.worker,
        (message) => {
          const job = slot.job;
          if (slot.dead || !job || message?.id !== job.id) return;
          clearTimeout(job.timer);
          slot.job = null;
          if (message.type === "prepared") {
            settle(job, null, message.nValues, false);
          } else if (message.type === "result") {
            settle(job, null, { columns: message.columns, nRows: message.nRows, values: message.values }, false);
          } else {
            settle(job, remoteError(message.error ?? {}));
          }
          pump();
        },
        (error) => retire(slot, error),
      );
      slot.worker.postMessage({ type: "init", ...runtime.modules, maxMemoryPages });
    } catch (error) {
      slot.dead = true;
      stop(slot.worker);
      throw error;
    }
    slots.push(slot);
    return slot;
  };

  const retire = (slot, error) => {
    if (slot.dead) return;
    slot.dead = true;
    const index = slots.indexOf(slot);
    if (index >= 0) slots.splice(index, 1);
    stop(slot.worker);
    if (slot.job) { clearTimeout(slot.job.timer); settle(slot.job, error); }
    slot.job = null;
    pump();
  };

  /** Dispatch failures retire the worker, since preceding messages may have been delivered. */
  const pump = () => {
    if (pumping) return;
    pumping = true;
    try {
      while (!closed && queue.size > 0) {
        const job = queue.values().next().value;
        const key = job.key;
        const idle = slots.filter((slot) => !slot.job);
        let slot = idle.find((s) => s.models.has(key)) ?? idle[0];
        if (!slot && slots.length >= workers) return;
        dequeue(job);
        try {
          slot ??= spawn();
          slot.job = job;
          if (job.deadlineMs > 0) job.timer = setTimeout(() => {
            const error = new Error(`worker deadline exceeded (${job.deadlineMs} ms)`);
            error.name = "TimeoutError";
            retire(slot, error);
          }, job.deadlineMs);
          if (!slot.models.has(job.key)) {
            if (slot.models.size >= maxWorkerModels) {
              const oldest = slot.models.values().next().value;
              slot.worker.postMessage({ type: "removeModel", key: oldest });
              slot.models.delete(oldest);
              for (const id of slot.plans) if (plans.get(id)?.key === oldest) slot.plans.delete(id);
            }
            const { module, description } = models.get(job.key);
            slot.worker.postMessage({ type: "model", key: job.key, module, description });
          }
          slot.models.delete(job.key);
          slot.models.add(job.key);
          if (job.prepared) {
            const state = job.prepared;
            const definition = slot.plans.has(state.id) ? {} : { request: state.request, varying: state.varying };
            slot.worker.postMessage({ type: job.type, id: job.id, key: job.key, planId: state.id, values: job.values, ...definition }, job.values ? [job.values.buffer] : []);
            slot.plans.add(state.id);
          } else slot.worker.postMessage({ type: "simulate", id: job.id, key: job.key, request: job.request });
        } catch (error) {
          settle(job, error);
          if (slot) retire(slot, error);
        }
      }
    } finally { pumping = false; }
  };

  const api = {
    /** The most workers of the pool. */
    size: workers,

    /** Effective per-instance and aggregate linear-memory policies. */
    maxMemoryPages,
    maxTotalMemoryBytes,

    /** The compiled modules of the runtime. */
    modules: runtime.modules,

    /**
     * Adds a model under a key: `model` is a `WebAssembly.Module` or the bytes of `model.wasm`
     * (compiled here once), `description` the text of `model.json` or its object. A Promise;
     * a key which exists already is refused.
     */
    async addModel(key, model, description) {
      if (closed) throw new Error("the pool is closed");
      if (models.has(key) || loadingModels.has(key)) throw new Error(`the pool has a model ${key} already`);
      if (models.size + loadingModels.size >= maxModels) throw new Error(`model limit reached (${maxModels})`);
      checkModuleSize(model);
      if (!(model instanceof WebAssembly.Module)) validateModelBytes(model);
      const text = typeof description === "string" ? description : JSON.stringify(description);
      const bytes = checkTextSize(text, maxDescriptionBytes, "description")
        + (model instanceof WebAssembly.Module ? 0 : model.byteLength);
      if (modelBytes + bytes > maxModelBytes) throw new Error(`registered models exceed maxModelBytes (${maxModelBytes})`);
      // Reserve before asynchronous compilation so concurrent calls cannot multiply
      // live module inputs beyond the aggregate policy.
      loadingModels.add(key);
      modelBytes += bytes;
      let registered = false;
      try {
        const module = model instanceof WebAssembly.Module ? model : await WebAssembly.compile(model);
        if (closed) throw new Error("the pool is closed");
        models.set(key, { module, description: text, bytes });
        registered = true;
      } finally {
        if (loadingModels.delete(key) && !registered) modelBytes -= bytes;
      }
    },

    /** Removes an idle model; queued/running users must complete or abort first. */
    removeModel(key) {
      if (loadingModels.has(key) || [...queue.values()].some((job) => job.key === key) || slots.some((slot) => slot.job?.key === key)) {
        throw new Error(`model ${key} is in use`);
      }
      const model = models.get(key);
      if (!model) return false;
      for (const state of [...plans.values()]) if (state.key === key) state.close();
      models.delete(key);
      modelBytes -= model.bytes;
      for (const slot of [...slots]) {
        if (!slot.models.delete(key)) continue;
        try { slot.worker.postMessage({ type: "removeModel", key }); }
        catch (error) { retire(slot, error); }
      }
      return true;
    },

    /** Whether the pool has a model under a key. */
    hasModel(key) {
      return models.has(key);
    },

    async prepare(key, request, { varying = [] } = {}) {
      if (closed) throw new Error("the pool is closed");
      if (!models.has(key)) throw new Error(`the pool has no model ${key}`);
      if (plans.size >= 32) throw new Error("prepared request limit reached (32)");
      const text = typeof request === "string" ? request : JSON.stringify(request);
      const bytes = checkTextSize(text, maxRequestBytes, "request");
      const varyingText = JSON.stringify(varying);
      const varyingBytes = checkTextSize(varyingText, maxRequestBytes, "varying");
      if (modelBytes + bytes + varyingBytes > maxModelBytes) throw new Error(`prepared requests exceed maxModelBytes (${maxModelBytes})`);
      const state = { owner: api, id: nextPlanId++, key, request: text, varying: JSON.parse(varyingText), bytes: bytes + varyingBytes, nValues: 0, closed: false };
      const plan = new PreparedPoolSimulation(poolPlanStates, state);
      state.close = () => {
        if (state.closed) return;
        state.closed = true;
        plans.delete(state.id);
        modelBytes -= state.bytes;
        const error = new Error("the prepared request is closed");
        for (const job of [...queue.values()]) if (job.prepared === state) { dequeue(job); settle(job, error); }
        for (const slot of [...slots]) if (slot.plans.delete(state.id)) {
          try { slot.worker.postMessage({ type: "releasePrepared", key, planId: state.id }); }
          catch (error) { retire(slot, error); }
        }
      };
      plans.set(state.id, state);
      modelBytes += state.bytes;
      try {
        state.nValues = await api.simulate(key, { [preparedJob]: { type: "prepare", prepared: state } });
        if (state.closed || closed) throw new Error("the prepared request is closed");
        return plan;
      } catch (error) { state.close(); throw error; }
    },

    simulatePrepared(plan, values = [], options = {}) {
      const state = poolPlanStates.get(plan);
      if (!state || state.owner !== api || state.closed) return Promise.reject(new Error("foreign or closed prepared request"));
      if ((!Array.isArray(values) && !(values instanceof Float64Array)) || values.length !== state.nValues || values.findIndex((value) => !Number.isFinite(value)) >= 0) {
        return Promise.reject(new Error(`prepared request requires ${state.nValues} finite values`));
      }
      return api.simulate(state.key, { [preparedJob]: { type: "simulatePrepared", prepared: state, values: Float64Array.from(values) } }, options);
    },

    /**
     * Simulates a request of `simulation/1` (an object or its JSON text) on the model `key` in
     * a worker; resolves to `{ columns, nRows, values }` as `instance.simulate` of the loader,
     * the values a `Float64Array`. `signal` (an `AbortSignal`) drops the request, see the module
     * comment.
     */
    simulate(key, request, { signal, deadlineMs: jobDeadline = deadlineMs, hardAbort: jobHardAbort = hardAbort } = {}) {
      return new Promise((resolve, reject) => {
        if (closed) throw new Error("the pool is closed");
        if (!models.has(key)) throw new Error(`the pool has no model ${key}`);
        checkDeadline(jobDeadline);
        if (queue.size >= maxQueuedJobs) throw new Error(`pool queue limit reached (${maxQueuedJobs})`);
        signal?.throwIfAborted();
        const prepared = request?.[preparedJob];
        const text = prepared ? "" : typeof request === "string" ? request : JSON.stringify(request, (_key, value) => {
          if (typeof value === "function" || typeof value === "symbol") {
            throw new DOMException("request values could not be cloned", "DataCloneError");
          }
          return value;
        });
        const bytes = prepared ? (prepared.values?.byteLength ?? prepared.prepared.bytes) : checkTextSize(text, maxRequestBytes, "request");
        if (bytes > maxRequestBytes) throw new Error(`request exceeds its byte limit (${maxRequestBytes})`);
        if (queuedBytes + bytes > maxQueuedBytes) throw new Error(`pool queue exceeds maxQueuedBytes (${maxQueuedBytes})`);
        const job = { ...prepared, bytes, id: nextId++, key, request: text, signal, resolve, reject, settled: false, deadlineMs: jobDeadline };
        job.onAbort = () => {
          dequeue(job);
          settle(job, signal.reason);
          const slot = slots.find((slot) => slot.job === job);
          if (slot && jobHardAbort) retire(slot, signal.reason);
        };
        signal?.addEventListener("abort", job.onAbort, { once: true });
        queue.set(job.id, job);
        queuedBytes += bytes;
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
      for (const state of [...plans.values()]) state.close();
      const error = new Error("the pool is closed");
      for (const job of queue.values()) settle(job, error);
      queue.clear();
      queuedBytes = 0;
      models.clear();
      loadingModels.clear();
      modelBytes = 0;
      for (const slot of slots.splice(0)) {
        slot.dead = true;
        stop(slot.worker);
        if (slot.job) { clearTimeout(slot.job.timer); settle(slot.job, error); }
      }
    },
  };
  return api;
}
