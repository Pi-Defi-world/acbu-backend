/**
 * Stellar Soroban contract interactions.
 *
 * Handles deploying the verifier and gate contracts, registering
 * KYC attestations, verifying proofs on-chain, and checking wallet
 * verification status.
 */

import {
  SorobanRpc,
  TransactionBuilder,
  Networks,
  Keypair,
  Contract,
  Operation,
  xdr,
  Address,
  StrKey,
  hash,
  scValToNative,
  nativeToScVal,
} from "@stellar/stellar-sdk";
import type { ProofArtifacts, VerificationResult } from "./types.js";

const TESTNET_RPC = "https://soroban-testnet.stellar.org";
const TESTNET_PASSPHRASE = Networks.TESTNET;

function randomSalt(): Uint8Array {
  const salt = new Uint8Array(32);
  crypto.getRandomValues(salt);
  return salt;
}

/**
 * Derive the contract ID that a `createCustomContract` operation will
 * produce. `result.hash` is only the transaction hash; the contract ID
 * is the hash of the deploy preimage built from the deployer address
 * and the salt used in the operation.
 */
function contractIdFromDeploy(sourceAccount: string, salt: Uint8Array): string {
  const preimage = xdr.ContractIdPreimage.contractIdPreimageFromAddress(
    new xdr.ContractIdPreimageFromAddress({
      address: Address.fromString(sourceAccount).toScAddress(),
      salt: Buffer.from(salt),
    })
  );

  return StrKey.encodeContract(hash(preimage.toXDR()));
}

/**
 * Deploy the ZK-Comply verifier contract.
 *
 * Returns the deployed CONTRACT ID (C...). `createCustomContract`
 * resolves to the contract ID as its operation result — the transaction
 * hash is a different identifier and cannot be used to call the
 * contract afterwards.
 */
export async function deployVerifier(
  secretKey: string,
  wasmHash: Buffer
): Promise<string> {
  const rpc = new SorobanRpc.Server(TESTNET_RPC);
  const keypair = Keypair.fromSecret(secretKey);
  const source = await rpc.getAccount(keypair.publicKey());

  const salt = randomSalt();

  const tx = new TransactionBuilder(source, {
    fee: "10000",
    networkPassphrase: TESTNET_PASSPHRASE,
  })
    .addOperation(
      Operation.createCustomContract({
        address: Address.fromString(keypair.publicKey()),
        wasmHash,
        salt,
      })
    )
    .setTimeout(30)
    .build();

  const prepared = await rpc.prepareTransaction(tx);
  prepared.sign(keypair);
  const result = await rpc.sendTransaction(prepared);

  if (result.status === "ERROR") {
    throw new Error(`Deploy failed: ${JSON.stringify(result)}`);
  }

  return contractIdFromDeploy(keypair.publicKey(), salt);
}

/**
 * Deploy the ZK-Comply gate contract.
 *
 * The gate's constructor takes the address of the verifier contract it
 * delegates compliance checks to. Returns the deployed CONTRACT ID.
 */
export async function deployGate(
  secretKey: string,
  wasmHash: Buffer,
  verifierAddress: string
): Promise<string> {
  const rpc = new SorobanRpc.Server(TESTNET_RPC);
  const keypair = Keypair.fromSecret(secretKey);
  const source = await rpc.getAccount(keypair.publicKey());

  const salt = randomSalt();

  const tx = new TransactionBuilder(source, {
    fee: "10000",
    networkPassphrase: TESTNET_PASSPHRASE,
  })
    .addOperation(
      Operation.createCustomContract({
        address: Address.fromString(keypair.publicKey()),
        wasmHash,
        salt,
        constructorArgs: [Address.fromString(verifierAddress).toScVal()],
      })
    )
    .setTimeout(30)
    .build();

  const prepared = await rpc.prepareTransaction(tx);
  prepared.sign(keypair);
  const result = await rpc.sendTransaction(prepared);

  if (result.status === "ERROR") {
    throw new Error(`Deploy failed: ${JSON.stringify(result)}`);
  }

  return contractIdFromDeploy(keypair.publicKey(), salt);
}

