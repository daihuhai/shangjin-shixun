#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const srcRoot = path.join(projectRoot, "src");
const reportDir = path.join(projectRoot, "test-reports");
const reportPath = path.join(reportDir, "frontend-cli-report.json");

const args = new Set(process.argv.slice(2));
const mode = args.has("structure")
  ? "structure"
  : args.has("routes")
    ? "routes"
    : args.has("navigation")
      ? "navigation"
      : args.has("encoding")
        ? "encoding"
        : args.has("build")
          ? "build"
          : "all";

const summary = {
  mode,
  startedAt: new Date().toISOString(),
  checks: [],
  passed: 0,
  failed: 0,
  warnings: 0
};

function addResult(status, name, details, meta = {}) {
  summary.checks.push({ status, name, details, ...meta });
  if (status === "pass") {
    summary.passed += 1;
  } else if (status === "fail") {
    summary.failed += 1;
  } else if (status === "warn") {
    summary.warnings += 1;
  }
}

function log(status, name, details) {
  const marker = status === "pass" ? "[PASS]" : status === "fail" ? "[FAIL]" : "[WARN]";
  console.log(`${marker} ${name}: ${details}`);
  addResult(status, name, details);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(projectRoot, relativePath));
}

function readFile(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function walkFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
      continue;
    }
    files.push(fullPath);
  }

  return files;
}

function resolveImport(fromFile, importPath) {
  if (!importPath.startsWith(".")) {
    return null;
  }

  const candidate = path.resolve(path.dirname(fromFile), importPath);
  const extensions = ["", ".js", ".jsx", ".mjs"];

  for (const ext of extensions) {
    const filePath = `${candidate}${ext}`;
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return filePath;
    }
  }

  for (const ext of [".js", ".jsx", ".mjs"]) {
    const indexPath = path.join(candidate, `index${ext}`);
    if (fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) {
      return indexPath;
    }
  }

  return null;
}

function checkRequiredFiles() {
  const requiredFiles = [
    "package.json",
    "vite.config.js",
    "src/main.jsx",
    "src/App.jsx",
    "src/ui/AppShell.jsx",
    "src/ui/ProtectedRoute.jsx",
    "src/state/AuthContext.jsx",
    "src/config/navigation.js",
    "src/services/authService.js",
    "src/services/appService.js",
    "src/views/auth/LoginPage.jsx",
    "src/views/auth/RegisterPage.jsx",
    "src/views/app/DashboardPage.jsx",
    "src/views/app/TasksPage.jsx",
    "src/views/app/CourseWorkspacePage.jsx",
    "src/views/app/SubmissionsPage.jsx",
    "src/views/app/ChecksPage.jsx",
    "src/views/app/ReportsPage.jsx",
    "src/views/app/UploadPage.jsx",
    "src/views/app/UsersPage.jsx",
    "src/views/app/ModelsPage.jsx",
    "src/views/app/AssignmentReviewPage.jsx",
    "src/views/app/AssignmentReviewDetailPage.jsx",
    "src/views/app/ExamReviewPage.jsx",
    "src/views/app/ExamReviewDetailPage.jsx"
  ];

  const missing = requiredFiles.filter((file) => !fileExists(file));
  if (missing.length === 0) {
    log("pass", "Required files", `${requiredFiles.length} core frontend files are present.`);
  } else {
    log("fail", "Required files", `Missing ${missing.length} files: ${missing.join(", ")}`);
  }
}

