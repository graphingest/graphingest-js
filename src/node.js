"use strict";

const { randomUUID } = require("crypto");

// ---------------------------------------------------------------------------
// Platform limits (tier-based)
// ---------------------------------------------------------------------------

const PLATFORM_LIMITS = {
  free: {
    nodeDefaultTimeout: 300,       // 5 min
    nodeMaxTimeout: 600,           // 10 min
    graphDefaultTimeout: 900,      // 15 min
    graphMaxTimeout: 1800,         // 30 min
    monthlyExecutionMinutes: 60,   // 60 min/mo total
    maxPipelines: 5,
  },
  pro: {
    nodeDefaultTimeout: 600,       // 10 min
    nodeMaxTimeout: 3600,          // 60 min
    graphDefaultTimeout: 3600,     // 1 hr
    graphMaxTimeout: 21600,        // 6 hr
    monthlyExecutionMinutes: 0,    // unlimited
    maxPipelines: 0,               // unlimited
  },
  enterprise: {
    nodeDefaultTimeout: 3600,      // 60 min
    nodeMaxTimeout: 86400,         // 24 hr
    graphDefaultTimeout: 21600,    // 6 hr
    graphMaxTimeout: 86400,        // 24 hr
    monthlyExecutionMinutes: 0,    // unlimited
    maxPipelines: 0,               // unlimited
  },
};

function _getTier() {
  return (process.env.GRAPHINGEST_TIER || "free").toLowerCase();
}

function _getLimits() {
  return PLATFORM_LIMITS[_getTier()] || PLATFORM_LIMITS.free;
}

function _clampTimeout(requested, defaultKey, maxKey) {
  const limits = _getLimits();
  if (requested == null || requested <= 0) return limits[defaultKey];
  if (requested > limits[maxKey]) {
    console.warn(
      `[graphingest] Requested timeout ${requested}s exceeds ${_getTier()} tier max (${limits[maxKey]}s). Clamped.`
    );
    return limits[maxKey];
  }
  return requested;
}

function _withTimeout(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs / 1000}s`)),
      timeoutMs
    );
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

/**
 * Create a node — a single unit of work on managed infrastructure.
 *
 * @param {object} opts - { name: string, cacheTtl?: number, timeoutSeconds?: number }
 * @param {function} fn - async (input) => result
 * @returns {function} Wrapped function with .run(), .map(), .arun()
 *
 * @example
 * const extract = node({ name: "extract" }, async (url) => {
 *   return { url, rows: 100 };
 * });
 *
 * const result = await extract.run("https://example.com");
 * const results = await extract.map(["url1", "url2"]);
 */
function node(opts, fn) {
  if (!opts || !opts.name) throw new Error("node: opts.name is required");

  const nodeKey = opts.name;

  // The callable itself
  async function wrapper(input) {
    return wrapper.run(input);
  }

  wrapper._nodeKey = nodeKey;
  wrapper._cacheTtl = opts.cacheTtl || 0;
  wrapper._description = opts.description || "";
  wrapper._paramSchema = opts.paramSchema || null;
  wrapper._originalFn = fn;

  /**
   * Sync (awaitable) execution.
   */
  const _nodeTimeout = _clampTimeout(opts.timeoutSeconds, "nodeDefaultTimeout", "nodeMaxTimeout");

  wrapper.run = async function (input) {
    const runId = randomUUID();
    console.log(`[graphingest] Starting node: ${nodeKey} (run=${runId}, timeout=${_nodeTimeout}s)`);
    const start = Date.now();

    const result = await _withTimeout(
      fn(input),
      _nodeTimeout * 1000,
      `Node ${nodeKey}`
    );

    const duration = Date.now() - start;
    console.log(`[graphingest] Node ${nodeKey} completed in ${duration}ms`);
    return result;
  };

  /**
   * Fan-out: parallel execution across multiple inputs.
   */
  wrapper.map = async function (inputs, opts) {
    console.log(
      `[graphingest] Mapping ${inputs.length} invocations of node ${nodeKey}`
    );
    return Promise.all(inputs.map((input) => wrapper.run(input)));
  };

  /**
   * Async dispatch: returns a promise-like future.
   */
  wrapper.arun = function (input) {
    const promise = wrapper.run(input);
    return {
      result: (timeout) => {
        if (!timeout) return promise;
        return Promise.race([
          promise,
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error(`NodeFuture timed out after ${timeout}ms`)),
              timeout
            )
          ),
        ]);
      },
      then: (resolve, reject) => promise.then(resolve, reject),
    };
  };

  return wrapper;
}

module.exports = { node, PLATFORM_LIMITS };
