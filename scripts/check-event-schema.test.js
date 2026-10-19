const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { validateEventSchema } = require("./check-event-schema");

const repositoryRoot = path.resolve(__dirname, "..");

test("shared event schema matches listener declarations", () => {
  assert.deepEqual(validateEventSchema({ rootDir: repositoryRoot }), []);
});

test("event type drift fails validation until the schema is updated", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "event-schema-"));
  fs.mkdirSync(path.join(temporaryRoot, "shared"));
  fs.mkdirSync(path.join(temporaryRoot, "src/jobs"), { recursive: true });

  fs.copyFileSync(
    path.join(repositoryRoot, "shared/events-schema.json"),
    path.join(temporaryRoot, "shared/events-schema.json"),
  );
  for (const listener of [
    "acbu_burning_event_listener.ts",
    "acbu_escrow_event_listener.ts",
    "acbu_lending_pool_event_listener.ts",
    "acbu_minting_event_listener.ts",
    "acbu_savings_vault_event_listener.ts",
  ]) {
    fs.copyFileSync(
      path.join(repositoryRoot, "src/jobs", listener),
      path.join(temporaryRoot, "src/jobs", listener),
    );
  }

  const changedListener = path.join(temporaryRoot, "src/jobs/acbu_escrow_event_listener.ts");
  fs.writeFileSync(
    changedListener,
    fs
      .readFileSync(changedListener, "utf8")
      .replace('"contract_effect",', '"contract_effect",\n  "contract_new",'),
  );

  assert.match(
    validateEventSchema({ rootDir: temporaryRoot }).join("\n"),
    /escrow effect types differ/,
  );
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

test("malformed schema entries fail validation", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "event-schema-"));
  fs.mkdirSync(path.join(temporaryRoot, "shared"));
  fs.writeFileSync(
    path.join(temporaryRoot, "shared/events-schema.json"),
    JSON.stringify({ version: 1, listener_contracts: [{}] }),
  );

  assert.match(
    validateEventSchema({ rootDir: temporaryRoot }).join("\n"),
    /requires contract, listener, and effect_types/,
  );
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});
