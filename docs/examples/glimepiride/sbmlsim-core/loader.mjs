// The JavaScript loader of sbmlsim-core: runs `engine.wasm`, `mathlib.wasm` and a compiled
// `model.wasm` in a JavaScript host (Node, browsers), with the bits of the wasmtime host.
//
// Plain ECMAScript without dependencies and without APIs of Node (no `fs`, no `process`), so it
// runs in browsers as well:
//
//   import { createRuntime } from "./loader.mjs";
//   const runtime = await createRuntime({ engine, mathlib }); // WebAssembly.Modules or bytes
//   const instance = await runtime.instantiate(modelWasm, modelJson); // a Promise; a Module or bytes, the
//                                                                     // text of model.json or
//                                                                     // its object
//   const { columns, nRows, values } = instance.simulate(request); // values: a Float64Array
//
// The linking is the one of the wasmtime host (`crates/host/src/lib.rs`): a memory of the type
// the engine imports (its minimum is the custom section `sbmlsim.engine` of `engine.wasm`, with a
// maximum of `MAX_MEMORY_PAGES`, the `MAX_MEMORY_BYTES` of the wasmtime host), then mathlib, then
// the model (which imports the memory as `env.memory` and the functions of mathlib as
// `math.*`), then the engine (which imports the memory, the functions of the model as
// `model.*` and WASI preview1), so every call between them is a call from wasm to wasm.
//
// WASI preview1: `fd_write` writes to the console (stdout with `console.log`, stderr with
// `console.error`, line by line), `proc_exit` throws, `environ_get` and `environ_sizes_get` give
// an empty environment, `clock_time_get` and `random_get` throw, and so does every other
// function of WASI the engine imports: the engine calls none of them while it loads or simulates
// (`instance.wasiCalls()` counts the calls), so a call is a visible failure.
//
// The exports of `engine.wasm` and its output are documented in `crates/engine/src/exports.rs`:
// a `u32` (little endian) with the length of a JSON header, the header (`{"columns", "n_rows"}`,
// or `{"error": {...}}`), zero bytes up to a multiple of 8, then the values as `f64` (little
// endian), row major. The output starts at an address aligned to 8, so the values are read
// through a `Float64Array` over the memory (copied once, into the result, since the memory is
// reused by the next call and detached when it grows); the bits are kept, NaN payloads too.
//
// The description is passed to the engine as JSON: the text of `model.json` as it is, or an
// object as `JSON.stringify` writes it. `model.json` writes an initial value which is not
// finite as the string "NaN", "inf" or "-inf" (JSON has no such numbers), which `JSON.parse`
// keeps as a string and `JSON.stringify` writes back, and the engine reads.

/** The contract of a model description this loader loads. */
export const MODEL_CONTRACT = "model/2";

/** The most pages of 64 KiB the memory of an instance grows to: 2 GiB, as the wasmtime host. */
export const MAX_MEMORY_PAGES = 32768;

/**
 * The custom section of `engine.wasm` with the minimum of the memory it imports and the version
 * of its output (`ENGINE_SECTION` of `crates/abi`).
 */
export const ENGINE_SECTION = "sbmlsim.engine";

/** The version of the output of `engine.wasm` this loader reads (`ENGINE_OUTPUT_FORMAT`). */
export const ENGINE_OUTPUT_FORMAT = 2;

const WASI = "wasi_snapshot_preview1";

const ENGINE_EXPORTS = [
  "engine_alloc",
  "engine_free",
  "engine_load",
  "engine_simulate",
  "engine_output_ptr",
  "engine_output_len",
  "engine_stats_ptr",
];

/**
 * The counters of the last simulation in the order of `engine_stats_ptr` (`SimulationStats`
 * of `crates/abi`).
 */
