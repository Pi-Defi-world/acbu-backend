import "dotenv/config";

import { xdr } from "@stellar/stellar-sdk";
import { execSync } from "node:child_process";

import { ContractClient } from "../src/services/stellar/contractClient";
import { stellarClient } from "../src/services/stellar/client";
import { getContractAddresses } from "../src/config/contracts";
import { BASKET_CURRENCIES, BASKET_WEIGHTS } from "../src/config/basket";
import {
  ORACLE_MIN_SIGNATURES,
  meetsOracleQuorum,
  parseOracleValidatorAddresses,
} from "../src/config/oracleValidators";

function currencyCodeToScVal(code: string): xdr.ScVal {
  const c = code.trim().toUpperCase();
  // CurrencyCode is a tuple-struct with one field: Vec<String>.
  // Encode as vec([ vec([ string("NGN") ]) ]).
  return xdr.ScVal.scvVec([xdr.ScVal.scvVec([xdr.ScVal.scvString(c)])]);
}

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function basketCurrenciesScVal(): xdr.ScVal {
  return xdr.ScVal.scvVec(BASKET_CURRENCIES.map((c) => currencyCodeToScVal(c)));
}

function basketWeightsMapScVal(): xdr.ScVal {
  const entries = Object.entries(BASKET_WEIGHTS).map(([code, pct]) => {
    const bps = BigInt(Math.round(pct * 100));
    return new xdr.ScMapEntry({
      key: currencyCodeToScVal(code),
      val: ContractClient.bigIntToI128(bps),
    });
  });
  // Soroban requires ScMap keys to be sorted by XDR encoding.
  entries.sort((a, b) => {
    const ax = a.key().toXDR("base64");
    const bx = b.key().toXDR("base64");
    return ax < bx ? -1 : ax > bx ? 1 : 0;
  });
  return xdr.ScVal.scvMap(entries);
}

function tryDeployOrResolveAssetContractId(opts: {
  assetCode: string;
  issuer: string;
  network: string;
  sourceSecret: string;
}): string {
  const asset = `${opts.assetCode}:${opts.issuer}`;

  // First try "deploy" (creates it if not already deployed).
  // Expected stdout includes a contract id line like `C...`.
  try {
    const out = execSync(
      `stellar contract asset deploy --asset "${asset}" --network ${opts.network} --source-account ${opts.sourceSecret}`,
      { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
    );
    const m = out.match(/\bC[A-Z2-7]{55}\b/);
    if (m?.[0]) return m[0];
  } catch {
    // fall through
  }

  // If deploy fails (already deployed / transient), resolve id deterministically.
  const out = execSync(`stellar contract id asset --asset "${asset}" --network ${opts.network}`, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  const m = out.match(/\bC[A-Z2-7]{55}\b/);
  if (!m?.[0]) {
    throw new Error(`Could not resolve SAC contract id for asset ${asset}`);
  }
  return m[0];
}

async function main(): Promise<void> {
  const addresses = getContractAddresses();
  const oracleId = addresses.oracle;
  const mintingId = addresses.minting;
  const sourceSecret = mustGetEnv("STELLAR_SECRET_KEY");
  const issuer = mustGetEnv("STELLAR_ACBU_ASSET_ISSUER");
  const network = (process.env.STELLAR_NETWORK || "testnet").toLowerCase();
  const source = stellarClient.getKeypair()?.publicKey();

  if (!source) {
    throw new Error("No STELLAR_SECRET_KEY configured (missing source keypair).");
  }
  if (!oracleId || !mintingId) {
    throw new Error("Missing CONTRACT_ORACLE / CONTRACT_MINTING in env.");
  }

  const client = new ContractClient();

  // Ensure oracle has a usable basket config after upgrades/migrations.
  // If oracle isn't initialized this will fail and we fall back to `initialize`.
  try {
    await client.invokeContract({
      contractId: oracleId,
      functionName: "set_basket_config",
      sourceAccount: source,
      args: [basketCurrenciesScVal(), basketWeightsMapScVal()],
    });
  } catch {
    const validators = parseOracleValidatorAddresses(process.env.ORACLE_VALIDATOR_ADDRESSES);
    await client.invokeContract({
      contractId: oracleId,
      functionName: "initialize",
      sourceAccount: source,
      args: [
        ContractClient.toScVal(source), // admin
        ContractClient.toScVal(validators),
        xdr.ScVal.scvU32(ORACLE_MIN_SIGNATURES),
        basketCurrenciesScVal(), // currencies
        basketWeightsMapScVal(), // basket_weights (bps)
      ],
    });
  }

  const [validatorsResult, minSignaturesResult] = await Promise.all([
    client.readContract(oracleId, "get_validators", []),
    client.readContract(oracleId, "get_min_signatures", []),
  ]);
  const validators = ContractClient.fromScVal(validatorsResult);
  const minSignatures = Number(ContractClient.fromScVal(minSignaturesResult));
  if (!Array.isArray(validators) || !meetsOracleQuorum(validators, minSignatures)) {
    throw new Error("Oracle contract quorum is below 3-of-5; refusing to seed rates");
  }

  const demoSupply = BigInt("100000000000000000"); // 10B whole units @ 7 decimals

  const deployed: Record<string, string> = {};
  for (const currency of BASKET_CURRENCIES) {
    const tokenContractId = tryDeployOrResolveAssetContractId({
      assetCode: currency,
      issuer,
      network,
      sourceSecret,
    });
    deployed[currency] = tokenContractId;

    await client.invokeContract({
      contractId: oracleId,
      functionName: "set_s_token_address",
      sourceAccount: source,
      args: [currencyCodeToScVal(currency), ContractClient.toScVal(tokenContractId)],
    });

    await client.invokeContract({
      contractId: tokenContractId,
      functionName: "mint",
      sourceAccount: source,
      args: [ContractClient.toScVal(mintingId), ContractClient.bigIntToI128(demoSupply)],
    });
  }

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        ok: true,
        oracleId,
        mintingId,
        mintedTo: mintingId,
        demoSupply: demoSupply.toString(),
        deployed,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
