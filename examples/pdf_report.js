/**
 * Problem: PDF Report Generation — Background Job Pattern
 *
 * Users click "Generate Report" → dispatch as background job →
 * return job ID instantly → frontend polls for status.
 *
 * Run: node pdf_report.js
 */

const { node, graph, deploy, getStatus } = require("graphingest");

const queryDatabase = node(
  { name: "query-database", cacheTtl: 300 },
  async (params) => ({ reportType: params.type, rows: 15000 })
);

const generateCharts = node({ name: "generate-charts" },
  async (data) => ({
    charts: [{ type: "bar", title: "Revenue" }, { type: "line", title: "Growth" }],
    rowsProcessed: data.rows,
  })
);

const renderPdf = node({ name: "render-pdf" },
  async (charts) => ({
    url: "https://storage.example.com/reports/quarterly.pdf",
    pages: 24,
  })
);

const generateReport = graph({
  name: "generate-report",
  retryPolicy: { maxRetries: 2, delayMs: 5000 },
}, async (params) => {
  const data = await queryDatabase(params);
  const charts = await generateCharts(data);
  return await renderPdf(charts);
});

async function main() {
  await deploy();

  // Dispatch (returns instantly)
  const future = await generateReport.arun({ type: "quarterly" });
  console.log(`Job ID: ${future.taskRunId}`);

  // Poll for result
  const result = await future.result({ timeoutMs: 120_000 });
  console.log(`Download: ${result.url}`);
}

main();
