// The routes of the panel service of sbmlsim (`python -m sbmlsim.serve`) answered inside a page:
// `createPanelEndpoint` gives a function with the signature of `fetch` which answers the
// requests of the panels of one model from a bundle (`panelbundle/1`, written by
// `python -m sbmlsim.serve --export`) and runs their simulations on a pool of workers
// (`pool.mjs`), so a panel app is a static page without a server.
//
// Plain ECMAScript without dependencies and without APIs of Node, so it runs in browsers as well:
//
//   import { createPanelEndpoint } from "./panels.mjs";
//   const endpoint = createPanelEndpoint({ bundle: "./glimepiride/bundle.json" });
//   const response = await endpoint("local:glimepiride/api/models/glimepiride/app", {});
//   // the elements of sbmlsim-web: registerEndpoint("local:glimepiride", endpoint)
//
// The bundle is a directory: `bundle.json`, and per model of a run the SBML (`model.xml`) and
// the compiled model (`model.wasm`, `model.json`, written by `sbmlsim-core compile`). Everything
// is loaded on the first request: `bundle.json` and the runtime first, a model at the first
// simulation which needs it.
//
// The routes (the part of the URL from `/api/` on; the model id is the one of the bundle, the
// query `variant` a key of `answers` of the bundle, none the key ""):
//
//   GET  /api/models/{model}/app[?variant=V]               answers[V].app, a 404 for none
//   GET  /api/models/{model}/panels/{panel}[?variant=V]    answers[V].panels[panel].declaration
//   GET  /api/models/{model}/panels/{panel}/data[?variant=V]                         .data
//   POST /api/models/{model}/panels/{panel}/simulate       body { values?, grid?, variant? }
//
// A simulation is checked against the declaration as the service checks it (a knob the panel
// does not declare, a value outside the bounds of a range knob or none of the choices of a
// choice knob, a grid of other points than 1 to the limit of the declaration, a grid over a
// choice knob of other points than its choices: a 422). The knobs of the grid span the product
// of their values in C order (`knobValues`), every other knob takes its value or its default.
// A point is one request of `simulation/1`: the times of the run of the bundle, the
// pre-initialization of the run, of the target of every knob (its value times its factor, in
// the units of the model) and of its parameter (its value, which the initial assignments of the
// derived targets compiled into the model read), sorted by id, the selections of the model and
// its settings with an absolute tolerance per state. A point which does not integrate is a row
// of `null` in every curve and its flat index is in `status.failed`, as the service answers it.
//
// The runs are shared: the points of one model, end and pre-initialization are one run, so the
// panels of a page which show one state (each its own curves, all selections of the model are
// simulated) cost one scan. A run in flight is joined, a finished one is kept in a cache bounded
// by bytes (`MAX_RUN_BYTES`, the least recently used evicted first). A request whose `signal`
// aborts is rejected with its reason, as `fetch` is; a run is dropped when every request which
// waits for it aborted.
//
// Every answer is a `Response` with a JSON body; an error is `{"detail": "..."}` with the status
// of the service: 404 (a route, a model or a panel which does not exist, an app which is none),
// 405 (a route of another method), 422 (a request which is refused) and 500 (a bundle or a model
// which does not load, a run which fails otherwise than by an integration).
//
// `spec_hash` is the sha256 of the canonical JSON (sorted keys, no whitespace, every character
// which is not ASCII escaped) of the resolved request: the model, the panel, the query `variant`,
// the declaration, the sha256 of the SBML, the value of every knob (its default for one the
// request leaves out), the grid, the engine and the settings. It identifies what was simulated
// by this endpoint; it is not the hash of the service, whose engine and settings differ.

import { EngineError } from "./loader.mjs";
import { createPool, defaultWorkers } from "./pool.mjs";

/** The version of sbmlsim-core (`js/package.json`), which the provenance of a run names. */
export const CORE_VERSION = "0.2.0";

/** The engine a provenance names. */
export const ENGINE = `sbmlsim-core ${CORE_VERSION}`;

/** The contract of a bundle this endpoint reads. */
export const BUNDLE_CONTRACT = "panelbundle/1";

/** The contract of the declaration and of the simulation of a panel. */
export const PANEL_CONTRACT = "panel/1";