export const STATS_NAMES = [
  "steps",
  "rhs_evals",
  "jacobian_evals",
  "jacobian_rhs_evals",
  "jacobian_fallbacks",
  "linear_setups",
  "error_test_failures",
  "nonlinear_iterations",
  "nonlinear_convergence_failures",
  "root_evals",
  "integrations",
  "probe_rhs_evals",
  "steady_state_rhs_evals",
  "linear_iterations",
  "linear_convergence_failures",
  "jacobian_vector_evals",
  "preconditioner_evals",
  "preconditioner_solves",
  "sensitivity_rhs_evals",
  "sensitivity_model_rhs_evals",
  "sensitivity_jac_p_evals",
];

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/**
 * An error of the engine: `kind` is `load`, `request`, `unsupported`, `integration` (with
 * `flag` and `time`, `NaN` for a time which is not finite) or `internal` (a trap of the engine
 * or of the model, a panic of the engine, a failure of the loader).
 */
export class EngineError extends Error {
  constructor(kind, message, { flag, time } = {}) {
    super(`${kind}: ${message}`);
    this.name = "EngineError";
    this.kind = kind;
    this.detail = message;
    if (flag !== undefined) this.flag = flag;
    if (time !== undefined) this.time = time === null ? NaN : time;
  }
}

/** An older runtime without the optional prepared-request capability. */
export class UnsupportedError extends EngineError {
  constructor(message) {
    super("unsupported", message);
    this.name = "UnsupportedError";
  }
}

/** The exit of the engine through `proc_exit`. */
export class WasiExit extends Error {
  constructor(code) {
    super(`engine.wasm called proc_exit(${code})`);
    this.name = "WasiExit";
    this.code = code;
  }
}

/** A `WebAssembly.Module` of a module or of its bytes. */
async function toModule(source, what) {
  if (source instanceof WebAssembly.Module) return source;
  try {
    return await WebAssembly.compile(source);
  } catch (error) {
    throw new Error(`${what} does not compile: ${error.message}`);
  }
}

/**
 * The minimum of the memory `engine.wasm` imports, from its section `sbmlsim.engine`, whose
 * output format must be `ENGINE_OUTPUT_FORMAT`.
 */
function memoryMinimum(engineModule) {
  const sections = WebAssembly.Module.customSections(engineModule, ENGINE_SECTION);
  if (sections.length !== 1) {
    throw new Error(
      `engine.wasm has no custom section ${ENGINE_SECTION} with the minimum of its memory and ` +
        "the version of its output (the build script of sbmlsim-host adds it)",
    );
  }
  const { memory_minimum_pages: pages, output_format: format } = JSON.parse(
    new TextDecoder().decode(sections[0]),
  );
  if (format === undefined) {
    throw new Error(
      `engine.wasm declares no output format in its section ${ENGINE_SECTION}, this loader ` +
        `reads ${ENGINE_OUTPUT_FORMAT}`,
    );
  }
  if (format !== ENGINE_OUTPUT_FORMAT) {
    throw new Error(
      `engine.wasm writes the output format ${format}, this loader reads ${ENGINE_OUTPUT_FORMAT}`,
    );
  }
  if (!Number.isInteger(pages) || pages < 0 || pages > MAX_MEMORY_PAGES) {
    throw new Error(`engine.wasm declares a memory of ${pages} pages`);
  }
  return pages;
}

/**
 * The functions of WASI preview1 of an instance: the stubs of the module comment, one per
 * function `engine.wasm` imports (`{ imports, calls() }`, `calls()` the number of their calls);
 * `getMemory()` gives the memory of the instance, `out` has `log` and `error` (the console).
 */