/**
 * Register a KYC attestation binding on the verifier contract
 * (attester only — AZ-002).
 *
 * The KYC authority calls this after a user's redacted KYC review is
 * approved, binding the user's commitment to the attested credential
 * hash `poseidon2(kycLevel, countryCode)` computed from the authority's
 * own verified records. The verifier contract rejects any proof whose
 * commitment was never attested this way, so unverified users can no
 * longer prove self-asserted KYC levels.
 */
export async function registerCommitment(
  attesterSecretKey: string,
  verifierContractId: string,
  commitment: Uint8Array,
  _attestedCredential?: Uint8Array
): Promise<VerificationResult> {
  try {
    const rpc = new SorobanRpc.Server(TESTNET_RPC);
    const attester = Keypair.fromSecret(attesterSecretKey);
    const source = await rpc.getAccount(attester.publicKey());

    const contract = new Contract(verifierContractId);
    const tx = new TransactionBuilder(source, {
      fee: "100000",
      networkPassphrase: TESTNET_PASSPHRASE,
    })
      .addOperation(
        contract.call(
          "register_commitment",
          nativeToScVal(Buffer.from(commitment), { type: "bytesN", length: 32 })
        )
      )
      .setTimeout(30)
      .build();

    const prepared = await rpc.prepareTransaction(tx);
    prepared.sign(attester);
    const result = await rpc.sendTransaction(prepared);

    if (result.status === "SUCCESS") {
      return { success: true, txHash: result.hash };
    }

    return { success: false, error: `Status: ${result.status}` };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Submit a compliance proof result to the verifier contract and mark
 * the calling wallet as verified.
 *
 * On-chain `verify(wallet, nullifier, commitment)` records the spent
 * nullifier after the caller has produced a valid ZK proof off-chain
 * (see `generateProof`). Proof bytes themselves are not posted — the
 * contract enforces attestation + nullifier uniqueness + wallet auth.
 */
export async function submitProof(
  secretKey: string,
  contractId: string,
  artifacts: ProofArtifacts
): Promise<VerificationResult> {
  try {
    if (!artifacts.nullifier || artifacts.nullifier.length !== 32) {
      return { success: false, error: "artifacts.nullifier must be 32 bytes" };
    }
    if (!artifacts.commitment || artifacts.commitment.length !== 32) {
      return { success: false, error: "artifacts.commitment must be 32 bytes" };
    }

    const rpc = new SorobanRpc.Server(TESTNET_RPC);
    const keypair = Keypair.fromSecret(secretKey);
    const source = await rpc.getAccount(keypair.publicKey());

    const contract = new Contract(contractId);
    const tx = new TransactionBuilder(source, {
      fee: "100000",
      networkPassphrase: TESTNET_PASSPHRASE,
    })
      .addOperation(
        contract.call(
          "verify",
          Address.fromString(keypair.publicKey()).toScVal(),
          nativeToScVal(Buffer.from(artifacts.nullifier), {
            type: "bytesN",
            length: 32,
          }),
          nativeToScVal(Buffer.from(artifacts.commitment), {
            type: "bytesN",
            length: 32,
          })
        )
      )
      .setTimeout(30)
      .build();

    const prepared = await rpc.prepareTransaction(tx);
    prepared.sign(keypair);
    const result = await rpc.sendTransaction(prepared);

    // Soroban returns PENDING initially; SUCCESS means accepted into mempool
    // as of stellar-sdk sendTransaction. Treat ERROR as failure.
    if (result.status === "ERROR") {
      return {
        success: false,
        error: `Status: ${result.status}`,
        txHash: result.hash,
      };
    }

    return { success: true, txHash: result.hash };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Check if a wallet address is verified.
 */
export async function isVerified(
  contractId: string,
  walletAddress: string
): Promise<boolean> {
  try {
    const rpc = new SorobanRpc.Server(TESTNET_RPC);

    const contract = new Contract(contractId);
    const result = await rpc.simulateTransaction(
      new TransactionBuilder(
        await rpc.getAccount(walletAddress),
        {
          fee: "10000",
          networkPassphrase: TESTNET_PASSPHRASE,
        }
      )
        .addOperation(
          contract.call(
            "is_verified",
            Address.fromString(walletAddress).toScVal()
          )
        )
        .setTimeout(30)
        .build()
    );

    if (result.result?.retval) {
      const val = scValToNative(result.result.retval);
      return val === true;
    }
    return false;
  } catch {
    return false;
  }
}
