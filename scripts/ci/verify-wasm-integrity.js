#!/usr/bin/env node
/**
 * W11-CAR-015: fail-closed verification of independently approved WASM hashes.
 * Never regenerate the approved checksum lock during verification.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CONTRACTS = Object.freeze([
  'acbu_burning',
  'acbu_escrow',
  'acbu_lending_pool',
  'acbu_minting',
  'acbu_multisig',
  'acbu_oracle',
  'acbu_reserve_tracker',
  'acbu_savings_vault',
  'zk_verifier',
]);
const EXPECTED_FILES = CONTRACTS.map((name) => name + '.wasm');
const WASM_HEADER = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);

function ensureRegularFile(file) {
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error('Not a regular file: ' + file);
  }
}

function parseLock(text) {
  const records = new Map();
  const hashes = new Set();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    // Double space follows sha256sum text output convention.
    const match = /^([0-9a-f]{64})  ([A-Za-z][A-Za-z0-9_]*\.wasm)$/.exec(trimmed);
    if (!match) throw new Error('Malformed checksum entry: ' + trimmed.slice(0, 100));
    const [, sha, filename] = match;
    if (!EXPECTED_FILES.includes(filename)) throw new Error('Unexpected WASM in lock: ' + filename);
    if (records.has(filename)) throw new Error('Duplicate lock entry: ' + filename);
    if (hashes.has(sha)) throw new Error('Reused SHA-256 in lock: ' + sha);
    hashes.add(sha);
    records.set(filename, sha);
  }
  for (const file of EXPECTED_FILES) {
    if (!records.has(file)) throw new Error('Missing approved SHA-256 for ' + file);
  }
  if (records.size !== EXPECTED_FILES.length) {
    throw new Error('Expected ' + EXPECTED_FILES.length + ' approved hashes, got ' + records.size);
  }
  return records;
}

function readWasm(dir, filename) {
  const pathname = path.join(dir, filename);
  ensureRegularFile(pathname);
  const data = fs.readFileSync(pathname);
  if (data.length < WASM_HEADER.length || !data.subarray(0, 8).equals(WASM_HEADER)) {
    throw new Error('Invalid WebAssembly header: ' + filename);
  }
  return crypto.createHash('sha256').update(data).digest('hex');
}

function inspectDirectory(dir) {
  const stats = fs.lstatSync(dir);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('WASM directory must be a real directory');
  const present = fs.readdirSync(dir).filter((name) => name.endsWith('.wasm')).sort();
  const unexpected = present.filter((name) => !EXPECTED_FILES.includes(name));
  if (unexpected.length) throw new Error('Unregistered WASM binaries: ' + unexpected.join(', '));
  for (const filename of EXPECTED_FILES) {
    if (!present.includes(filename)) throw new Error('Required WASM missing: ' + filename);
  }
}

function verifyIntegrity(dir, lockFile) {
  inspectDirectory(dir);
  ensureRegularFile(lockFile);
  const lock = parseLock(fs.readFileSync(lockFile, 'utf8'));
  const actualHashes = new Set();
  for (const filename of EXPECTED_FILES) {
    const actual = readWasm(dir, filename);
    if (actualHashes.has(actual)) throw new Error('Duplicate compiled WASM SHA-256 for ' + filename);
    actualHashes.add(actual);
    if (lock.get(filename) !== actual) {
      throw new Error('SHA-256 mismatch: ' + filename + '; expected ' + lock.get(filename) + '; actual ' + actual);
    }
  }
  return EXPECTED_FILES.length;
}

function printCandidates(dir) {
  inspectDirectory(dir);
  const hashes = new Set();
  const lines = [];
  for (const filename of EXPECTED_FILES) {
    const hash = readWasm(dir, filename);
    if (hashes.has(hash)) throw new Error('Duplicate WASM hash for ' + filename + '; investigate before approval');
    hashes.add(hash);
    lines.push(hash + '  ' + filename);
  }
  return lines.join('\n') + '\n';
}

function main(argv) {
  let dir = null;
  let lock = path.resolve(__dirname, '../../.wasm-checksums');
  let candidates = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir' && argv[i + 1]) dir = path.resolve(argv[++i]);
    else if (argv[i] === '--lock' && argv[i + 1]) lock = path.resolve(argv[++i]);
    else if (argv[i] === '--print-candidates') candidates = true;
    else throw new Error('Unknown or incomplete argument: ' + argv[i]);
  }
  if (!dir) throw new Error('Missing --dir <release-wasm-directory>');
  if (candidates) {
    process.stderr.write('CANDIDATE HASHES ONLY. Independently review artifacts and source before approving the lock.\n');
    process.stdout.write(printCandidates(dir));
    return;
  }
  const count = verifyIntegrity(dir, lock);
  process.stdout.write('Verified ' + count + ' approved, distinct WASM SHA-256 hashes.\n');
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error('::error::WASM integrity verification failed: ' + error.message);
    process.exitCode = 1;
  }
}

module.exports = { CONTRACTS, parseLock, verifyIntegrity, printCandidates, main };
