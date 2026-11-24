/**
 * Soroban RPC / host errors often stringify poorly in logs; normalize for API responses.
 *
 * Note (W11-CAR-008): the acbu_multisig contract must implement Soroban's custom
 * account interface `__check_auth(signature_payload: Hash<32>, signatures: Vec<Signature>)
 * -> Result<(), Error>` so that other contracts calling `require_auth()` against the
 * multisig address succeed. Errors from that path surface through this normalizer.
 */
export function sorobanErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    const m = (error as { message: unknown }).message;
    if (typeof m === "string" && m.length > 0) return m;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * When simulation fails with MissingValue + "non-existent contract function", the WASM
 * on-chain does not export that symbol (stale deploy vs backend).
 */
export function wrapSorobanInvokeError(
  error: unknown,
  ctx: { contractId: string; functionName: string },
): Error {
  const base = sorobanErrorMessage(error);

  if (
    ctx.functionName === "mint_from_demo_fiat" &&
    base.includes("trustline entry is missing for account")
  ) {
    const wrapped = new Error(
      `${base} Recipient wallet has no trustline for ACBU; establish the trustline before calling on-ramp mint.`,
    );
    (wrapped as Error & { cause?: unknown }).cause = error;
    return wrapped;
  }

  if (
    ctx.functionName === "mint_from_demo_fiat" &&
    base.includes("is_reserve_sufficient") &&
    (/data:\s*false|data:false/i.test(base) ||
      /contract call failed",\s*is_reserve_sufficient/i.test(base) ||
      (base.includes("UnreachableCodeReached") && /is_reserve_sufficient/i.test(base)))
  ) {
    const hint =
      " Reserve check failed on-chain (insufficient backing, overflow in an older reserve tracker WASM, or RPC timeout leaving reserves stale). Re-deploy reserve tracker v3+ (saturating sum + checked mul), run `migrate`, re-seed with `pnpm exec ts-node scripts/seed_onchain_reserves_from_custody.ts`, or lower the mint amount.";
    const wrapped = new Error(`${base}${hint}`);
    (wrapped as Error & { cause?: unknown }).cause = error;
    return wrapped;
  }

  const missingFn =
    base.includes("non-existent contract function") && base.includes(ctx.functionName);
  if (!missingFn) {
    return error instanceof Error ? error : new Error(base);
  }

  const hint =
    ctx.functionName === "admin_drip_demo_fiat" || ctx.functionName === "mint_from_demo_fiat"
      ? ` On-chain contract ${ctx.contractId} does not export '${ctx.functionName}' (deployed WASM is older than this backend). Build the latest acbu_minting WASM, upgrade or redeploy the minting contract, set CONTRACT_MINTING_* to the new id, and seed demo SAC supply to the minter address. See ACBU-DOCUMENTATION/TESTNET_CUSTODIAL_BOOTSTRAP.md.`
      : ` On-chain contract ${ctx.contractId} may need an upgrade to export '${ctx.functionName}'.`;

  const wrapped = new Error(`${base}${hint}`);
  (wrapped as Error & { cause?: unknown }).cause = error;
  return wrapped;
}
