/**
 * Read-only Horizon verification for Stellar issuer, distribution, and treasury accounts.
 *
 * Checks account existence, asset balances, signer weights, and thresholds using
 * public keys (G...) only — never reads or accepts secret seeds (S...).
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/verify-stellar-accounts.ts G... [G...]
 *   STELLAR_TREASURY_ACCOUNT_ID=G... npx ts-node --transpile-only scripts/verify-stellar-accounts.ts
 */

import "dotenv/config";

interface HorizonBalance {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
}

interface HorizonSigner {
  key: string;
  weight: number;
  type: string;
}

interface HorizonAccountResponse {
  id: string;
  sequence: string;
  thresholds: {
    low_threshold: number;
    med_threshold: number;
    high_threshold: number;
  };
  signers: HorizonSigner[];
  balances: HorizonBalance[];
}

const DEFAULT_HORIZON_URLS: Record<string, string> = {
  testnet: "https://horizon-testnet.stellar.org",
  mainnet: "https://horizon.stellar.org",
};

function isValidPublicKey(value: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(value);
}

function collectAccountIds(argv: string[]): string[] {
  const candidates = [
    ...argv,
    process.env.STELLAR_TREASURY_ACCOUNT_ID ?? "",
    process.env.STELLAR_ISSUER_ACCOUNT_ID ?? "",
    process.env.STELLAR_DISTRIBUTION_ACCOUNT_ID ?? "",
  ]
    .map((v) => v.trim())
    .filter(Boolean);

  for (const id of candidates) {
    if (id.startsWith("S")) {
      throw new Error(
        "Refusing to accept a Stellar secret seed (S...). Pass public keys (G...) only.",
      );
    }
    if (!isValidPublicKey(id)) {
      throw new Error(`Invalid Stellar public key: ${id}`);
    }
  }

  return Array.from(new Set(candidates));
}

async function inspectAccount(horizonUrl: string, accountId: string): Promise<boolean> {
  const url = `${horizonUrl.replace(/\/+$/, "")}/accounts/${accountId}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`[FAIL] ${accountId}: Horizon returned HTTP ${res.status}`);
    return false;
  }

  const account = (await res.json()) as HorizonAccountResponse;
  const masterSigner = account.signers.find((s) => s.key === account.id);
  const masterWeight = masterSigner?.weight ?? 0;

  console.log(`\nAccount: ${account.id}`);
  console.log(
    `  Thresholds (low/med/high): ${account.thresholds.low_threshold}/${account.thresholds.med_threshold}/${account.thresholds.high_threshold}`,
  );
  console.log(`  Signers (${account.signers.length}):`);
  for (const signer of account.signers) {
    console.log(`    - ${signer.key} (type=${signer.type}, weight=${signer.weight})`);
  }

  if (account.signers.length === 1 && masterWeight > 0) {
    console.warn(
      "  [WARN] Single master signer active; transition to HSM or multi-sig and zero out master weight.",
    );
  }

  console.log("  Balances:");
  for (const bal of account.balances) {
    const asset =
      bal.asset_type === "native" ? "XLM" : `${bal.asset_code}:${bal.asset_issuer ?? "unknown"}`;
    console.log(`    - ${asset}: ${bal.balance}`);
  }

  return true;
}

async function main(): Promise<void> {
  const network = (process.env.STELLAR_NETWORK ?? "testnet").toLowerCase();
  const horizonUrl =
    process.env.STELLAR_HORIZON_URL ?? DEFAULT_HORIZON_URLS[network] ?? DEFAULT_HORIZON_URLS.testnet;

  const accountIds = collectAccountIds(process.argv.slice(2));
  if (accountIds.length === 0) {
    console.error(
      "Usage: ts-node --transpile-only scripts/verify-stellar-accounts.ts <PUBLIC_KEY_G...>",
    );
    process.exit(1);
  }

  console.log(`Verifying ${accountIds.length} Stellar account(s) on ${network} (${horizonUrl})`);
  let allOk = true;
  for (const id of accountIds) {
    const ok = await inspectAccount(horizonUrl, id);
    if (!ok) allOk = false;
  }

  if (!allOk) process.exit(1);
}

main().catch((err) => {
  console.error("Verification failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
