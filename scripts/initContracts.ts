import "dotenv/config";

import { contractClient, ContractClient } from "../src/services/stellar/contractClient";
import { xdr, Address } from "@stellar/stellar-sdk";
import {
  ORACLE_MIN_SIGNATURES,
  meetsOracleQuorum,
  parseOracleValidatorAddresses,
} from "../src/config/oracleValidators";

const ADMIN = "GDHO63RZEUNDRVF6WA7HD4D7PLNLUMSK5H74ONW3MEF3VKF4BZJ6GDML";
const ORACLE = "CCJ6L5CVLRSLYVYWMEFSC3QZ5OHAB2DEVFV6GUWCAMF4NZIO7CYE66OQ";
const MINTING = "CDMP4TQHVYBO2QVGLRBGFJWDCUVYW6N6W4QKBPJBUQAMSPMBH53ATTSP";
const BURNING = "CD5WQGBEX3HUH7INUXK4LVMVTK7OIPAQZHJDIRKZNINXNWTBSFSYU2N3";
const RESERVE_TRACKER = "CAXWKQCLIKG5TFYYJCWDVTW7B4LXYBRCXDWYLKCIILMG2BTZK6YQ3DMH";
const ACBU_TOKEN = "CB2RDXQAIQT5XG3XTRHKAGLMV24TPLCOKBFXVELF2PJS4K42UYXZT6KI";
const USDC_TOKEN = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

async function initializeAll() {
  const sourceAccount = ADMIN;

  console.log("--- Starting Initialization via TS SDK ---");

  // 1. Oracle
  try {
    console.log("Checking Oracle status...");
    try {
      const adminResult = await contractClient.readContract(ORACLE, "get_admin", []);
      console.log("Oracle already initialized with admin:", ContractClient.fromScVal(adminResult));
    } catch (readError) {
      console.log("Initializing Oracle...");
      const validators = parseOracleValidatorAddresses(process.env.ORACLE_VALIDATOR_ADDRESSES);
      const currencies = ["NGN", "ZAR", "KES", "EGP", "GHS", "RWF", "XOF", "MAD", "TZS", "UGX"];
      const weights = [
        { key: "EGP", value: 11 },
        { key: "GHS", value: 9 },
        { key: "KES", value: 12 },
        { key: "MAD", value: 7 },
        { key: "NGN", value: 18 },
        { key: "RWF", value: 8 },
        { key: "TZS", value: 6 },
        { key: "UGX", value: 6 },
        { key: "XOF", value: 8 },
        { key: "ZAR", value: 15 },
      ];

      await contractClient.invokeContract({
        contractId: ORACLE,
        functionName: "initialize",
        args: [
          Address.fromString(ADMIN).toScVal(), // admin
          xdr.ScVal.scvVec(validators.map((validator) => Address.fromString(validator).toScVal())),
          xdr.ScVal.scvU32(ORACLE_MIN_SIGNATURES),
          xdr.ScVal.scvVec(currencies.map((c) => xdr.ScVal.scvVec([xdr.ScVal.scvString(c)]))), // currencies: Vec<CurrencyCode>
          xdr.ScVal.scvMap(
            weights.map(
              (w) =>
                new xdr.ScMapEntry({
                  key: xdr.ScVal.scvVec([xdr.ScVal.scvString(w.key)]), // CurrencyCode
                  val: ContractClient.bigIntToI128(BigInt(w.value)),
                }),
            ),
          ),
        ],
        sourceAccount,
      });
      console.log("Oracle initialized.");
    }

    const [validatorsResult, minSignaturesResult] = await Promise.all([
      contractClient.readContract(ORACLE, "get_validators", []),
      contractClient.readContract(ORACLE, "get_min_signatures", []),
    ]);
    const validators = ContractClient.fromScVal(validatorsResult);
    const minSignatures = Number(ContractClient.fromScVal(minSignaturesResult));
    if (!Array.isArray(validators) || !meetsOracleQuorum(validators, minSignatures)) {
      throw new Error(
        "Oracle contract quorum is below 3-of-5; update validator configuration before continuing",
      );
    }
  } catch (e: unknown) {
    console.log("Oracle init skipped or failed:", e instanceof Error ? e.message : e);
    throw e;
  }

  // 2. Minting
  try {
    console.log("Checking Minting status...");
    try {
      const adminResult = await contractClient.readContract(MINTING, "get_admin", []);
      console.log("Minting already initialized with admin:", ContractClient.fromScVal(adminResult));
    } catch (readError) {
      console.log("Initializing Minting...");
      await contractClient.invokeContract({
        contractId: MINTING,
        functionName: "initialize",
        args: [
          Address.fromString(ADMIN).toScVal(),
          Address.fromString(ORACLE).toScVal(),
          Address.fromString(RESERVE_TRACKER).toScVal(),
          Address.fromString(ACBU_TOKEN).toScVal(),
          Address.fromString(USDC_TOKEN).toScVal(),
          Address.fromString(ADMIN).toScVal(),
          Address.fromString(ADMIN).toScVal(),
          ContractClient.bigIntToI128(BigInt(30)),
          ContractClient.bigIntToI128(BigInt(50)),
        ],
        sourceAccount,
      });
      console.log("Minting initialized.");
    }
  } catch (e: any) {
    console.log("Minting init failed:", e.message);
  }

  // 3. Burning
  try {
    console.log("Checking Burning status...");
    try {
      const adminResult = await contractClient.readContract(BURNING, "get_admin", []);
      console.log("Burning already initialized with admin:", ContractClient.fromScVal(adminResult));
    } catch (readError) {
      console.log("Initializing Burning...");
      await contractClient.invokeContract({
        contractId: BURNING,
        functionName: "initialize",
        args: [
          Address.fromString(ADMIN).toScVal(),
          Address.fromString(ORACLE).toScVal(),
          Address.fromString(RESERVE_TRACKER).toScVal(),
          Address.fromString(ACBU_TOKEN).toScVal(),
          Address.fromString(ADMIN).toScVal(),
          Address.fromString(ADMIN).toScVal(),
          ContractClient.bigIntToI128(BigInt(30)),
          ContractClient.bigIntToI128(BigInt(100)),
        ],
        sourceAccount,
      });
      console.log("Burning initialized.");
    }
  } catch (e: any) {
    console.log("Burning init failed:", e.message);
  }

  console.log("--- Initialization complete ---");
}

initializeAll().catch(console.error);