export function wasiImports(engineModule, getMemory, out) {
  let calls = 0;
  const decoders = new Map();
  const lines = new Map();
  const view = () => new DataView(getMemory().buffer);
  const write = (fd, bytes) => {
    if (!decoders.has(fd)) decoders.set(fd, new TextDecoder());
    let text = (lines.get(fd) ?? "") + decoders.get(fd).decode(bytes, { stream: true });
    let newline;
    while ((newline = text.indexOf("\n")) >= 0) {
      (fd === 2 ? out.error : out.log)(text.slice(0, newline));
      text = text.slice(newline + 1);
    }
    lines.set(fd, text);
  };
  const provided = {
    fd_write(fd, iovs, iovsLen, nwritten) {
      calls += 1;
      if (fd !== 1 && fd !== 2) return 8; // EBADF
      const memory = view();
      let total = 0;
      for (let i = 0; i < iovsLen; i += 1) {
        const ptr = memory.getUint32(iovs + 8 * i, true);
        const len = memory.getUint32(iovs + 8 * i + 4, true);
        write(fd, new Uint8Array(getMemory().buffer, ptr, len));
        total += len;
      }
      memory.setUint32(nwritten, total, true);
      return 0;
    },
    proc_exit(code) {
      calls += 1;
      throw new WasiExit(code);
    },
    environ_get() {
      calls += 1;
      return 0;
    },
    environ_sizes_get(count, size) {
      calls += 1;
      const memory = view();
      memory.setUint32(count, 0, true);
      memory.setUint32(size, 0, true);
      return 0;
    },
    clock_time_get() {
      calls += 1;
      throw new Error("engine.wasm called WASI clock_time_get: the engine reads no clock");
    },
    random_get() {
      calls += 1;
      throw new Error("engine.wasm called WASI random_get: the engine draws no random bytes");
    },
  };
  const imports = {};
  for (const { module, name, kind } of WebAssembly.Module.imports(engineModule)) {
    if (module !== WASI || kind !== "function") continue;
    imports[name] =
      provided[name] ??
      (() => {
        calls += 1;
        throw new Error(`engine.wasm called WASI ${name}, which the loader does not provide`);
      });
  }
  return { imports, calls: () => calls };
}

/** Checks the imports and exports of `engine.wasm` and `mathlib.wasm`. */
function checkRuntime(engineModule, mathlibModule) {
  let memory = false;
  for (const { module, name, kind } of WebAssembly.Module.imports(engineModule)) {
    if (module === "env" && name === "memory" && kind === "memory") memory = true;
    else if ((module === "model" || module === WASI) && kind === "function") continue;
    else throw new Error(`engine.wasm imports ${module}.${name}`);
  }
  if (!memory) throw new Error("engine.wasm imports no memory");
  const exports = new Set(WebAssembly.Module.exports(engineModule).map((e) => e.name));
  for (const name of ENGINE_EXPORTS) {
    if (!exports.has(name)) throw new Error(`engine.wasm does not export ${name}`);
  }
  const [mathImport] = WebAssembly.Module.imports(mathlibModule);
  if (mathImport) {
    throw new Error(
      `mathlib.wasm imports ${mathImport.module}.${mathImport.name}, it imports nothing`,
    );
  }
}

/** Validate model state sections before compilation. Modules supplied already compiled are trusted. */
export function validateModelBytes(source) {
  const bytes = source instanceof ArrayBuffer ? new Uint8Array(source)
    : ArrayBuffer.isView(source) ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength) : null;
  if (!bytes || bytes.length < 8) throw new Error("model.wasm is not a WASM binary");
  let pos = 8;
  const leb = (end) => {
    let value = 0;
    for (let shift = 0; shift < 35 && pos < end; shift += 7) {
      const byte = bytes[pos++];
      value += (byte & 127) * 2 ** shift;
      if (!(byte & 128)) return value;
    }
    throw new Error("invalid model.wasm section encoding");
  };
  while (pos < bytes.length) {
    const id = bytes[pos++];
    const length = leb(bytes.length);
    const end = pos + length;
    if (end > bytes.length) throw new Error("invalid model.wasm section length");
    if (id === 1) {
      const count = leb(end);
      for (let i = 0; i < count; i++) {
        // Generated models need ordinary numeric function signatures, not GC heaps,
        // recursive types or host references outside the shared-memory policy.
        if (bytes[pos++] !== 0x60) throw new Error("model.wasm has an unsupported type");
        for (let vector = 0; vector < 2; vector++) {
          const n = leb(end);
          for (let j = 0; j < n; j++) {
            if (pos >= end || ![0x7f, 0x7e, 0x7d, 0x7c, 0x7b].includes(bytes[pos++])) {
              throw new Error("model.wasm has an unsupported reference type");
            }
          }
        }
      }
    }
    if (id === 13) throw new Error("model.wasm must not define exception tags");
    if ([4, 5, 8, 9, 11, 12].includes(id)) {
      // Empty declarations are harmless, but start/data-count are scalar sections.
      if (id === 8 || id === 12 || leb(end) !== 0) {
        throw new Error("model.wasm must not define tables, memories, a start function, elements or data");
      }
    }
    if (id === 6) {
      const count = leb(end);
      for (let i = 0; i < count; i++) {
        const type = bytes[pos++];
        if (![0x7f, 0x7e, 0x7d, 0x7c].includes(type)) throw new Error("model.wasm has an unsupported global type");
        if (bytes[pos++] !== 0) throw new Error("model.wasm must not define mutable globals");
        // The compiler emits no globals. Accept ordinary immutable scalar constants;
        // reject extended constant expressions rather than guessing instruction lengths.
        const op = bytes[pos++];
        if (op === 0x41 || op === 0x42) {
          let n = 0;
          while (pos < end && n++ < 10 && (bytes[pos++] & 128)) {}
        } else if (op === 0x43) pos += 4;
        else if (op === 0x44) pos += 8;
        else throw new Error("model.wasm has an unsupported global initializer");
        if (pos >= end || bytes[pos++] !== 0x0b) throw new Error("model.wasm has an invalid global initializer");
      }
    }
    pos = end;
  }
}

