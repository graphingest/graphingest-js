"use strict";

const fs = require("fs");
const path = require("path");
const { getClient } = require("./client");

const SKIP_DIRS = new Set([
  "node_modules", ".git", "__pycache__", ".venv", "dist", "build", ".next",
]);

const NODE_GRAPH_RE = /\bnode\s*\(|graph\s*\(/;

/**
 * Deploy your code to the GraphIngest platform.
 *
 * @param {object} [opts] - { envPath?, projectDir? }
 * @returns {Promise<{ functions: string[], dashboard_env_vars: string[] }>}
 *
 * @example
 * // Dashboard-only:
 * await deploy();
 *
 * // With a local .env file:
 * await deploy({ envPath: ".env" });
 */
async function deploy(opts) {
  opts = opts || {};
  const projectDir = opts.projectDir || process.cwd();

  // 1. Find source files with node()/graph()
  console.log("Scanning for node/graph definitions...");
  const sourceFiles = findSourceFiles(projectDir);
  if (sourceFiles.length === 0) {
    throw new Error(
      "No .js files with node() or graph() found in " + projectDir
    );
  }
  console.log(`  Found ${sourceFiles.length} file(s) with node/graph definitions`);

  // 2. Read env file (only if envPath provided)
  let envVars = {};
  if (opts.envPath) {
    const envFile = path.isAbsolute(opts.envPath)
      ? opts.envPath
      : path.join(projectDir, opts.envPath);
    envVars = parseEnvFile(envFile);
    if (Object.keys(envVars).length > 0) {
      console.log(`Environment variables (from ${opts.envPath}):`);
      for (const k of Object.keys(envVars)) console.log(`  ✓ ${k}`);
    } else {
      console.warn(`  ${opts.envPath} not found or empty — using dashboard variables only`);
    }
  } else {
    console.log("  No envPath provided — using dashboard variables only");
  }

  // 3. Read package.json
  let pkgContent = "";
  const pkgPath = path.join(projectDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    pkgContent = fs.readFileSync(pkgPath, "utf-8");
    console.log("  Found package.json");
  }

  // 4. Prepare payload
  const files = {};
  for (const fp of sourceFiles) {
    const rel = path.relative(projectDir, fp);
    files[rel] = fs.readFileSync(fp, "utf-8");
  }

  const payload = {
    files,
    dependencies: pkgContent,
    env_vars: envVars,
    language: "javascript",
  };

  // 5. Upload
  console.log("Uploading to GraphIngest platform...");
  const client = getClient();
  const result = await client.post("/api/deploy", payload);

  console.log(
    `Deployed. ${result.functions.length} function(s) registered:`
  );
  for (const fn of result.functions) console.log(`  • ${fn}`);

  return result;
}

function findSourceFiles(dir) {
  const results = [];
  _walk(dir, dir, results);
  return results;
}

function _walk(root, current, results) {
  let entries;
  try {
    entries = fs.readdirSync(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      _walk(root, full, results);
    } else if (entry.name.endsWith(".js") || entry.name.endsWith(".mjs")) {
      try {
        const content = fs.readFileSync(full, "utf-8");
        if (NODE_GRAPH_RE.test(content)) results.push(full);
      } catch {
        // skip unreadable files
      }
    }
  }
}

function parseEnvFile(filePath) {
  const vars = {};
  if (!fs.existsSync(filePath)) return vars;
  const lines = fs.readFileSync(filePath, "utf-8").split("\n");
  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (
      val.length >= 2 &&
      ((val[0] === '"' && val[val.length - 1] === '"') ||
        (val[0] === "'" && val[val.length - 1] === "'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key) vars[key] = val;
  }
  return vars;
}

module.exports = { deploy };