/** The bytes of the values of the runs the cache keeps, 64 MiB as the service. */
export const MAX_RUN_BYTES = 64 * 1024 * 1024;

/** The longest id of a knob or a variant a request names, as the service (`MAX_ID`). */
export const MAX_ID = 128;

/** The limits of a request when a declaration has none, the ones of `sbmlsim.panel`. */
const DEFAULT_LIMITS = { knobs: 8, grid: 64 };

/** The fields of the body of a simulation. */
const REQUEST_FIELDS = new Set(["values", "grid", "variant"]);

/** A request which is answered with an error status. */
class HttpError extends Error {
  constructor(status, detail, headers = {}) {
    super(detail);
    this.status = status;
    this.headers = headers;
  }
}

/** A JSON `Response`. */
function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** A list of ids as the service writes it (Python's `repr` of a list of strings). */
function pyList(ids) {
  return `[${ids.map((id) => `'${id}'`).join(", ")}]`;
}

/**
 * The values of a knob which a grid of `n` points over it runs, as `Knob.values` of sbmlsim: the
 * values of the choices of a choice knob, whatever `n` is; for a range knob `min`, then
 * `(min * (n - 1 - i) + max * i) / (n - 1)` for `i` from 1 to `n - 2`, then `max` (`n` 1 gives
 * `min` alone; `n` defaults to `steps`).
 */
export function knobValues(knob, n = knob.steps) {
  if (knob.kind === "choice") return knob.choices.map((choice) => choice.value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`a grid over the knob '${knob.id}' needs a point, not ${n}`);
  const low = knob.min;
  const high = knob.max;
  if (n === 1) return [low];
  const last = n - 1;
  const inner = [];
  for (let i = 1; i < last; i += 1) inner.push((low * (last - i) + high * i) / last);
  return [low, ...inner, high];
}

/**
 * The canonical JSON of a value: the keys of every object sorted, no whitespace, and every
 * character which is not ASCII escaped as `\uXXXX` (as `json.dumps(value, sort_keys=True,
 * separators=(",", ":"))` of Python escapes it). A field whose value is `undefined` is left out.
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null).replace(
      /[\u0080-￿]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${canonicalJson(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 of bytes in plain JavaScript (FIPS 180-4), for a host without `crypto.subtle`. */
function sha256Bytes(bytes) {
  const length = bytes.length;
  const padded = new Uint8Array((((length + 9 + 63) >> 6) << 6));
  padded.set(bytes);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(length / 0x20000000));
  view.setUint32(padded.length - 4, (length << 3) >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + 4 * i);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    let [a, b, c, d, e, f, g, k] = h;
    for (let i = 0; i < 64; i += 1) {
      const t1 = k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA256_K[i] + w[i];
      const t2 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
      k = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += k;
  }
  const digest = new Uint8Array(32);
  const out = new DataView(digest.buffer);
  h.forEach((word, i) => out.setUint32(4 * i, word));
  return digest;
}

/**
 * The sha256 of a text (encoded as UTF-8) as 64 lower case hexadecimal digits: `crypto.subtle`
 * where the host has it (a browser has it only in a secure context, HTTPS or localhost), else
 * the same digest in plain JavaScript.
 */