/** Checks that a model imports `env.memory` and otherwise only functions of mathlib. */
function checkModel(modelModule, mathlibModule) {
  const math = new Set(
    WebAssembly.Module.exports(mathlibModule)
      .filter((e) => e.kind === "function")
      .map((e) => e.name),
  );
  let memory = false;
  for (const { module, name, kind } of WebAssembly.Module.imports(modelModule)) {
    if (module === "env" && name === "memory" && kind === "memory") memory = true;
    else if (module === "math" && kind === "function" && math.has(name)) continue;
    else {
      throw new Error(
        `model.wasm imports ${module}.${name}, which is neither env.memory nor a function of mathlib`,
      );
    }
  }
  if (!memory) throw new Error("model.wasm does not import env.memory");
}

/** The JSON text of a description, request or other value. */
function jsonText(value) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * Compiles (or takes) `engine.wasm` and `mathlib.wasm` and checks their imports and exports;
 * the runtime instantiates models with them. `engine` and `mathlib` are `WebAssembly.Module`s
 * (e.g. posted to a worker) or their bytes; `console` gets the output of `fd_write` (`log`,
 * `error`), `maxMemoryPages` lowers the maximum of the memory (tests).
 */
export async function createRuntime({
  engine,
  mathlib,
  console: out = globalThis.console,
  maxMemoryPages = MAX_MEMORY_PAGES,
}) {
  const engineModule = await toModule(engine, "engine.wasm");
  const mathlibModule = await toModule(mathlib, "mathlib.wasm");
  checkRuntime(engineModule, mathlibModule);
  const minimum = memoryMinimum(engineModule);
  if (!Number.isSafeInteger(maxMemoryPages) || maxMemoryPages < minimum || maxMemoryPages > MAX_MEMORY_PAGES) {
    throw new Error(`maxMemoryPages must be between ${minimum} and ${MAX_MEMORY_PAGES}`);
  }
  return {
    /** The compiled modules, which a worker gets to create a runtime of its own. */
    modules: { engine: engineModule, mathlib: mathlibModule },

    /**
     * Instantiates a model (a `WebAssembly.Module` or the bytes of `model.wasm`) with its
     * description (the text of `model.json` or its object) and loads it into a new engine.
     * Asynchronous (a Promise of the instance): bytes compile with `WebAssembly.compile`, which
     * browsers require for modules above a few KB on the main thread.
     */
    async instantiate(modelWasm, description) {
      const descText = jsonText(description);
      const desc = typeof description === "string" ? JSON.parse(description) : description;
      if (desc.contract !== MODEL_CONTRACT) {
        throw new Error(`the description is of the contract ${desc.contract}, not ${MODEL_CONTRACT}`);
      }
      if (!(modelWasm instanceof WebAssembly.Module)) validateModelBytes(modelWasm);
      const modelModule = await toModule(modelWasm, "model.wasm");
      const history = WebAssembly.Module.customSections(modelModule, "sbmlsim.history");
      const nDelays = desc.n_delays ?? 0;
      if (history.length > 1 || (history.length === 0 && nDelays !== 0)) {
        throw new Error("model.wasm history sites differ from its description");
      }
      if (history.length === 1) {
        const info = new DataView(history[0]);
        if (info.byteLength !== 8 || info.getUint32(0, true) !== 1 || info.getUint32(4, true) !== nDelays) {
          throw new Error("model.wasm history metadata differs from its description");
        }
      }
      checkModel(modelModule, mathlibModule);
      const memory = new WebAssembly.Memory({ initial: minimum, maximum: maxMemoryPages });
      const wasi = wasiImports(engineModule, () => memory, out);
      const math = await WebAssembly.instantiate(mathlibModule, {});
      const model = await WebAssembly.instantiate(modelModule, {
        env: { memory },
        math: math.exports,
      });
      let engineInstance;
      try {
        engineInstance = await WebAssembly.instantiate(engineModule, {
          env: { memory },
          model: model.exports,
          [WASI]: wasi.imports,
        });
      } catch (error) {
        // a model which lacks a function of the contract: the error of the wasmtime host
        if (error instanceof WebAssembly.LinkError) {
          throw new Error(`engine.wasm does not instantiate with the model: ${error.message}`);
        }
        throw error;
      }
      const instance = new Instance(engineInstance.exports, memory, wasi.calls);
      if (engineInstance.exports._initialize) {
        instance.guard(() => engineInstance.exports._initialize());
      }
      instance.initializeCalls = wasi.calls();
      instance.load(descText, desc.id);
      return instance;
    },
  };
}

