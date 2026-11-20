'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { CONTRACTS, parseLock, verifyIntegrity, printCandidates } = require('../scripts/ci/verify-wasm-integrity');
const HEADER = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);

function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wasm-check-'));
  const lock = path.join(dir, 'checksums');
  try {
    const lines = CONTRACTS.map((name, i) => {
      const data = Buffer.concat([HEADER, Buffer.from([i + 1])]);
      fs.writeFileSync(path.join(dir, name + '.wasm'), data);
      return crypto.createHash('sha256').update(data).digest('hex') + '  ' + name + '.wasm';
    });
    fs.writeFileSync(lock, lines.join('\n') + '\n');
    return fn({ dir, lock, lines });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('accepts nine distinct, approved, valid WASM binaries', () => fixture(({ dir, lock }) => {
  assert.equal(verifyIntegrity(dir, lock), 9);
}));
test('candidate hashes never overwrite the approved lock', () => fixture(({ dir, lock }) => {
  const before = fs.readFileSync(lock, 'utf8');
  assert.equal(printCandidates(dir), before);
  assert.equal(fs.readFileSync(lock, 'utf8'), before);
}));
test('rejects missing ZK verifier WASM', () => fixture(({ dir, lock }) => {
  fs.unlinkSync(path.join(dir, 'zk_verifier.wasm'));
  assert.throws(() => verifyIntegrity(dir, lock), /Required WASM missing: zk_verifier/);
}));
test('rejects missing approved checksum lock', () => fixture(({ dir, lock }) => {
  fs.unlinkSync(lock);
  assert.throws(() => verifyIntegrity(dir, lock), /ENOENT/);
}));
test('rejects a tampered WASM binary', () => fixture(({ dir, lock }) => {
  fs.appendFileSync(path.join(dir, 'acbu_escrow.wasm'), Buffer.from([0x40]));
  assert.throws(() => verifyIntegrity(dir, lock), /SHA-256 mismatch: acbu_escrow/);
}));
test('rejects a non-WASM file', () => fixture(({ dir, lock }) => {
  fs.writeFileSync(path.join(dir, 'acbu_escrow.wasm'), 'not wasm');
  assert.throws(() => verifyIntegrity(dir, lock), /Invalid WebAssembly header/);
}));
test('rejects missing or placeholder digest', () => fixture(({ dir, lock, lines }) => {
  fs.writeFileSync(lock, lines.slice(0, 8).join('\n') + '\n');
  assert.throws(() => verifyIntegrity(dir, lock), /Missing approved SHA-256 for zk_verifier/);
  fs.writeFileSync(lock, lines.join('\n').replace(/[a-f0-9]{64}/, 'REPLACE_WITH_HASH'));
  assert.throws(() => verifyIntegrity(dir, lock), /Malformed checksum entry/);
}));
test('rejects reused digest across contracts', () => fixture(({ dir, lock, lines }) => {
  fs.writeFileSync(lock, [lines[0], lines[0].split('  ')[0] + '  acbu_escrow.wasm', ...lines.slice(2)].join('\n') + '\n');
  assert.throws(() => verifyIntegrity(dir, lock), /Reused SHA-256/);
}));
test('rejects duplicate checksum entries', () => fixture(({ dir, lock, lines }) => {
  fs.appendFileSync(lock, lines[0] + '\n');
  assert.throws(() => verifyIntegrity(dir, lock), /Duplicate lock entry/);
}));
test('rejects unregistered WASM files', () => fixture(({ dir, lock }) => {
  fs.writeFileSync(path.join(dir, 'unknown.wasm'), HEADER);
  assert.throws(() => verifyIntegrity(dir, lock), /Unregistered WASM binaries/);
}));
test('does not follow symlinked WASM artifacts', () => fixture(({ dir, lock }) => {
  const file = path.join(dir, 'acbu_escrow.wasm');
  fs.renameSync(file, file + '.real');
  fs.symlinkSync(file + '.real', file);
  assert.throws(() => verifyIntegrity(dir, lock), /Not a regular file/);
}));
test('rejects unsafe paths in checksum lock', () => fixture(({ dir, lock, lines }) => {
  fs.writeFileSync(lock, lines.slice(0, 8).join('\n') + '\n' + lines[8].replace('zk_verifier.wasm', '../zk_verifier.wasm') + '\n');
  assert.throws(() => verifyIntegrity(dir, lock), /Malformed checksum entry/);
}));
test('rejects empty directory instead of silently passing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-wasm-'));
  try {
    assert.throws(() => verifyIntegrity(dir, path.join(dir, 'missing')), /Required WASM missing/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('rejects empty or partial checksum manifest', () => {
  assert.throws(() => parseLock(''), /Missing approved SHA-256/);
  assert.throws(() => parseLock('a'.repeat(64) + '  acbu_escrow.wasm'), /Missing approved SHA-256/);
});
