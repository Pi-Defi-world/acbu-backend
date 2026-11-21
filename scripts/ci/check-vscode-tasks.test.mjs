import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { scanVscodeTasks } from "./check-vscode-tasks.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixturesDirectory = path.join(testDirectory, "test-fixtures");
const scriptPath = path.join(testDirectory, "check-vscode-tasks.mjs");

function scanFixture(name, context) {
  const fixtureDirectory = path.join(fixturesDirectory, name);
  const fixtureFiles = [];
  function collectFiles(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        collectFiles(absolutePath);
      } else {
        fixtureFiles.push(absolutePath);
      }
    }
  }
  collectFiles(fixtureDirectory);

  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-tasks-"));
  context.after(() => fs.rmSync(rootDirectory, { recursive: true, force: true }));
  for (const fixtureFile of fixtureFiles) {
    const relativePath = path.relative(fixtureDirectory, fixtureFile);
    const targetPath = path.join(
      rootDirectory,
      path.dirname(relativePath),
      ".vscode",
      "tasks.json",
    );
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(fixtureFile, targetPath);
  }
  return scanVscodeTasks(rootDirectory);
}

test('rejects runOn "folderOpen"', (context) => {
  const findings = scanFixture("basic", context);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].taskLabel, "Build");
  assert.equal(findings[0].runOn, "folderOpen");
});

test("rejects folderOpen regardless of task name or command", (context) => {
  const findings = scanFixture("alternate-task", context);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].taskLabel, "Unrelated task name");
  assert.match(findings[0].message, /folderOpen/);
});

test("matches folderOpen case-insensitively and tolerates surrounding whitespace", (context) => {
  const findings = scanFixture("case-and-whitespace", context);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].runOn, "  FoLdErOpEn \t");
});

test('allows runOn "default" and tasks without runOptions', (context) => {
  assert.deepEqual(scanFixture("allowed", context), []);
});

test("parses JSONC comments and trailing commas", (context) => {
  assert.deepEqual(scanFixture("jsonc", context), []);
});

test("fails closed when tasks.json cannot be parsed", (context) => {
  const findings = scanFixture("malformed", context);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].taskLabel, "<unparsed>");
  assert.match(findings[0].message, /failing closed/);
});

test("finds tasks.json beneath a nested .vscode directory in a package", (context) => {
  const findings = scanFixture("nested-package", context);
  assert.equal(findings.length, 1);
  assert.match(findings[0].file, /packages\/sample\/\.vscode\/tasks\.json$/);
});

test("rejects folderOpen in platform-specific runOptions overrides", (context) => {
  const findings = scanFixture("platform-override", context);
  assert.deepEqual(
    findings.map((finding) => finding.taskLabel),
    ["Build (windows)", "Build (linux)", "Build (osx)"],
  );
});

test("checks top-level runOptions as well as task runOptions", (context) => {
  const findings = scanFixture("top-level", context);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].taskLabel, "<top-level>");
});

test("CLI failure includes the file path and a GitHub Actions annotation", () => {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-tasks-cli-"));
  try {
    const fixture = path.join(fixturesDirectory, "basic", "tasks.jsonc");
    const target = path.join(rootDirectory, ".vscode", "tasks.json");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(fixture, target);
    const result = spawnSync(process.execPath, [scriptPath, rootDirectory], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /\.vscode\/tasks\.json: Task "Build"/);
    assert.match(result.stdout, /::error file=\.vscode\/tasks\.json::Task "Build".*folderOpen/);
  } finally {
    fs.rmSync(rootDirectory, { recursive: true, force: true });
  }
});
