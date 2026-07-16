"use strict";

const { createHash, webcrypto } = require("node:crypto");

/**
 * GraphIngest Orchestrator JavaScript Client (CommonJS).
 *
 * Mirrors `sdk/typescript/src/client.ts`. All public endpoints require a
 * per-user API key from the dashboard (Settings → API Keys); set
 * `GRAPHINGEST_API_KEY` or pass it to the constructor.
 *
 * Worker-callback methods (`reportTaskCompleted`, `reportTaskFailed`)
 * authenticate with `WORKER_CALLBACK_SECRET` and are intended for custom
 * worker images, not regular SDK users.
 */

class MissingAPIKeyError extends Error {
  constructor(message) {
    super(
      message ||
        "GraphIngestClient requires an apiKey. Generate one in the dashboard under Settings → API Keys, then set GRAPHINGEST_API_KEY."
    );
    this.name = "MissingAPIKeyError";
  }
}

class GraphIngestClient {
  constructor(baseUrl, apiKey) {
    // Accept (baseUrl, apiKey) positional or ({baseUrl, apiKey}) options bag.
    if (baseUrl && typeof baseUrl === "object") {
      apiKey = baseUrl.apiKey;
      baseUrl = baseUrl.baseUrl;
    }

    this.baseUrl = (
      baseUrl ||
      process.env.GRAPHINGEST_API_URL ||
      process.env.INGEST_API_URL ||
      ""
    ).replace(/\/+$/, "");

    this.apiKey =
      apiKey ||
      process.env.GRAPHINGEST_API_KEY ||
      process.env.INGEST_API_KEY ||
      "";

    if (!this.baseUrl) {
      throw new Error(
        "GraphIngestClient requires baseUrl or GRAPHINGEST_API_URL"
      );
    }
    if (!this.apiKey) {
      throw new MissingAPIKeyError();
    }
  }

  async _request(path, method, body) {
    const res = await fetch(this.baseUrl + path, {
      method: method || "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + this.apiKey,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error("GraphIngest API error " + res.status + ": " + text);
    }
    return res.json();
  }

  /** Generic POST — kept for backwards-compat. */
  async post(path, body) {
    return this._request(path, "POST", body);
  }

  // ── Worker-internal ───────────────────────────────────────────

  async reportTaskCompleted(payload) {
    return this._request("/api/webhook/worker-callback", "POST", {
      ...payload,
      status: "COMPLETED",
    });
  }

  async reportTaskFailed(payload) {
    return this._request("/api/webhook/worker-callback", "POST", {
      ...payload,
      status: "FAILED",
    });
  }

  // ── User-facing SDK API ───────────────────────────────────────

  async sendLogs(flowRunId, logs) {
    if (!logs || !logs.length) return { data: [] };
    return this._request("/api/runs/" + flowRunId + "/logs", "POST", logs);
  }

  async createArtifact(flowRunId, artifact) {
    return this._request(
      "/api/runs/" + flowRunId + "/artifacts",
      "POST",
      artifact
    );
  }

  async triggerFlowRun(flowId, parameters) {
    return this._request("/api/flows/" + flowId + "/runs", "POST", {
      parameters: parameters || {},
    });
  }

  async dispatchNodes(graphRunId, nodeKey, inputs) {
    return this._request("/api/nodes/dispatch", "POST", {
      graphRunId,
      nodeKey,
      inputs,
    });
  }

  async pollTaskRuns(taskRunIds) {
    return this._request("/api/nodes/status", "POST", { taskRunIds });
  }

  async acquireFlowControl(opts) {
    return this._request("/api/flow-control", "POST", {
      action: "acquire",
      graphName: opts.graphName,
      graphRunId: opts.graphRunId,
      concurrencyLimit: opts.concurrencyLimit || 0,
      concurrencyKey: opts.concurrencyKey || "",
      throttleLimit: opts.throttleLimit || 0,
      throttlePeriodSeconds: opts.throttlePeriodSeconds || 0,
      priority: opts.priority || 0,
    });
  }

  async releaseFlowControl(graphName, graphRunId) {
    return this._request("/api/flow-control", "POST", {
      action: "release",
      graphName,
      graphRunId,
    });
  }

  // ── Hashing (canonical form must match server + Python SDK) ───

  static computeInputHash(taskKey, inputData) {
    const canonical = canonicalJSONStringify({ taskKey, inputData });
    return createHash("sha256").update(canonical, "utf8").digest("hex");
  }

  static async computeInputHashAsync(taskKey, inputData) {
    const canonical = canonicalJSONStringify({ taskKey, inputData });
    const subtle =
      (globalThis.crypto && globalThis.crypto.subtle) || webcrypto.subtle;
    const buf = await subtle.digest(
      "SHA-256",
      new TextEncoder().encode(canonical)
    );
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
}

function canonicalJSONStringify(value) {
  function stringify(v) {
    if (v === null) return "null";
    const t = typeof v;
    if (t === "number") {
      if (!Number.isFinite(v)) {
        throw new TypeError("Cannot serialize non-finite number for hashing");
      }
      return JSON.stringify(v);
    }
    if (t === "string" || t === "boolean") return JSON.stringify(v);
    if (t === "bigint") return JSON.stringify(v.toString());
    if (Array.isArray(v)) {
      return "[" + v.map((x) => stringify(x === undefined ? null : x)).join(",") + "]";
    }
    if (t === "object") {
      const entries = Object.entries(v)
        .filter(([, val]) => val !== undefined && typeof val !== "function")
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return (
        "{" +
        entries
          .map(([k, val]) => JSON.stringify(k) + ":" + stringify(val))
          .join(",") +
        "}"
      );
    }
    return "null";
  }
  return stringify(value);
}

let _default;
function getClient() {
  if (!_default) _default = new GraphIngestClient();
  return _default;
}

module.exports = { GraphIngestClient, getClient, MissingAPIKeyError };