export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = globalThis.crypto?.subtle
    ? new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes))
    : sha256Bytes(bytes);
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The digest in plain JavaScript, for the tests (`sha256Hex` takes `crypto.subtle` first). */
export function sha256HexFallback(text) {
  return Array.from(sha256Bytes(new TextEncoder().encode(text)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The route of a path (the part of a URL from `/api/` on, without its query). */
function route(path) {
  const parts = path.split("/").slice(1).map((part) => decodeURIComponent(part));
  // ["api", "models", model, ...]
  if (parts.length < 4 || parts[0] !== "api" || parts[1] !== "models") return null;
  const model = parts[2];
  if (parts.length === 4 && parts[3] === "app") return { name: "app", method: "GET", model };
  if (parts[3] !== "panels" || parts.length < 5) return null;
  const panel = parts[4];
  if (parts.length === 5) return { name: "panel", method: "GET", model, panel };
  if (parts.length === 6 && parts[5] === "data") return { name: "data", method: "GET", model, panel };
  if (parts.length === 6 && parts[5] === "simulate") return { name: "simulate", method: "POST", model, panel };
  return null;
}

/** The method, the URL, the body and the signal of the arguments of `fetch`. */
async function readInput(input, init) {
  const request = typeof input === "object" && input !== null && typeof input.method === "string" && !(input instanceof URL) ? input : null;
  const url = String(request ? request.url : input);
  const method = String(init.method ?? request?.method ?? "GET").toUpperCase();
  const signal = init.signal ?? request?.signal ?? undefined;
  let body = init.body ?? null;
  if (body === null && request && method !== "GET" && method !== "HEAD") body = await request.text();
  else if (body !== null && typeof body !== "string") body = await new Response(body).text();
  return { url, method, signal, body };
}

/**
 * Reads the body of a simulation as the service reads a `SimulateRequest`: `values` a mapping of
 * knob ids to finite numbers, `grid` a mapping of knob ids to whole numbers of points, at least 1,
 * `variant` a text; ids of at most `MAX_ID` characters, no other field.
 */
function readBody(text) {
  let body;
  try {
    body = text === null || text === "" ? {} : JSON.parse(text);
  } catch {
    throw new HttpError(422, "The body of a simulation is no JSON.");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(422, "The body of a simulation is no JSON object.");
  }
  const unknown = Object.keys(body).filter((key) => !REQUEST_FIELDS.has(key));
  if (unknown.length > 0) {
    throw new HttpError(422, `The body of a simulation has the unknown fields ${pyList(unknown.sort())}; its fields are ['grid', 'values', 'variant'].`);
  }
  const mapping = (name) => {
    const value = body[name] ?? {};
    if (typeof value !== "object" || Array.isArray(value)) throw new HttpError(422, `The field '${name}' is no mapping of knob ids.`);
    for (const id of Object.keys(value)) {
      if (id.length > MAX_ID) throw new HttpError(422, `A knob id of the field '${name}' is longer than ${MAX_ID} characters.`);
    }
    return value;
  };
  const values = mapping("values");
  for (const [id, value] of Object.entries(values)) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new HttpError(422, `The value of the knob '${id}' is no finite number.`);
    }
  }
  const grid = mapping("grid");
  for (const [id, n] of Object.entries(grid)) {
    if (!Number.isInteger(n) || n < 1) throw new HttpError(422, `The points of the grid over the knob '${id}' are no whole number of at least 1.`);
  }
  const variant = body.variant ?? "";
  if (typeof variant !== "string" || variant.length > MAX_ID) {
    throw new HttpError(422, `The variant is no text of at most ${MAX_ID} characters.`);
  }
  return { values, grid, variant };
}

/**
 * Checks a request against the limits of its declaration (`limits` of `panel/1`): at most
 * `knobs` values and knobs of the grid, at most `grid` points per knob and in all.
 */
function checkLimits(values, grid, limits) {
  for (const [name, mapping] of [["values", values], ["grid", grid]]) {
    const n = Object.keys(mapping).length;
    if (n > limits.knobs) throw new HttpError(422, `The field '${name}' names ${n} knobs, over the limit of ${limits.knobs}.`);
  }
  let points = 1;
  for (const [id, n] of Object.entries(grid)) {
    if (n > limits.grid) throw new HttpError(422, `The grid of ${n} points over the knob '${id}' is over the limit of ${limits.grid} points of a request.`);
    points *= n;
  }
  if (points > limits.grid) {
    throw new HttpError(422, `The grid of ${points} points is over the limit of ${limits.grid} points of a request.`);
  }
}

/** Checks the knob ids and the values of a request against the declaration (`check_knobs`, `check_values`). */
function checkKnobs(panelId, knobs, values, grid) {
  const ids = knobs.map((knob) => knob.id);
  const unknown = [...new Set([...Object.keys(values), ...Object.keys(grid)])].filter((id) => !ids.includes(id)).sort();
  if (unknown.length > 0) {
    throw new HttpError(422, `${pyList(unknown)} are no knobs of the panel '${panelId}', which has ${pyList([...ids].sort())}.`);
  }
  const byId = new Map(knobs.map((knob) => [knob.id, knob]));
  for (const [id, value] of Object.entries(values)) {
    const knob = byId.get(id);
    let taken = "";
    if (knob.kind === "choice") {
      const choices = knob.choices.map((choice) => choice.value);
      if (!choices.includes(value)) taken = `none of the choices [${choices.join(", ")}]`;
    } else if (knob.min != null && knob.max != null && !(knob.min <= value && value <= knob.max)) {
      taken = `outside the bounds [${knob.min}, ${knob.max}]`;
    }
    if (taken) throw new HttpError(422, `The value ${value} of the knob '${id}' of the panel '${panelId}' is ${taken}.`);
  }
  for (const [id, n] of Object.entries(grid)) {
    const knob = byId.get(id);
    if (knob.kind === "choice" && n !== knob.choices.length) {
      throw new HttpError(
        422,
        `A grid of ${n} points over the knob '${id}' of the panel '${panelId}' is none it runs: a grid over it runs its ${knob.choices.length} choices.`,
      );
    }
  }
}

/** A promise which rejects with the reason of `signal` when it aborts first. */
function abortable(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/** The points of a grid in C order (the first axis slowest): one array of values per point. */
function product(axes) {
  let points = [[]];
  for (const axis of axes) {
    const next = [];
    for (const point of points) for (const value of axis.values) next.push([...point, value]);
    points = next;
  }
  return points;
}

/** The runs of the points of a model, shared by the requests of one state (see the module comment). */
class Runs {
  constructor(maxBytes) {
    this.maxBytes = maxBytes;
    this.bytes = 0;
    this.inflight = new Map();
    this.done = new Map();
  }

  /**
   * The results of the run of `key` (one per point, `null` for a point which failed): a stored
   * one, a run in flight, or a new one of `start(signal)`, whose signal aborts when every
   * request which waits for it aborted or when the run failed.
   */
  get(key, start, signal) {
    signal?.throwIfAborted();
    const stored = this.done.get(key);
    if (stored) {
      this.done.delete(key);
      this.done.set(key, stored);
      return Promise.resolve(stored.results);
    }
    let entry = this.inflight.get(key);
    if (!entry) {
      const controller = new AbortController();
      entry = { controller, waiters: 0 };
      entry.promise = start(controller.signal).then(
        (results) => {
          if (this.inflight.get(key) === entry) this.inflight.delete(key);
          this.store(key, results);
          return results;
        },
        (error) => {
          if (this.inflight.get(key) === entry) this.inflight.delete(key);
          controller.abort(error); // the points which still wait in the queue
          throw error;
        },
      );
      entry.promise.catch(() => {}); // a run nobody waits for any more
      this.inflight.set(key, entry);
    }
    entry.waiters += 1;
    if (!signal) return entry.promise;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        entry.waiters -= 1;
        if (entry.waiters === 0) {
          if (this.inflight.get(key) === entry) this.inflight.delete(key);
          entry.controller.abort(signal.reason);
        }
        reject(signal.reason);
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
      entry.promise.then(
        (results) => {
          signal.removeEventListener("abort", onAbort);
          resolve(results);
        },
        (error) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
    });
  }

  /** Keeps the results of a run, evicting the least recently used ones beyond the bound. */
  store(key, results) {
    const bytes = results.reduce((sum, result) => sum + (result ? result.values.byteLength : 0), 0);
    if (bytes > this.maxBytes) return;
    this.done.set(key, { results, bytes });
    this.bytes += bytes;
    for (const [old, entry] of this.done) {
      if (this.bytes <= this.maxBytes) break;
      this.done.delete(old);
      this.bytes -= entry.bytes;
    }
  }
}

/**
 * Creates the endpoint of a bundle: a function `(url, init) => Promise<Response>` with the
 * signature of `fetch`, see the module comment. Options:
 *
 * - `bundle`: the URL of `bundle.json` (a string, relative to the page, or a `URL`).
 * - `runtime`: `{ engine, mathlib }`, URLs of `engine.wasm` and `mathlib.wasm` (or their
 *   `WebAssembly.Module`s or bytes); `./runtime/*.wasm` next to this module without.
 * - `workers`: the most workers of the pool (`defaultWorkers()` of `pool.mjs` without).
 * - `createWorker`: creates a worker of the pool (`createPool` of `pool.mjs`).
 * - `pool`: a pool of `createPool` to run on instead of one of its own (e.g. shared by the
 *   endpoints of several bundles), which `close()` leaves open.
 * - `fetch`: loads the files of the bundle and the runtime (`globalThis.fetch` without).
 * - `maxRunBytes`: the bound of the cache of the runs (`MAX_RUN_BYTES` without).
 *
 * The function has `close()`, which terminates the workers of its own pool.
 */
export function createPanelEndpoint(options) {
  const {
    bundle,
    runtime = {
      engine: new URL("./runtime/engine.wasm", import.meta.url),
      mathlib: new URL("./runtime/mathlib.wasm", import.meta.url),
    },
    workers = defaultWorkers(),
    createWorker,
    pool: givenPool = null,
    fetch: load = (url) => globalThis.fetch(url),
    maxRunBytes = MAX_RUN_BYTES,
  } = options;
  if (bundle === undefined || bundle === null) throw new Error("createPanelEndpoint needs the URL of a bundle");
  const bundleUrl = new URL(String(bundle), globalThis.location?.href);
  const runs = new Runs(maxRunBytes);
  const models = new Map();
  let loading = null;
  let ownPool = null;
  let closed = false;

  /** The bytes of a file of the bundle or of the runtime. */
  const bytesOf = async (url) => {
    const response = await load(url);
    if (!response.ok) throw new Error(`${url} answers ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  };

  /** A runtime module as given (a Module or bytes) or loaded from its URL. */
  const runtimeModule = async (source) =>
    source instanceof WebAssembly.Module || ArrayBuffer.isView(source) || source instanceof ArrayBuffer
      ? source
      : bytesOf(new URL(String(source), globalThis.location?.href));

  /** The bundle and the pool, loaded once (again after a failure). */
  const loaded = () => {
    if (!loading) {
      loading = (async () => {
        const response = await load(bundleUrl);
        if (!response.ok) throw new Error(`${bundleUrl} answers ${response.status}`);
        const data = await response.json();
        if (data?.contract !== BUNDLE_CONTRACT) {
          throw new Error(`the bundle is of the contract ${data?.contract}, not ${BUNDLE_CONTRACT}`);
        }
        let pool = givenPool;
        if (!pool) {
          const [engine, mathlib] = await Promise.all([runtimeModule(runtime.engine), runtimeModule(runtime.mathlib)]);
          if (closed) throw new Error("the endpoint is closed");
          ownPool = await createPool({ engine, mathlib, workers, ...(createWorker ? { createWorker } : {}) });
          if (closed) ownPool.close();
          pool = ownPool;
        }
        return { bundle: data, pool };
      })();
      loading.catch(() => {
        loading = null;
      });
    }
    return loading;
  };

  /**
   * A model of the bundle in the pool, loaded once (again after a failure): its selections and
   * its settings with the absolute tolerance per state in the order of the states of its
   * `model.json`.
   */
  const modelOf = (bundleData, pool, key) => {
    let model = models.get(key);
    if (!model) {
      model = (async () => {
        const entry = bundleData.models?.[key];
        if (!entry) throw new Error(`the bundle has no model ${key}`);
        const dir = String(entry.compiled).replace(/\/+$/, "");
        const [wasm, text] = await Promise.all([
          bytesOf(new URL(`${dir}/model.wasm`, bundleUrl)),
          bytesOf(new URL(`${dir}/model.json`, bundleUrl)).then((bytes) => new TextDecoder().decode(bytes)),
        ]);
        const description = JSON.parse(text);
        const settings = { ...entry.settings };
        const tolerances = entry.absolute_tolerances ?? {};
        if (Object.keys(tolerances).length > 0) {
          const scalar = settings.absolute_tolerance?.scalar;
          settings.absolute_tolerance = {
            per_state: description.states.map((state) => {
              const value = tolerances[state.id] ?? scalar;
              if (typeof value !== "number") {
                throw new Error(`the model ${key} has no absolute tolerance of its state ${state.id}`);
              }
              return value;
            }),
          };
        }
        const poolKey = `${bundleUrl.href}#${key}`;
        if (!pool.hasModel(poolKey)) {
          // another endpoint on the same pool may have added it meanwhile
          await pool.addModel(poolKey, wasm, text).catch((error) => {
            if (!pool.hasModel(poolKey)) throw error;
          });
        }
        return { poolKey, selections: entry.selections, settings };
      })();
      model.catch(() => models.delete(key));
      models.set(key, model);
    }
    return model;
  };

  /** The answers of the query `variant` of a request. */
  const answersOf = (bundleData, model, variant) => {
    if (variant.length > MAX_ID) throw new HttpError(422, `The variant is no text of at most ${MAX_ID} characters.`);
    const answers = bundleData.answers?.[variant];
    if (!answers) {
      const variants = Object.keys(bundleData.answers ?? {}).filter((name) => name !== "").sort();
      throw new HttpError(422, `The model '${model}' has no variant '${variant}'; its variants are ${pyList(variants)}.`);
    }
    return answers;
  };

  /** The answers of a panel of a query `variant`. */
  const panelOf = (bundleData, model, panel, variant) => {
    const answer = answersOf(bundleData, model, variant).panels?.[panel];
    if (!answer) {
      const within = variant === "" ? "" : ` in its variant '${variant}'`;
      throw new HttpError(404, `'${panel}' is no panel of the model '${model}'${within}.`);
    }
    return answer;
  };

  /** Runs a simulation of a panel. */
  const simulate = async (bundleData, pool, model, panel, text, signal) => {
    const started = globalThis.performance?.now() ?? Date.now();
    const { values, grid, variant } = readBody(text);
    const answer = panelOf(bundleData, model, panel, variant);
    const declaration = answer.declaration;
    checkLimits(values, grid, { ...DEFAULT_LIMITS, ...declaration.limits });
    const knobs = declaration.axes ?? [];
    checkKnobs(panel, knobs, values, grid);
    const run = answer.run;
    const info = await abortable(modelOf(bundleData, pool, run.model), signal);

    const axes = knobs
      .filter((knob) => knob.id in grid)
      .map((knob) => ({
        id: knob.id,
        label: knob.label,
        unit: run.knobs?.[knob.id]?.unit ?? null,
        values: knobValues(knob, grid[knob.id]),
      }));
    const fixed = {};
    for (const knob of knobs) if (!(knob.id in grid)) fixed[knob.id] = values[knob.id] ?? knob.default;
    const points = product(axes).map((point) => {
      const state = { ...fixed };
      axes.forEach((axis, i) => {
        state[axis.id] = point[i];
      });
      const preinit = new Map(run.preinit ?? []);
      for (const knob of knobs) {
        const spec = run.knobs?.[knob.id];
        if (!spec) throw new Error(`the run of the panel ${panel} has no knob ${knob.id}`);
        if (spec.target !== null && spec.target !== undefined) preinit.set(spec.target, state[knob.id] * spec.factor);
        if (spec.parameter !== null && spec.parameter !== undefined) preinit.set(spec.parameter, state[knob.id]);
      }
      return [...preinit].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    });

    const runKey = JSON.stringify([run.model, run.start, run.end, run.points, points]);
    const results = await runs.get(
      runKey,
      async (runSignal) => {
        const requests = points.map((preinit) => ({
          contract: "simulation/1",
          start: run.start,
          end: run.end,
          output: { uniform: { steps: run.points } },
          preinit,
          changes: [],
          steady_state: null,
          selections: info.selections,
          settings: info.settings,
        }));
        // an error of the engine is a point which failed, any other error fails the run
        return Promise.all(
          requests.map((request) =>
            pool.simulate(info.poolKey, request, { signal: runSignal }).catch((error) => {
              if (error instanceof EngineError) return null;
              throw error;
            }),
          ),
        );
      },
      signal,
    );

    const failed = [];
    const curves = {};
    for (const curve of declaration.curves ?? []) curves[curve.id] = [];
    results.forEach((result, index) => {
      if (result === null) failed.push(index);
      if (result !== null && result.nRows !== run.x.length) {
        throw new Error(`the run of the panel ${panel} has ${result.nRows} rows, its x ${run.x.length}`);
      }
      for (const curve of declaration.curves ?? []) {
        const spec = run.curves?.[curve.id];
        if (!spec) throw new Error(`the run of the panel ${panel} has no curve ${curve.id}`);
        if (result === null) {
          curves[curve.id].push(run.x.map(() => null));
          continue;
        }
        const width = result.columns.length;
        const column = result.columns.indexOf(spec.selection);
        if (column < 0) throw new Error(`the model ${run.model} does not select ${spec.selection}`);
        const row = new Array(result.nRows);
        for (let r = 0; r < result.nRows; r += 1) {
          const value = result.values[r * width + column] * spec.factor;
          row[r] = Number.isFinite(value) ? value : null;
        }
        curves[curve.id].push(row);
      }
    });

    const resolvedValues = {};
    for (const knob of knobs) if (!(knob.id in grid)) resolvedValues[knob.id] = fixed[knob.id];
    const resolvedGrid = {};
    for (const knob of knobs) if (knob.id in grid) resolvedGrid[knob.id] = grid[knob.id];
    const modelEntry = bundleData.models[run.model];
    const specHash = await sha256Hex(
      canonicalJson({
        contract: PANEL_CONTRACT,
        model,
        panel,
        variant,
        declaration,
        model_sha256: run.model_sha256,
        values: resolvedValues,
        grid: resolvedGrid,
        engine: ENGINE,
        settings: { settings: modelEntry.settings, absolute_tolerances: modelEntry.absolute_tolerances ?? {} },
      }),
    );
    const finished = globalThis.performance?.now() ?? Date.now();
    return {
      contract: PANEL_CONTRACT,
      spec_hash: specHash,
      x: run.x,
      dims: axes,
      curves,
      units: run.units,
      provenance: {
        model,
        panel,
        model_sha256: run.model_sha256,
        variant: run.variant,
        engine: ENGINE,
        sbmlsim: bundleData.sbmlsim,
        seconds: (finished - started) / 1000,
        created: new Date().toISOString(),
      },
      status: { ok: failed.length === 0, points: results.length, failed },
    };
  };

  async function endpoint(input, init = {}) {
    const { url, method, signal, body } = await readInput(input, init ?? {});
    signal?.throwIfAborted();
    try {
      const at = url.indexOf("/api/");
      const [path, query = ""] = (at < 0 ? "" : url.slice(at)).split("#")[0].split("?");
      let target;
      try {
        target = route(path);
      } catch {
        target = null; // a path which does not decode
      }
      if (!target) throw new HttpError(404, "Not Found");
      if (method !== target.method) throw new HttpError(405, "Method Not Allowed", { allow: target.method });
      const { bundle: data, pool } = await abortable(
        loaded().catch((error) => {
          throw new HttpError(500, `The bundle ${bundleUrl} could not be loaded: ${error.message}`);
        }),
        signal,
      );
      if (target.model !== data.model) throw new HttpError(404, `'${target.model}' is no model of this service.`);
      if (target.name === "simulate") {
        let answer;
        try {
          answer = await simulate(data, pool, target.model, target.panel, body, signal);
        } catch (error) {
          if (error instanceof HttpError || error === signal?.reason) throw error;
          throw new HttpError(500, `The panel '${target.panel}' of the model '${target.model}' did not run: ${error.message}`);
        }
        return json(200, answer);
      }
      const variant = new URLSearchParams(query).get("variant") ?? "";
      if (target.name === "app") {
        const app = answersOf(data, target.model, variant).app;
        if (app === null || app === undefined) throw new HttpError(404, `The model '${target.model}' declares no app.`);
        return json(200, app);
      }
      const answer = panelOf(data, target.model, target.panel, variant);
      return json(200, target.name === "panel" ? answer.declaration : answer.data);
    } catch (error) {
      if (signal?.aborted && error === signal.reason) throw error;
      if (error instanceof HttpError) return json(error.status, { detail: error.message }, error.headers);
      return json(500, { detail: `The endpoint failed: ${error?.message ?? error}` });
    }
  }

  /** Terminates the workers of the pool of the endpoint (not of a pool it was given). */
  endpoint.close = () => {
    closed = true;
    ownPool?.close();
  };

  return endpoint;
}