function checkRouteImports() {
  const appPath = path.join(projectRoot, "src", "App.jsx");
  const appSource = fs.readFileSync(appPath, "utf8");
  const importMatches = [...appSource.matchAll(/import\s+([A-Za-z0-9_]+)\s+from\s+"([^"]+)";/g)];
  const importMap = new Map();

  for (const [, localName, importPath] of importMatches) {
    importMap.set(localName, importPath);
  }

  const routeComponents = [...new Set(
    [...appSource.matchAll(/element=\{\s*<([A-Za-z0-9_]+)/g)].map((match) => match[1])
  )].filter((name) => !["Navigate", "Routes", "Route", "ProtectedRoute", "RoleHomeRedirect", "AppShell"].includes(name));

  const missingComponents = [];
  for (const componentName of routeComponents) {
    const importPath = importMap.get(componentName);
    if (!importPath) {
      missingComponents.push(`${componentName} (missing import)`);
      continue;
    }

    const resolved = resolveImport(appPath, importPath);
    if (!resolved) {
      missingComponents.push(`${componentName} -> ${importPath}`);
    }
  }

  if (missingComponents.length === 0) {
    log("pass", "Route imports", `${routeComponents.length} routed components resolve to local files.`);
  } else {
    log("fail", "Route imports", `Unresolved routed components: ${missingComponents.join(", ")}`);
  }
}

function getRoutePaths() {
  const appSource = readFile("src/App.jsx");
  return [...new Set(
    [...appSource.matchAll(/path="([^"]+)"/g)].map((match) => match[1])
  )];
}

function getNavigationPaths() {
  const navigationSource = readFile("src/config/navigation.js");
  return [...new Set(
    [...navigationSource.matchAll(/path:\s*"([^"]+)"/g)].map((match) => match[1])
  )];
}

function checkNavigationCoverage() {
  const routePaths = getRoutePaths().map((routePath) => normalizeRoutePath(routePath));
  const navigationPaths = getNavigationPaths().map((navPath) => normalizeRoutePath(navPath));

  const uncovered = navigationPaths.filter((navPath) => {
    return !routePaths.some((routePath) => routePath === navPath || routePath.startsWith(`${navPath}/`));
  });

  if (uncovered.length === 0) {
    log("pass", "Navigation coverage", `${navigationPaths.length} navigation paths map to declared routes.`);
  } else {
    log("fail", "Navigation coverage", `Navigation paths without matching routes: ${uncovered.join(", ")}`);
  }
}

function checkRoleNavigation() {
  const navigationSource = readFile("src/config/navigation.js");
  const roleBlocks = [...navigationSource.matchAll(/(teacher|student|admin):\s*\[([\s\S]*?)\]/g)];
  const problems = [];

  for (const [, role, block] of roleBlocks) {
    const paths = [...block.matchAll(/path:\s*"([^"]+)"/g)].map((match) => match[1]);
    if (paths.length === 0) {
      problems.push(`${role} has no navigation items`);
      continue;
    }
    if (new Set(paths).size !== paths.length) {
      problems.push(`${role} contains duplicated navigation paths`);
    }
  }

  if (problems.length === 0) {
    log("pass", "Role navigation", "Teacher, student, and admin navigation blocks are populated and non-duplicated.");
  } else {
    log("fail", "Role navigation", problems.join("; "));
  }
}

function checkEncodingRisk() {
  const suspiciousNeedles = ["鏁", "鍙", "璇", "鐧", "绠", "绯", "褰", "璐", "€", "�"];
  const sourceFiles = walkFiles(srcRoot).filter((file) => /\.(js|jsx|css|html)$/.test(file));
  const hits = [];

  for (const filePath of sourceFiles) {
    const relativePath = path.relative(projectRoot, filePath);
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);

    lines.forEach((line, index) => {
      const count = suspiciousNeedles.reduce((sum, needle) => sum + (line.split(needle).length - 1), 0);
      if (count >= 1) {
        hits.push(`${relativePath}:${index + 1}`);
      }
    });
  }

  if (hits.length === 0) {
    log("pass", "Encoding scan", "No obvious mojibake-style text risks found in src.");
  } else {
    log("warn", "Encoding scan", `Possible garbled text found in ${hits.length} lines. Examples: ${hits.slice(0, 10).join(", ")}`);
  }
}

function runBuild() {
  const result = process.platform === "win32"
    ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm run build"], {
        cwd: projectRoot,
        encoding: "utf8",
        stdio: "pipe"
      })
    : spawnSync("npm", ["run", "build"], {
        cwd: projectRoot,
        encoding: "utf8",
        stdio: "pipe"
      });

  if (result.status === 0) {
    const output = stripAnsi(result.stdout || "").trim().split(/\r?\n/).filter(Boolean);
    const tail = output.slice(-3).join(" | ") || "build completed";
    log("pass", "Build smoke test", tail);
  } else {
    const stderr = stripAnsi([result.stdout, result.stderr].filter(Boolean).join("\n"));
    const preview = stderr.trim().split(/\r?\n/).slice(-8).join(" | ");
    log("fail", "Build smoke test", preview || "npm run build failed");
  }
}

function writeReport() {
  ensureDir(reportDir);
  summary.finishedAt = new Date().toISOString();
  fs.writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(`\nReport written to ${path.relative(projectRoot, reportPath)}`);
}

function normalizeRoutePath(routePath) {
  if (!routePath || routePath === "*") {
    return routePath;
  }

  return routePath.startsWith("/") ? routePath : `/${routePath}`;
}

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function run() {
  console.log(`Frontend Test CLI`);
  console.log(`Mode: ${mode}\n`);

  if (mode === "structure" || mode === "all") {
    checkRequiredFiles();
    checkRouteImports();
  }

  if (mode === "routes") {
    checkRouteImports();
  }

  if (mode === "navigation" || mode === "all") {
    checkNavigationCoverage();
    checkRoleNavigation();
  }

  if (mode === "encoding" || mode === "all") {
    checkEncodingRisk();
  }

  if (mode === "build" || mode === "all") {
    runBuild();
  }

  writeReport();

  console.log(`Summary: ${summary.passed} passed, ${summary.warnings} warnings, ${summary.failed} failed`);
  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

run();
