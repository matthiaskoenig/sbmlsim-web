/**
 * The loader of the `pkpdutils-core` WebAssembly module.
 *
 * No dependency and no Node API, so this file runs in a browser, in a Web Worker and in Node
 * alike. The module it loads imports nothing at all, so it is instantiated with an empty import
 * object: there is no WASI shim, no memory to pass in and nothing to link.
 *
 *     import { createRuntime } from "pkpdutils-core";
 *     const bytes = await (await fetch(wasmUrl)).arrayBuffer();
 *     const runtime = await createRuntime({ module: bytes });
 *     const answer = runtime.analyze(request);
 *     answer.column("auc_last");   // a Float64Array, one value per sample
 *
 * One instance runs one call at a time and the answer of a call lives until the next one, so
 * every answer this loader hands out holds a copy of its payload. A page which wants several
 * cores runs one instance per Web Worker, which is what `pool.mjs` does.
 */

/** The version of the output layout this loader reads. */
export const OUTPUT_FORMAT = 1;

/** The contract of an analysis request, which the module answers with the same string. */
export const ANALYSIS_CONTRACT = "analysis/1";

/** The contract of a batch of timecourses. */
export const BATCH_CONTRACT = "batch/1";

/**
 * An error the kernel answered with, of one of four kinds.
 *
 * - `refused`: an analysis this build does not carry. A host with another engine runs it there.
 * - `malformed`: the request or the contract is wrong, which is for the caller to fix.
 * - `internal`: a bug of the build, which is to be reported and not handled.
 * - `panic`: the kernel panicked, which is the same thing with a stack behind it.
 */
export class KernelError extends Error {
  /**
   * @param {string} kind one of `refused`, `malformed`, `internal`, `panic`
   * @param {string} message the sentence of the kernel
   */
  constructor(kind, message) {
    super(message);
    this.name = "KernelError";
    this.kind = kind;
  }
}

