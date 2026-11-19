// A worker of the pool of `pool.mjs`: a runtime of the loader (`loader.mjs`) in a Web Worker or
// in a worker thread of Node, which instantiates the models the pool posts to it and simulates
// one request at a time.
//
// Plain ECMAScript without dependencies. In a browser it is a module worker
// (`new Worker(url, { type: "module" })`) and talks to the pool over its global scope; in Node it
// is a worker thread (`new Worker(url)` of `node:worker_threads`) and talks over `parentPort`,
// which it imports with a dynamic import that never runs in a browser (the specifier is a
// variable, so a bundler does not resolve it either).
//
// The messages of the pool, handled one after the other in the order they arrive:
//
//   { type: "init", engine, mathlib }              the compiled `WebAssembly.Module`s of the runtime
//   { type: "model", key, module, description }    a model: its `WebAssembly.Module` and the text
//                                                  of its `model.json`, instantiated at its first
//                                                  request
//   { type: "removeModel", key }                  drops a retained model and its instance
//   { type: "simulate", id, key, request }         a request of `simulation/1` on the model `key`
//
// and its answers, one per request:
//
//   { type: "result", id, columns, nRows, values } values a Float64Array, whose buffer is transferred
//   { type: "error", id, error }                   error: name, message and the fields of an
//                                                  `EngineError` (kind, detail, flag, time)
//
// An instance which trapped is not used again (`loader.mjs`): the next request of its model
// instantiates the model again.

import { createRuntime } from "./loader.mjs";

let runtime = null;
const models = new Map();
let post = null;
let queue = Promise.resolve();

/** The fields of an error which survive a structured clone, see the answers above. */
function errorFields(error) {
  const fields = { name: error?.name ?? "Error", message: error?.message ?? String(error) };
  for (const name of ["kind", "detail", "flag", "time"]) {
    if (error?.[name] !== undefined) fields[name] = error[name];
  }
  return fields;
}

/** The instance of a model, instantiated at its first request. */
async function instanceOf(key) {
  const model = models.get(key);
  if (!model) throw new Error(`the pool posted no model ${key} to this worker`);
  if (!runtime) throw new Error("the pool posted no runtime to this worker");
  if (!model.instance) model.instance = (await runtime).instantiate(model.module, model.description);
  try {
    return await model.instance;
  } catch (error) {
    model.instance = null;
    throw error;
  }
}

/** Handles one message of the pool. */
async function handle(message) {
  switch (message.type) {
    case "init":
      runtime = createRuntime({ engine: message.engine, mathlib: message.mathlib, maxMemoryPages: message.maxMemoryPages });
      runtime.catch(() => {}); // the error is the one of every request
      return;
    case "model":
      models.set(message.key, { module: message.module, description: message.description, instance: null, plans: new Map(), definitions: new Map() });
      return;
    case "releasePrepared": {
      const model = models.get(message.key);
      model?.plans.get(message.planId)?.close();
      model?.plans.delete(message.planId);
      model?.definitions.delete(message.planId);
      return;
    }
    case "removeModel":
      for (const plan of models.get(message.key)?.plans.values() ?? []) plan.close();
      models.delete(message.key);
      return;
    case "prepare":
    case "simulatePrepared":
    case "simulate": {
      let instance = null;
      try {
        instance = await instanceOf(message.key);
        const model = models.get(message.key);
        let plan;
        if (message.type !== "simulate") {
          if (message.request !== undefined) model.definitions.set(message.planId, { request: message.request, varying: message.varying });
          plan = model.plans.get(message.planId);
          if (!plan) {
            const definition = model.definitions.get(message.planId);
            if (!definition) throw new Error("missing prepared request definition");
            plan = instance.prepare(definition.request, { varying: definition.varying });
            model.plans.set(message.planId, plan);
          }
        }
        if (message.type === "prepare") {
          post({ type: "prepared", id: message.id, nValues: plan.nValues });
          return;
        }
        const { columns, nRows, values } = plan ? instance.simulatePrepared(plan, message.values) : instance.simulate(message.request);
        post({ type: "result", id: message.id, columns, nRows, values }, [values.buffer]);
      } catch (error) {
        if (instance?.trapped) {
          const model = models.get(message.key);
          model.instance = null;
          model.plans.clear();
        }
        post({ type: "error", id: message.id, error: errorFields(error) });
      }
      return;
    }
    default:
      throw new Error(`a message of the unknown type ${message.type}`);
  }
}

/** Queues a message of the pool behind the ones before it. */
function receive(message) {
  queue = queue.then(() => handle(message)).catch((error) => console.error("sbmlsim-core worker:", error));
}

if (typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope) {
  // a Web Worker: the listener is added while the module evaluates, so no message is missed
  post = (message, transfer = []) => globalThis.postMessage(message, transfer);
  globalThis.addEventListener("message", (event) => receive(event.data));
} else {
  // a worker thread of Node: the messages wait in `parentPort` until a listener is added
  // No top-level await, so the inline build (`inline.mjs`) runs this script as a classic worker.
  const specifier = "node:worker_threads";
  import(specifier).then(({ parentPort }) => {
    if (!parentPort) throw new Error("worker.mjs runs as a Web Worker or as a worker thread of Node");
    post = (message, transfer = []) => parentPort.postMessage(message, transfer);
    parentPort.on("message", receive);
  });
}
