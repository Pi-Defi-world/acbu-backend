import "dotenv/config";

import { xdr } from "@stellar/stellar-sdk";

import { BASKET_CURRENCIES } from "../src/config/basket";
import { getContractAddresses } from "../src/config/contracts";
import { contractClient, ContractClient } from "../src/services/stellar/contractClient";
import {
  OraclePriceError,
  assertPositiveOraclePrice,
  assertValidUpdateReservePayload,
  computeReserveValueUsd,
} from "../src/services/contracts/oraclePrice";
import { logger } from "../src/config/logger";

/** Soroban `CurrencyCode` — tuple struct with one string field. */
function currencyCodeToScVal(code: string): xdr.ScVal {
  const c = code.trim().toUpperCase();
  return xdr.ScVal.scvVec([xdr.ScVal.scvVec([xdr.ScVal.scvString(c)])]);
}

async function main(): Promise<void> {
  const addresses = getContractAddresses();
  if (!addresses.reserveTracker || !addresses.oracle || !addresses.minting) {
    throw new Error("Missing CONTRACT_RESERVE_TRACKER / CONTRACT_ORACLE / CONTRACT_MINTING in env");
  }

  const sourceAccount =
    require("../src/services/stellar/client").stellarClient.getKeypair()?.publicKey?.() ?? "";
  if (!sourceAccount) throw new Error("No STELLAR_SECRET_KEY configured");

  // For each basket currency:
  // - get oracle rate_usd (7-dec fixed; USD per 1 unit of currency)
  // - get s_token contract id (SAC)
  // - read custody balance on minting contract address (7-dec native amount)
  // - compute USD value: (amount * rate_usd) / 1e7
  // - write to reserve tracker: update_reserve(updater, currency, amount, value_usd)
  const failures: { currency: string; message: string }[] = [];

  for (const currency of BASKET_CURRENCIES) {
    logger.info("Seeding reserve", { currency });

    try {
      const rateRes = await contractClient.readContract(addresses.oracle, "get_rate", [
        ContractClient.toScVal([[currency]]),
      ]);
      // W11-CAR-030: refuse to seed reserve values from a zero/missing oracle
      // price; that would write a 0-USD reserve value on-chain and break
      // is_reserve_sufficient (or panic the contract's division).
      const rateUsd = assertPositiveOraclePrice(ContractClient.fromScVal(rateRes), currency);

      const sTokenRes = await contractClient.readContract(addresses.oracle, "get_s_token_address", [
        ContractClient.toScVal([[currency]]),
      ]);
      const sToken = ContractClient.fromScVal(sTokenRes).toString();

      const balRes = await contractClient.readContract(sToken, "balance", [
        ContractClient.toScVal(addresses.minting),
      ]);
      const amount = BigInt(ContractClient.fromScVal(balRes).toString());
      if (amount < 0n) {
        throw new OraclePriceError(`Custody balance for ${currency} is negative: ${amount}`);
      }

      const valueUsd = computeReserveValueUsd(amount, rateUsd, currency);
      assertValidUpdateReservePayload(amount, valueUsd, currency);

      await contractClient.invokeContract({
        contractId: addresses.reserveTracker,
        functionName: "update_reserve",
        sourceAccount,
        args: [
          ContractClient.toScVal(sourceAccount), // updater (ignored by contract)
          currencyCodeToScVal(currency),
          ContractClient.toScVal(amount),
          ContractClient.toScVal(valueUsd),
        ],
      });

      logger.info("Reserve written on-chain", {
        currency,
        amount: amount.toString(),
        valueUsd: valueUsd.toString(),
        rateUsd: rateUsd.toString(),
        sToken,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error("Seeding reserve failed (continuing)", { currency, message });
      failures.push({ currency, message });
    }

    await new Promise((r) => setTimeout(r, 400));
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: failures.length === 0, failures }, null, 2));
  if (failures.length > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
