/**
 * workers/zk-proof.worker.ts
 *
 * Web Worker for real ZK-SNARK proof generation using @noir-lang/noir_js
 * and @aztec/bb.js (UltraHonk / Barretenberg backend).
 *
 * This file is a webpack entry point (not a /public static asset) so that
 * bare npm specifiers like `@aztec/bb.js` resolve correctly at bundle time.
 * The component references it with `new URL('../workers/zk-proof.worker.ts', import.meta.url)`
 * which webpack rewrites into a hashed Worker chunk.
 *
 * Message protocol
 * ─────────────────
 * Incoming  { type: 'GENERATE_PROOF', payload: ZkProofRequest }
 * Outgoing  { type: 'PROOF_PROGRESS',  payload: { step: string } }
 *           { type: 'PROOF_RESULT',    payload: ZkProofResult   }
 *           { type: 'PROOF_ERROR',     payload: { message: string } }
 *
 * CodeRabbit review fixes applied (PR #1494):
 *   CR-1 (L73):  Moved from public/ to workers/ — webpack bundles this entry.
 *   CR-2 (L113): Use writeFile(ReadableStream) instead of non-existent addFile().
 *   CR-3 (L114): Compile project root '/'; provide Nargo.toml + src/main.nr.
 *   CR-4 (L140): Pass compiled.program to Noir(), not the wrapper object.
 *   CR-5 (L144): Pass { keccakZK: true } to generateProof + getVerificationKey
 *                to select a witness-hiding ZK flavor (HasZK = true).
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function progress(step: string): void {
  self.postMessage({ type: 'PROOF_PROGRESS', payload: { step } });
}

function bigintToField(n: bigint): string {
  return '0x' + n.toString(16);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bigintToBytes32(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, '0');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Encode a string as a ReadableStream<Uint8Array> for the FileManager API. */
function stringToStream(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

// ---------------------------------------------------------------------------
// Barretenberg singleton (lazy init, once per worker lifetime)
// ---------------------------------------------------------------------------

let _bbInstance: import('@aztec/bb.js').BarretenbergSync | null = null;
let _Fr: typeof import('@aztec/bb.js').Fr | null = null;

async function getBb() {
  if (_bbInstance && _Fr) return { instance: _bbInstance, Fr: _Fr };
  const { BarretenbergSync, Fr } = await import('@aztec/bb.js');
  _bbInstance = await BarretenbergSync.initSingleton();
  _Fr = Fr;
  return { instance: _bbInstance, Fr };
}

// ---------------------------------------------------------------------------
// Poseidon2 helpers (mirror the Noir circuit's hash functions)
// ---------------------------------------------------------------------------

async function poseidon2Hash(fields: bigint[]): Promise<bigint> {
  const { instance, Fr } = await getBb();
  const frFields = fields.map((f) => new Fr(f));
  const result = instance.poseidon2Hash(frFields);
  return BigInt(result.toString());
}

async function computeCommitment(
  kycLevel: bigint,
  countryCode: bigint,
  salt: bigint,
): Promise<bigint> {
  // poseidon2_hash_4(kyc_level, country_code, salt, 0)
  return poseidon2Hash([kycLevel, countryCode, salt, 0n]);
}

async function computeNullifier(commitment: bigint, salt: bigint): Promise<bigint> {
  // poseidon2_hash_2(commitment, salt)
  return poseidon2Hash([commitment, salt]);
}

// ---------------------------------------------------------------------------
// Proof generation
// ---------------------------------------------------------------------------

interface ZkProofRequest {
  circuitSource: string;
  kycLevel: number;
  countryCode: number;
  salt: string;
  requiredKyc: number;
  allowedCountry: number;
}

interface ZkProofResult {
  proofHex: string;
  publicInputsHex: string;
  vkHex: string;
  nullifierHex: string;
  commitmentHex: string;
}

async function generateProof(req: ZkProofRequest): Promise<ZkProofResult> {
  const { circuitSource, kycLevel, countryCode, salt, requiredKyc, allowedCountry } = req;

  // ── Step 1: Warm up Barretenberg WASM ──────────────────────────────────
  progress('Initialising Barretenberg WASM…');
  await getBb();

  // ── Step 2: Set up FileManager with correct Nargo project layout ───────
  // CR-2: writeFile(ReadableStream) replaces the non-existent addFile().
  // CR-3: The compiler expects a project root with Nargo.toml + src/main.nr.
  //       Compile '/' (the root), not a bare source file path.
  progress('Compiling Noir circuit…');
  const { compile, createFileManager } = await import('@noir-lang/noir_wasm');
  const fm = createFileManager('/');

  const naroToml = `[package]\nname = "zk_comply"\ntype = "bin"\n[dependencies]\n`;
  await fm.writeFile('./Nargo.toml', stringToStream(naroToml));
  await fm.writeFile('./src/main.nr', stringToStream(circuitSource));

  // Compile the project root; compiled.program holds bytecode + abi.
  const compiled = await compile('/');

  // ── Step 3: Initialise UltraHonk backend ───────────────────────────────
  progress('Initialising UltraHonk backend…');
  const { UltraHonkBackend } = await import('@aztec/bb.js');
  const bytecode = compiled.program.bytecode;
  const backend = new UltraHonkBackend(bytecode, {
    threads:
      (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4,
  });

  // ── Step 4: Pre-compute public inputs ──────────────────────────────────
  progress('Computing Poseidon2 commitment and nullifier…');
  const saltBig = BigInt(salt);
  const commitment = await computeCommitment(
    BigInt(kycLevel),
    BigInt(countryCode),
    saltBig,
  );
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

  // ── Step 5: Generate witness ────────────────────────────────────────────
  // CR-4: Pass compiled.program (the artifact with abi + bytecode), not the
  //       wrapper returned by compile().
  progress('Executing Noir circuit to generate witness…');
  const { Noir } = await import('@noir-lang/noir_js');
  const program = new Noir(compiled.program);
  const { witness } = await program.execute(circuitInputs);

  // ── Step 6: Generate ZK proof ───────────────────────────────────────────
  // CR-5: Pass { keccakZK: true } to select a witness-hiding ZK flavor.
  //       Without this, generateProof uses UltraFlavor which sets HasZK=false
  //       and does NOT provide witness-hiding guarantees for credentials.
  //       The same option must be passed to getVerificationKey so the VK
  //       matches the proof flavor.
  progress('Generating UltraHonk ZK-SNARK proof…');
  const { proof, publicInputs } = await backend.generateProof(witness, { keccakZK: true });
  const vk = await backend.getVerificationKey({ keccakZK: true });

  // ── Step 7: Serialise outputs ───────────────────────────────────────────
  const proofBytes = proof instanceof Uint8Array ? proof : Uint8Array.from(proof as ArrayLike<number>);
  const vkBytes = vk instanceof Uint8Array ? vk : Uint8Array.from(vk as ArrayLike<number>);

  const publicInputsBytes = hexToBytes(
    (publicInputs as string[])
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

self.addEventListener('message', async (event: MessageEvent) => {
  const { type, payload } = event.data ?? {};
  if (type !== 'GENERATE_PROOF') return;

  try {
    const result = await generateProof(payload as ZkProofRequest);
    self.postMessage({ type: 'PROOF_RESULT', payload: result });
  } catch (err) {
    self.postMessage({
      type: 'PROOF_ERROR',
      payload: { message: err instanceof Error ? err.message : String(err) },
    });
  }
});
