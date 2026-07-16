"use strict";

const PLATFORM_TIERS = {
  standard: "gemini-2.5-flash",
  high: "gemini-2.5-pro",
};

/**
 * Generate tool schemas from node functions for LLM tool-calling.
 *
 * @param {Array<{name: string, description: string, parameters?: object, fn: function}>} defs
 * @returns {Array<object>} OpenAI-compatible tool schemas
 */
function toolsFromNodes(defs) {
  return defs.map((d) => {
    const props = d.parameters || { input: { type: "string" } };
    const required = d.required || Object.keys(props);
    return {
      type: "function",
      function: {
        name: d.name,
        description: d.description || "",
        parameters: { type: "object", properties: props, required },
      },
    };
  });
}

/**
 * Run a ReAct loop: LLM reasons → picks tools → tools execute → repeat.
 *
 * @param {object} opts
 * @param {string} opts.query - The user's question or task
 * @param {Array} opts.tools - Tool definitions
 * @param {string} [opts.model="standard"] - Model name or tier
 * @param {string} [opts.systemPrompt] - System prompt
 * @param {number} [opts.maxIterations=10] - Max reasoning loops
 * @param {number} [opts.temperature=0] - LLM temperature
 * @returns {Promise<{answer: string, toolCalls: Array, steps: number, elapsedSeconds: number, model: string}>}
 *
 * @example
 * const result = await react({
 *   query: "Research fusion energy",
 *   tools: [searchTool],
 *   model: "standard",
 * });
 */
async function react(opts) {
  const model = opts.model || "standard";
  const maxIter = opts.maxIterations || 10;
  const temperature = opts.temperature || 0;

  const { provider, resolvedModel } = _getProvider(model);
  const schemas = toolsFromNodes(opts.tools);

  // Tool lookup
  const toolMap = {};
  for (const t of opts.tools) toolMap[t.name] = t;

  // Initial messages
  const messages = [];
  if (opts.systemPrompt) {
    messages.push({ role: "system", content: opts.systemPrompt });
  }
  messages.push({ role: "user", content: opts.query });

  const allToolCalls = [];
  const start = Date.now();

  for (let step = 0; step < maxIter; step++) {
    const response = await _chatOpenAI(
      provider,
      messages,
      schemas,
      temperature,
      resolvedModel
    );

    // Append assistant message
    _appendAssistant(messages, response);

    // No tool calls → done
    if (!response.toolCalls || response.toolCalls.length === 0) {
      return {
        answer: response.content,
        toolCalls: allToolCalls,
        steps: step + 1,
        elapsedSeconds: (Date.now() - start) / 1000,
        model,
      };
    }

    // Execute tool calls
    for (const tc of response.toolCalls) {
      const tool = toolMap[tc.name];
      let toolResult;
      if (!tool) {
        toolResult = `Unknown tool: ${tc.name}`;
      } else {
        try {
          toolResult = await tool.fn(tc.arguments);
          if (typeof toolResult !== "string") toolResult = JSON.stringify(toolResult);
        } catch (err) {
          toolResult = `Error: ${err.message}`;
        }
      }

      allToolCalls.push({ tool: tc.name, args: tc.arguments, result: toolResult });
      messages.push({ role: "tool", tool_call_id: tc.id, content: toolResult });
    }
  }

  return {
    answer: `Max iterations (${maxIter}) reached without a final answer.`,
    toolCalls: allToolCalls,
    steps: maxIter,
    elapsedSeconds: (Date.now() - start) / 1000,
    model,
  };
}

/**
 * One-liner agent: combines graph + ReAct loop.
 *
 * @param {object} opts
 * @param {string} opts.name - Agent name
 * @param {Array} opts.tools - Tool definitions
 * @param {string} [opts.model="standard"] - Model name or tier
 * @param {string} [opts.systemPrompt] - System prompt
 * @param {number} [opts.maxIterations=10] - Max loops
 * @param {number} [opts.temperature=0] - LLM temperature
 * @returns {function} agent(query) → Promise<string>
 *
 * @example
 * const researcher = agent({
 *   name: "researcher",
 *   tools: [searchTool],
 *   model: "standard",
 *   systemPrompt: "You are a research assistant.",
 * });
 * const answer = await researcher("What is quantum computing?");
 */
function agent(opts) {
  if (!opts || !opts.name) throw new Error("agent: opts.name is required");

  async function agentFn(query) {
    const result = await react({
      query,
      tools: opts.tools,
      model: opts.model,
      systemPrompt: opts.systemPrompt,
      maxIterations: opts.maxIterations,
      temperature: opts.temperature,
    });

    console.log(
      `[agent:${opts.name}] Completed in ${result.elapsedSeconds.toFixed(2)}s (${result.steps} steps, ${result.toolCalls.length} tool calls)`
    );

    return result.answer;
  }

  agentFn._agentName = opts.name;
  return agentFn;
}

// ---------------------------------------------------------------------------
// Provider internals
// ---------------------------------------------------------------------------

function _getProvider(model) {
  if (PLATFORM_TIERS[model]) {
    const platformUrl = process.env.GRAPHINGEST_API_URL;
    const apiKey = process.env.GRAPHINGEST_API_KEY;
    if (!platformUrl) {
      throw new Error(
        `model="${model}" requires GRAPHINGEST_API_URL. Run deploy() first or set the env var.`
      );
    }
    return {
      provider: { baseUrl: platformUrl + "/llm/v1", apiKey },
      resolvedModel: PLATFORM_TIERS[model],
    };
  }

  const lower = model.toLowerCase();
  if (
    lower.startsWith("gpt-") ||
    lower.startsWith("o1") ||
    lower.startsWith("o3") ||
    lower.startsWith("o4")
  ) {
    return {
      provider: {
        baseUrl: "https://api.openai.com/v1",
        apiKey: process.env.OPENAI_API_KEY,
      },
      resolvedModel: model,
    };
  }

  // Default: OpenAI-compatible
  return {
    provider: {
      baseUrl: "https://api.openai.com/v1",
      apiKey: process.env.OPENAI_API_KEY,
    },
    resolvedModel: model,
  };
}

async function _chatOpenAI(provider, messages, tools, temperature, model) {
  const body = { model, messages, temperature };
  if (tools.length > 0) body.tools = tools;

  const res = await fetch(provider.baseUrl + "/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + (provider.apiKey || ""),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM API error (${res.status}): ${text}`);
  }

  const data = await res.json();
  const msg = data.choices[0].message;

  const toolCalls = (msg.tool_calls || []).map((tc) => {
    let args = {};
    try {
      args = JSON.parse(tc.function.arguments);
    } catch {
      /* ignore */
    }
    return { id: tc.id, name: tc.function.name, arguments: args };
  });

  return { content: msg.content || "", toolCalls };
}

function _appendAssistant(messages, response) {
  const msg = { role: "assistant" };
  if (response.content) msg.content = response.content;
  if (response.toolCalls && response.toolCalls.length > 0) {
    msg.tool_calls = response.toolCalls.map((tc) => ({
      id: tc.id,
      type: "function",
      function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
    }));
  }
  messages.push(msg);
}

module.exports = { react, agent, toolsFromNodes };
