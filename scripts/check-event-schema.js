const fs = require("node:fs");
const path = require("node:path");

const LISTENER_CONTRACTS = [
  {
    contract: "burning",
    file: "src/jobs/acbu_burning_event_listener.ts",
    constant: "BURN_EFFECT_TYPES",
  },
  {
    contract: "escrow",
    file: "src/jobs/acbu_escrow_event_listener.ts",
    constant: "ESCROW_EFFECT_TYPES",
  },
  {
    contract: "lendingPool",
    file: "src/jobs/acbu_lending_pool_event_listener.ts",
    constant: "LENDING_POOL_EFFECT_TYPES",
  },
  {
    contract: "minting",
    file: "src/jobs/acbu_minting_event_listener.ts",
    constant: "MINT_EFFECT_TYPES",
  },
  {
    contract: "savingsVault",
    file: "src/jobs/acbu_savings_vault_event_listener.ts",
    constant: "SAVINGS_VAULT_EFFECT_TYPES",
  },
];

function extractEffectTypes(source, constant) {
  const declaration = source.match(new RegExp(`const\\s+${constant}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
  if (!declaration) {
    throw new Error(`Could not find ${constant}`);
  }

  return [...declaration[1].matchAll(/"([^"]+)"|'([^']+)'/g)].map((match) => match[1] || match[2]);
}

function validateEventSchema({ rootDir = path.resolve(__dirname, "..") } = {}) {
  const schemaPath = path.join(rootDir, "shared/events-schema.json");
  const errors = [];
  let schema;

  try {
    schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  } catch (error) {
    return [`Unable to read ${path.relative(rootDir, schemaPath)}: ${error.message}`];
  }

  if (!(
    (Number.isInteger(schema.version) && schema.version >= 1) ||
    (typeof schema.version === "string" && schema.version.length > 0)
  )) {
    errors.push("Schema version must be a positive integer or non-empty string");
  }
  if (!Array.isArray(schema.listener_contracts) || schema.listener_contracts.length === 0) {
    errors.push("Schema listener_contracts must be a non-empty array");
    return errors;
  }

  const schemaByContract = new Map();
  for (const event of schema.listener_contracts) {
    if (
      !event ||
      typeof event.contract !== "string" ||
      typeof event.listener !== "string" ||
      !Array.isArray(event.effect_types)
    ) {
      errors.push("Each schema event requires contract, listener, and effect_types");
      continue;
    }
    if (schemaByContract.has(event.contract)) {
      errors.push(`Duplicate schema contract: ${event.contract}`);
    }
    schemaByContract.set(event.contract, event);
  }

  for (const listener of LISTENER_CONTRACTS) {
    const schemaEvent = schemaByContract.get(listener.contract);
    if (!schemaEvent) {
      errors.push(`Missing schema entry for ${listener.contract}`);
      continue;
    }
    if (schemaEvent.listener !== listener.file) {
      errors.push(
        `${listener.contract} listener mismatch: expected ${listener.file}, found ${schemaEvent.listener}`,
      );
    }

    const listenerPath = path.join(rootDir, listener.file);
    let effectTypes;
    try {
      effectTypes = extractEffectTypes(fs.readFileSync(listenerPath, "utf8"), listener.constant);
    } catch (error) {
      errors.push(`${listener.contract}: ${error.message}`);
      continue;
    }

    if (JSON.stringify(effectTypes) !== JSON.stringify(schemaEvent.effect_types)) {
      errors.push(
        `${listener.contract} effect types differ: listener=${JSON.stringify(effectTypes)} schema=${JSON.stringify(schemaEvent.effect_types)}`,
      );
    }
  }

  const listenerContracts = new Set(LISTENER_CONTRACTS.map((listener) => listener.contract));
  for (const contract of schemaByContract.keys()) {
    if (!listenerContracts.has(contract)) {
      errors.push(`Schema has no listener mapping for ${contract}`);
    }
  }

  return errors;
}

if (require.main === module) {
  const errors = validateEventSchema();
  if (errors.length > 0) {
    console.error("Event schema check failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log("Event schema matches all backend listener declarations.");
  }
}

module.exports = { extractEffectTypes, validateEventSchema };
