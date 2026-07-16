/**
 * GraphIngest Quick Start — JavaScript (no TypeScript needed)
 *
 * Web scraper that fetches 3 pages in parallel, summarizes each.
 * Shows: node caching, retries, graph with RetryPolicy, .map() fan-out.
 *
 * Run:
 *   npm install graphingest
 *   node quickstart.js
 */

const { node, graph, deploy } = require("graphingest");

// ── Step 1: Define nodes ──

const fetchPage = node(
  { name: "fetch-page", cacheTtl: 3600, maxRetries: 3 },
  async (url) => {
    const resp = await fetch(url);
    const text = await resp.text();
    return { url, status: resp.status, length: text.length };
  }
);

const summarize = node({ name: "summarize" }, async (page) => {
  return `Page ${page.url}: ${page.length} chars, status ${page.status}`;
});

// ── Step 2: Compose into a graph ──

const scrapePipeline = graph({
  name: "web-scraper",
  retryPolicy: { maxRetries: 2, delayMs: 1000, backoffFactor: 2, jitter: true },
  timeoutMs: 300_000,
}, async (urls) => {
  const pages = await fetchPage.map(urls);
  const summaries = [];
  for (const page of pages) {
    summaries.push(await summarize(page));
  }
  return { total: summaries.length, summaries };
});

// ── Step 3: Deploy and run ──

async function main() {
  await deploy();

  const result = await scrapePipeline([
    "https://example.com",
    "https://httpbin.org/get",
    "https://jsonplaceholder.typicode.com/posts/1",
  ]);
  console.log(result);
}

main();