/** An analysis this build of the kernel does not carry. */
export class RefusedError extends KernelError {
  /** @param {string} message the sentence of the kernel, which names what it refused */
  constructor(message) {
    super("refused", message);
    this.name = "RefusedError";
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Read one output of the module, the layout of `crates/wasm/src/output.rs`.
 *
 * A `u32` header length, a JSON header, zero padding to a multiple of 8 counted from the start
 * of the output, then the `f64` values little endian and row major. The values are copied out,
 * because the next call of the instance writes over them.
 *
 * @param {WebAssembly.Memory} memory the memory of the instance
 * @param {number} ptr the address of the output
 * @param {number} len its length in bytes
 * @returns {{header: object, values: Float64Array}}
 */
export function readOutput(memory, ptr, len) {
  if (ptr === 0 || len === 0) {
    throw new KernelError(
      "internal",
      "the module answered no output at all, which is an instance out of memory",
    );
  }
  const bytes = new Uint8Array(memory.buffer, ptr, len);
  const headerLength = new DataView(memory.buffer, ptr, 4).getUint32(0, true);
  const header = JSON.parse(decoder.decode(bytes.subarray(4, 4 + headerLength)));
  const start = Math.ceil((4 + headerLength) / 8) * 8;
  // `slice` copies, which is what makes an answer outlive the next call
  const values = new Float64Array(memory.buffer.slice(ptr + start, ptr + len));
  return { header, values };
}

/**
 * The answer of a call: its header, its columns and the values of each.
 *
 * @param {object} header the header of the output
 * @param {Float64Array} values the payload
 * @returns {{header: object, columns: object[], values: Float64Array, column: (name: string) => Float64Array | undefined}}
 */
function answerOf(header, values) {
  const columns = header.columns ?? [];
  const rows = header.n_rows ?? header.width ?? 0;
  const at = new Map();
  let offset = 0;
  for (const column of columns) {
    const width = (column.width ?? 1) * rows;
    at.set(column.name, [offset, offset + width]);
    offset += width;
  }
  return {
    header,
    columns,
    values,
    /**
     * One column by name, `undefined` when the answer carries none of that name.
     *
     * @param {string} name the name of a column of the header
     * @returns {Float64Array | undefined}
     */
    column(name) {
      const range = at.get(name);
      return range === undefined ? undefined : values.subarray(range[0], range[1]);
    },
  };
}

/**
 * Instantiate the module and answer the entry points it carries.
 *
 * @param {{module: WebAssembly.Module | BufferSource, expectFormat?: number}} options the
 *   compiled module or its bytes, and the output layout the caller expects (`OUTPUT_FORMAT` by
 *   default; `null` accepts whatever the module reports)
 * @returns {Promise<{about: object, analyze: (request: object | string) => object, summarize: (request: object | string) => object, memory: WebAssembly.Memory, instance: WebAssembly.Instance}>}
 */
export async function createRuntime({ module, expectFormat = OUTPUT_FORMAT }) {
  const compiled = module instanceof WebAssembly.Module ? module : await WebAssembly.compile(module);
  const instance = await WebAssembly.instantiate(compiled, {});
  const exports = instance.exports;
  for (const name of [
    "memory",
    "pkpd_alloc",
    "pkpd_free",
    "pkpd_analyze",
    "pkpd_summarize",
    "pkpd_about",
    "pkpd_output_ptr",
    "pkpd_output_len",
  ]) {
    if (exports[name] === undefined) {
      throw new KernelError("malformed", `the module carries no ${name}`);
    }
  }

  /** Whether this instance trapped, after which it answers nothing more. */
  let dead = null;

  /** The output of the last call, read and copied. */
  const output = () => readOutput(exports.memory, exports.pkpd_output_ptr(), exports.pkpd_output_len());

  /**
   * Call one entry point with one request.
   *
   * @param {string} entry the name of the export
   * @param {object | string} request the request, as an object or as its JSON
   * @returns {object} the answer
   */
  const call = (entry, request) => {
    if (dead !== null) {
      throw new KernelError(
        dead.kind,
        `this instance trapped and answers nothing more (${dead.message})`,
      );
    }
    const bytes = encoder.encode(typeof request === "string" ? request : JSON.stringify(request));
    const ptr = exports.pkpd_alloc(bytes.length);
    if (ptr === 0 && bytes.length > 0) {
      throw new KernelError(
        "internal",
        `the instance could not allocate ${bytes.length} bytes for the request`,
      );
    }
    let code;
    try {
      new Uint8Array(exports.memory.buffer, ptr, bytes.length).set(bytes);
      code = exports[entry](ptr, bytes.length);
    } catch (trap) {
      // the panic hook of the host wrote its sentence before the trap, so the output buffer
      // holds it; the instance is left for dead, because what trapped did not finish
      dead = panicOf(exports, trap);
      throw dead;
    } finally {
      exports.pkpd_free(ptr, bytes.length);
    }
    const { header, values } = output();
    if (code !== 0) {
      throw errorOf(header);
    }
    return answerOf(header, values);
  };

  const about = (() => {
    const code = exports.pkpd_about();
    const { header } = output();
    if (code !== 0) {
      throw errorOf(header);
    }
    return header;
  })();
  if (expectFormat !== null && about.output_format !== expectFormat) {
    throw new KernelError(
      "malformed",
      `the module writes output format ${about.output_format} and this loader reads ${expectFormat}`,
    );
  }

  return {
    about,
    memory: exports.memory,
    instance,
    /**
     * Analyse a batch of timecourses.
     *
     * @param {object | string} request `{contract, batch, options}`, see the `analysis/1`
     *   contract of `pkpdutils-abi`
     * @returns {object} the answer, with `column(name)` for every variable of the result
     */
    analyze: (request) => call("pkpd_analyze", request),
    /**
     * Reduce a parameter table over its samples.
     *
     * @param {object | string} request `{values, n_vars, n_groups, n_samples, ci_level,
     *   lognormal, discrete}`
     * @returns {object} the answer, one block per statistic
     */
    summarize: (request) => call("pkpd_summarize", request),
  };
}

/**
 * The error of an error header.
 *
 * @param {object} header the header of an output
 * @returns {KernelError}
 */
function errorOf(header) {
  const error = header.error ?? {};
  const kind = error.kind ?? "internal";
  const message = error.message ?? "the module answered an error without a message";
  return kind === "refused" ? new RefusedError(message) : new KernelError(kind, message);
}

/**
 * The error of a trap, with the sentence the panic hook left behind when there is one.
 *
 * @param {WebAssembly.Exports} exports the exports of the instance
 * @param {unknown} trap what the call threw
 * @returns {KernelError}
 */
function panicOf(exports, trap) {
  try {
    const ptr = exports.pkpd_output_ptr();
    const len = exports.pkpd_output_len();
    if (ptr !== 0 && len !== 0) {
      const { header } = readOutput(exports.memory, ptr, len);
      if (header.error?.kind === "panic") {
        return new KernelError("panic", header.error.message);
      }
    }
  } catch {
    // the output buffer is not readable after this trap, which leaves the trap itself
  }
  const message = trap instanceof Error ? trap.message : String(trap);
  return new KernelError("internal", `the module trapped: ${message}`);
}
