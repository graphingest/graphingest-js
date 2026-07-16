# GraphIngest JavaScript SDK

Plain JavaScript SDK for the [GraphIngest Orchestrator](../../README.md) — no TypeScript required. Works with Node.js 18+ and CommonJS.

## Installation

```bash
npm install graphingest
```

## Quick Start

```javascript
const { node, graph, deploy } = require("graphingest");

const extract = node({ name: "extract" }, async (url) => {
  return { url, rows: 100 };
});

const transform = node({ name: "transform" }, async (data) => {
  data.cleaned = true;
  return data;
});

const pipeline = graph({ name: "etl-pipeline" }, async (url) => {
  const data = await extract.run(url);
  return transform.run(data);
});

// Run it
const result = await pipeline.run("https://api.example.com/data");
```

## Deploy

Push your code to the platform:

```javascript
const { deploy } = require("graphingest");

// Dashboard-only (no local env file):
await deploy();

// With a local .env file:
await deploy({ envPath: ".env" });

// Absolute path:
await deploy({ envPath: "/home/me/prod.env" });
```

Dashboard variables always take precedence over file variables at runtime.

## Node API

```javascript
const { node } = require("graphingest");

const myNode = node({ name: "my-node", cacheTtl: 3600 }, async (input) => {
  return { result: input };
});

// Run directly
const result = await myNode.run("input");

// Fan-out: parallel dispatch
const results = await myNode.map(["a", "b", "c"]);

// Async dispatch
const future = myNode.arun("input");
const result = await future.result();        // block until done
const result = await future.result(30000);   // with timeout (ms)
```

## Graph API

```javascript
const { graph } = require("graphingest");

const myGraph = graph({
  name: "my-graph",
  version: "1.0",
  tags: ["prod"],
  retryPolicy: { maxRetries: 3, delaySeconds: 1, backoffFactor: 2 },
}, async (input) => {
  const data = await extract.run(input);
  return transform.run(data);
});

const result = await myGraph.run("input");
```

## AI Agent (ReAct)

```javascript
const { node, deploy, agent, react } = require("graphingest");

const search = node({ name: "search" }, async (query) => {
  return googleSearch(query);
});

// Define tool
const searchTool = {
  name: "search",
  description: "Search the web.",
  parameters: { query: { type: "string" } },
  fn: async (args) => {
    const result = await search.run(args.query);
    return JSON.stringify(result);
  },
};

// One-liner agent: graph + ReAct loop
const researcher = agent({
  name: "researcher",
  tools: [searchTool],
  model: "standard", // or "high", "gpt-4o", "claude-3.5-sonnet", etc.
  systemPrompt: "You are a research assistant.",
});

const answer = await researcher("What is quantum computing?");

// Or use react() directly for more control
const result = await react({
  query: "Research fusion energy",
  tools: [searchTool],
  model: "standard",
  maxIterations: 10,
});
console.log(result.answer, result.steps, result.elapsedSeconds);
```

**Model tiers:**

| Model | Description |
|-------|-------------|
| `"standard"` | Fast and cost-effective (default, no API key needed) |
| `"high"` | Premium quality for complex reasoning (no API key needed) |
| `"gpt-4o"` | BYOK: OpenAI (set `OPENAI_API_KEY`) |
| `"claude-3.5-sonnet"` | BYOK: Anthropic (set `ANTHROPIC_API_KEY`) |
| `"gemini-2.5-flash"` | BYOK: Google (set `GOOGLE_API_KEY`) |

## Exports

| Export | Type | Description |
|--------|------|-------------|
| `node` | function | Create a node wrapper |
| `graph` | function | Create a graph wrapper |
| `deploy` | function | Push code to platform (supports `envPath`) |
| `react` | function | ReAct loop: LLM + tool routing |
| `agent` | function | One-liner agent combining graph + react |
| `toolsFromNodes` | function | Generate tool schemas from tool defs |
| `getClient` | function | Get platform API client |