/** A model loaded into an engine; one per model and thread. */
const preparedStates = new WeakMap();

/** An opaque reusable request bound to the instance that prepared it. */
export class PreparedSimulation {
  constructor(token, state) {
    if (token !== preparedStates) throw new TypeError("use instance.prepare()");
    preparedStates.set(this, state);
  }
  get nValues() { return preparedStates.get(this).nValues; }
  close() {
    const state = preparedStates.get(this);
    if (state.closed) return;
    state.closed = true;
    state.instance.plans.delete(this);
    if (!state.instance.trapped) state.instance.guard(() => state.instance.exports.engine_release_prepared(state.handle));
  }
}

class Instance {
  constructor(exports, memory, calls) {
    this.exports = exports;
    this.memory = memory;
    this.calls = calls;
    this.trapped = false;
    this.encoder = new TextEncoder();
    this.decoder = new TextDecoder();
    this.inputPtr = 0;
    this.inputCapacity = 0;
    this.plans = new Set();
  }

  /** The number of calls of the engine into WASI since the instance was created. */
  wasiCalls() {
    return this.calls();
  }

  /** The size of the memory of the instance in bytes. */
  memoryBytes() {
    return this.memory.buffer.byteLength;
  }

  /**
   * The counters of the integrator of the last simulation: an object of the names of
   * `STATS_NAMES` to numbers (`engine_stats_ptr`).
   */
  stats() {
    if (this.trapped) {
      throw new EngineError("internal", "the instance trapped before and is not used again");
    }
    const ptr = this.guard(() => this.exports.engine_stats_ptr()) >>> 0;
    const view = new DataView(this.memory.buffer, ptr, 8 * STATS_NAMES.length);
    return Object.fromEntries(STATS_NAMES.map((name, i) => [name, Number(view.getBigUint64(8 * i, true))]));
  }

  /** The address of the output of the last call in the memory (aligned to 8). */
  outputAddress() {
    return this.exports.engine_output_ptr() >>> 0;
  }

  /**
   * Simulates a request (an object of the contract `simulation/1` or its JSON text); gives
   * `{ columns, nRows, values }`, the values a `Float64Array` of the rows, row major. The result
   * does not depend on the simulations before. An error of the engine is an `EngineError`.
   */
  simulate(request) {
    const code = this.call(this.exports.engine_simulate, jsonText(request));
    const output = this.output();
    if (code === 0 && output.table) return output.table;
    if (code === 1 && output.error) throw output.error;
    throw new EngineError("internal", `engine_simulate returned ${code} with the output ${JSON.stringify(output.header)}`);
  }

