/**
 * zk-proof.worker.js
 *
 * Web Worker for real ZK-SNARK proof generation using @noir-lang/noir_js
 * and @aztec/bb.js (UltraHonk / Barretenberg backend).
 *
 * Runs off the main thread so the UI stays responsive during the
 * multi-second witness + proof computation.
 *
 * Message protocol
 * ─────────────────
 * Incoming  { type: 'GENERATE_PROOF', payload: ZkProofRequest }
 * Outgoing  { type: 'PROOF_PROGRESS',  payload: { step: string } }
 *           { type: 'PROOF_RESULT',    payload: ZkProofResult   }
 *           { type: 'PROOF_ERROR',     payload: { message: string } }
 *
 * ZkProofRequest  = { circuitSource, kycLevel, countryCode, salt,
 *                     requiredKyc, allowedCountry }
 * ZkProofResult   = { proofHex, publicInputsHex, vkHex,
 *                     nullifierHex, commitmentHex }
 */

/* global self */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function progress(step) {
  self.postMessage({ type: 'PROOF_PROGRESS', payload: { step } });
}

function bigintToField(n) {
  return '0x' + BigInt(n).toString(16);
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex) {
  const clean = hex.replace(/^0x/, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bigintToBytes32(n) {
  const hex = BigInt(n).toString(16).padStart(64, '0');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Poseidon2 helpers (mirror the Noir circuit's hash functions)
// ---------------------------------------------------------------------------

/** Lazy singleton — initialised once per worker lifetime. */
let _bb = null;

async function getBb() {
  if (_bb) return _bb;
  // Dynamic import works in module workers; for classic workers this bundle
  // must be pre-built. The Next.js webpack config (see next.config.mjs) is
  // configured to treat this file as a worker entry that can import ESM.
  const { BarretenbergSync, Fr } = await import('@aztec/bb.js');
  _bb = { BarretenbergSync, Fr, instance: await BarretenbergSync.initSingleton() };
  return _bb;
}

async function poseidon2Hash(fields) {
  const { Fr, instance } = await getBb();
  const frFields = fields.map((f) => new Fr(BigInt(f)));
  const result = instance.poseidon2Hash(frFields);
  return BigInt(result.toString());
}

async function computeCommitment(kycLevel, countryCode, salt) {
  // poseidon2_hash_4(kyc_level, country_code, salt, 0)
  return poseidon2Hash([kycLevel, countryCode, salt, 0n]);
}

async function computeNullifier(commitment, salt) {
  // poseidon2_hash_2(commitment, salt)
  return poseidon2Hash([commitment, salt]);
}

// ---------------------------------------------------------------------------
// Proof generation
// ---------------------------------------------------------------------------

async function generateProof({
  circuitSource,
  kycLevel,
  countryCode,
  salt,
  requiredKyc,
  allowedCountry,
}) {
  progress('Initialising Barretenberg WASM…');
  await getBb(); // warm up the WASM singleton

  progress('Compiling Noir circuit…');
  const { compile, createFileManager } = await import('@noir-lang/noir_wasm');
  const fm = createFileManager('/');
  fm.addFile('./main.nr', circuitSource);
  const compiled = await compile(fm, './main.nr');

  progress('Initialising UltraHonk backend…');
  const { UltraHonkBackend } = await import('@aztec/bb.js');
  const bytecode = compiled.program.bytecode;
  const backend = new UltraHonkBackend(bytecode, {
    threads: (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4,
  });

  progress('Computing Poseidon2 commitment and nullifier…');
  const saltBig = BigInt(salt);
  const commitment = await computeCommitment(BigInt(kycLevel), BigInt(countryCode), saltBig);
  const nullifier = await computeNullifier(commitment, saltBig);

  const circuitInputs = {
    kyc_level: kycLevel,
    country_code: countryCode,
    salt: bigintToField(saltBig),
    commitment: bigintToField(commitment),
    required_kyc: requiredKyc,
    allowed_country: allowedCountry,
    nullifier: bigintToField(nullifier),
  };

  progress('Executing Noir circuit to generate witness…');
  const { Noir } = await import('@noir-lang/noir_js');
  const program = new Noir(compiled);
  const { witness } = await program.execute(circuitInputs);

  progress('Generating UltraHonk ZK-SNARK proof…');
  const { proof, publicInputs } = await backend.generateProof(witness);
  const vk = await backend.getVerificationKey();

  const proofBytes =
    proof instanceof Uint8Array ? proof : Uint8Array.from(proof);
  const vkBytes = vk instanceof Uint8Array ? vk : Uint8Array.from(vk);

  const publicInputsBytes = hexToBytes(
    (publicInputs)
      .map((p) => p.replace(/^0x/, '').padStart(64, '0'))
      .join(''),
  );

  return {
    proofHex: bytesToHex(proofBytes),
    publicInputsHex: bytesToHex(publicInputsBytes),
    vkHex: bytesToHex(vkBytes),
    nullifierHex: bytesToHex(bigintToBytes32(nullifier)),
    commitmentHex: bytesToHex(bigintToBytes32(commitment)),
  };
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.addEventListener('message', async (event) => {
  const { type, payload } = event.data ?? {};

  if (type !== 'GENERATE_PROOF') return;

  try {
    const result = await generateProof(payload);
    self.postMessage({ type: 'PROOF_RESULT', payload: result });
  } catch (err) {
    self.postMessage({
      type: 'PROOF_ERROR',
      payload: { message: err instanceof Error ? err.message : String(err) },
    });
  }
});
