"use strict";

const { randomUUID } = require("crypto");
const { PLATFORM_LIMITS } = require("./node");

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
 * Create a graph — orchestrates multiple nodes with retry, timeout, and hooks.
 *
 * @param {object} opts - { name, version?, tags?, timeoutSeconds?, retryPolicy?, hooks? }
 * @param {function} fn - async (...args) => result
 * @returns {function} Wrapped graph function with .run()
 *
 * @example
 * const pipeline = graph({ name: "etl", retryPolicy: { maxRetries: 3 } },
 *   async (url) => {
 *     const data = await extract.run(url);
 *     return transform.run(data);
 *   });
 *
 * const result = await pipeline.run("https://example.com");
 */
function graph(opts, fn) {
  if (!opts || !opts.name) throw new Error("graph: opts.name is required");

  const graphName = opts.name;
  const retryPolicy = opts.retryPolicy || null;
  const maxAttempts = retryPolicy ? (retryPolicy.maxRetries || 0) + 1 : 1;
  const _graphTimeout = _clampTimeout(opts.timeoutSeconds, "graphDefaultTimeout", "graphMaxTimeout");

  async function wrapper(...args) {
    return wrapper.run(...args);
  }

  wrapper._graphName = graphName;
  wrapper._version = opts.version || null;
  wrapper._tags = opts.tags || [];

  wrapper.run = async function (...args) {
    const runId = randomUUID();
    console.log(`[graphingest] Starting graph: ${graphName} (run=${runId})`);
    const start = Date.now();

    let lastError;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        const delay = _computeDelay(retryPolicy, attempt - 1);
        console.warn(
          `[graphingest] Graph ${graphName}: retry ${attempt}/${retryPolicy.maxRetries} after ${delay}ms`
        );
        await new Promise((r) => setTimeout(r, delay));
      }

      try {
        const result = await _withTimeout(
          fn(...args),
          _graphTimeout * 1000,
          `Graph ${graphName}`
        );
        const duration = Date.now() - start;
        console.log(
          `[graphingest] Graph ${graphName} completed in ${duration}ms`
        );
        return result;
      } catch (err) {
        lastError = err;
        console.error(
          `[graphingest] Graph ${graphName} attempt ${attempt + 1} failed: ${err.message}`
        );
      }
    }

    throw new Error(
      `graphingest: Graph ${graphName} failed after ${maxAttempts} attempts: ${lastError.message}`
    );
  };

  return wrapper;
}

function _computeDelay(policy, attempt) {
  if (!policy || !policy.delaySeconds) return 0;
  const factor = policy.backoffFactor || 2;
  const maxDelay = policy.maxDelaySeconds || 120;
  let delay = policy.delaySeconds * Math.pow(factor, attempt);
  delay = Math.min(delay, maxDelay);
  if (policy.jitter !== false) {
    delay *= 0.5 + Math.random();
  }
  return delay * 1000;
}

module.exports = { graph };