  /** Prepares fixed request structure once; varying IDs define the raw value order. */
  prepare(request, { varying = [] } = {}) {
    if (!["engine_prepare", "engine_simulate_prepared", "engine_release_prepared"].every((name) => typeof this.exports[name] === "function")) {
      throw new UnsupportedError("this engine does not support prepared requests");
    }
    if (this.trapped) throw new EngineError("internal", "the instance trapped before and is not used again");
    if (this.plans.size >= 32) throw new EngineError("request", "prepared request limit reached (32)");
    const code = this.call(this.exports.engine_prepare, jsonText({ request: typeof request === "string" ? JSON.parse(request) : request, varying }));
    const output = this.output();
    if (code !== 0) throw output.error ?? new EngineError("internal", "engine_prepare failed without an error");
    const { prepared: handle, n_values: nValues } = output.header;
    if (!Number.isInteger(handle) || !Number.isSafeInteger(nValues) || nValues < 0) throw new EngineError("internal", "invalid prepared request output");
    const plan = new PreparedSimulation(preparedStates, { instance: this, handle, nValues, closed: false });
    this.plans.add(plan);
    return plan;
  }

  simulatePrepared(plan, values = []) {
    const state = preparedStates.get(plan);
    if (!state || state.instance !== this || state.closed) throw new EngineError("request", "foreign or closed prepared request");
    if (this.trapped) throw new EngineError("internal", "the instance trapped before and is not used again");
    if ((!Array.isArray(values) && !(values instanceof Float64Array)) || values.length !== state.nValues || values.findIndex((value) => !Number.isFinite(value)) >= 0) {
      throw new EngineError("request", `prepared request requires ${state.nValues} finite values`);
    }
    const ptr = this.inputBuffer(values.length * 8);
    const view = new DataView(this.memory.buffer, ptr, values.length * 8);
    for (let i = 0; i < values.length; i++) view.setFloat64(i * 8, values[i], true);
    const code = this.guard(() => this.exports.engine_simulate_prepared(state.handle, ptr, values.length));
    const output = this.output();
    if (code === 0 && output.table) return output.table;
    if (output.error) throw output.error;
    throw new EngineError("internal", "engine_simulate_prepared returned invalid output");
  }

  inputBuffer(length) {
    if (length > this.inputCapacity) {
      const capacity = Math.max(length, this.inputCapacity * 2, 256);
      const ptr = this.guard(() => this.exports.engine_alloc(capacity)) >>> 0;
      if (!ptr) throw new EngineError("internal", "engine_alloc found no memory for the input");
      if (this.inputCapacity) this.guard(() => this.exports.engine_free(this.inputPtr, this.inputCapacity));
      this.inputPtr = ptr;
      this.inputCapacity = capacity;
    }
    return this.inputPtr;
  }

  /** Loads the description (`engine_load`). */
  load(descText, id) {
    const before = this.calls();
    const code = this.call(this.exports.engine_load, descText);
    this.loadCalls = this.calls() - before;
    if (code !== 0) {
      const { error } = this.output();
      const message = error?.kind === "load" ? error.detail : `engine_load failed: ${error?.message}`;
      throw new Error(`the engine refuses the description of model ${id}: ${message}`);
    }
  }

  /** Calls `engine_load` or `engine_simulate` with `text` in a buffer of the engine. */
  call(fn, text) {
    if (this.trapped) {
      throw new EngineError("internal", "the instance trapped before and is not used again");
    }
    const bytes = this.encoder.encode(text);
    const ptr = this.inputBuffer(bytes.length);
    new Uint8Array(this.memory.buffer, ptr, bytes.length).set(bytes);
    const code = this.guard(() => fn(ptr, bytes.length));
    return code;
  }

  /**
   * Runs a call of the engine; whatever it throws marks the instance and is an `EngineError`
   * `internal` ([`trapError`]), as a trap of the wasmtime host, but `WasiExit`.
   */
  guard(call) {
    try {
      return call();
    } catch (error) {
      this.trapped = true;
      if (error instanceof WasiExit) throw error;
      let panic = null;
      try {
        const { error: e } = this.output();
        if (e?.engineKind === "panic") panic = e.detail;
      } catch {
        // no output to read
      }
      throw trapError(error, panic);
    }
  }

  /** The output of the last call: `{ header, table }` or `{ header, error }`. */
  output() {
    const ptr = this.exports.engine_output_ptr() >>> 0;
    const len = this.exports.engine_output_len() >>> 0;
    const buffer = this.memory.buffer;
    if (len < 4 || ptr + len > buffer.byteLength) {
      throw new EngineError("internal", "the output of the engine is outside of the memory");
    }
    const view = new DataView(buffer, ptr, len);
    const headerLength = view.getUint32(0, true);
    if (4 + headerLength > len) {
      throw new EngineError("internal", "the header of the output of the engine is cut off");
    }
    const header = JSON.parse(this.decoder.decode(new Uint8Array(buffer, ptr + 4, headerLength)));
    if (header.error) {
      const { kind, message, flag, time } = header.error;
      const known = ["load", "request", "unsupported", "integration"];
      const error = known.includes(kind)
        ? new EngineError(kind, message, { flag, time })
        : new EngineError("internal", kind === "panic" ? `engine.wasm panicked: ${message}` : `an error of the unknown kind ${kind}: ${message}`);
      error.detail = message;
      error.engineKind = kind;
      return { header, error };
    }
    if (header.prepared !== undefined) return { header };
    const { columns, n_rows: nRows } = header;
    const start = (4 + headerLength + 7) & ~7;
    const n = nRows * columns.length;
    if (start + 8 * n !== len) {
      throw new EngineError(
        "internal",
        `the output of the engine does not hold ${nRows} rows of ${columns.length} columns`,
      );
    }
    let values;
    if (LITTLE_ENDIAN) {
      // the output is aligned to 8, so the values are a Float64Array over the memory
      values = new Float64Array(buffer, ptr + start, n).slice();
    } else {
      values = new Float64Array(n);
      for (let i = 0; i < n; i += 1) values[i] = view.getFloat64(start + 8 * i, true);
    }
    return { header, table: { columns, nRows, values } };
  }
}

/**
 * The `EngineError` of what a call of the engine threw, as the wasmtime host maps a trap: a
 * trap of the engine or the model (`WebAssembly.RuntimeError`), the exhaustion of the stack of
 * the host (V8 throws a `RangeError`, wasmtime traps) and an error a WASI stub threw are all of
 * the kind `internal`, with the message of a panic of the engine when it wrote one; the error is
 * the `cause`. (`WasiExit`, the engine calling `proc_exit`, stays an error of its own, which
 * `guard` throws as it is.)
 */
export function trapError(error, panic = null) {
  const what = error instanceof WebAssembly.RuntimeError ? "trapped" : `failed (${error?.name ?? "Error"})`;
  const message = `engine.wasm ${what}: ${error?.message ?? String(error)}${panic ? ` (${panic})` : ""}`;
  const mapped = new EngineError("internal", message);
  mapped.cause = error;
  return mapped;
}

/**
 * A number as the CSV of the command line writes it (Rust's `{}` of `f64`): the shortest
 * decimal which reads back as the same double, without an exponent, `-0` for the negative
 * zero, and `NaN`, `inf`, `-inf`.
 */
export function formatNumber(x) {
  if (Number.isNaN(x)) return "NaN";
  if (x === Infinity) return "inf";
  if (x === -Infinity) return "-inf";
  const sign = x < 0 || Object.is(x, -0) ? "-" : "";
  // the shortest digits which read back as x, with the exponent of the first one
  const [mantissa, exponent] = Math.abs(x).toExponential().split("e");
  const digits = mantissa.replace(".", "");
  const e = Number(exponent);
  let text;
  if (e < 0) text = `0.${"0".repeat(-e - 1)}${digits}`;
  else if (digits.length <= e + 1) text = digits + "0".repeat(e + 1 - digits.length);
  else text = `${digits.slice(0, e + 1)}.${digits.slice(e + 1)}`;
  return sign + text;
}

/** The CSV of a result as the command line writes it (`sbmlsim_cli::csv`). */
export function toCsv({ columns, values }) {
  const k = Math.max(columns.length, 1);
  const lines = [columns.join(",")];
  for (let i = 0; i < values.length; i += k) {
    const row = [];
    for (let j = i; j < Math.min(i + k, values.length); j += 1) row.push(formatNumber(values[j]));
    lines.push(row.join(","));
  }
  return `${lines.join("\n")}\n`;
}
