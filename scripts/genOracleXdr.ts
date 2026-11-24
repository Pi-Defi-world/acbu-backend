import "dotenv/config";

import { xdr, Address } from "@stellar/stellar-sdk";
import {
  ORACLE_MIN_SIGNATURES,
  parseOracleValidatorAddresses,
} from "../src/config/oracleValidators";

function toI128(value: bigint): xdr.ScVal {
  const b = BigInt(value);
  const lo = b & BigInt("0xFFFFFFFFFFFFFFFF");
  const hi = b >> BigInt(64);
  return xdr.ScVal.scvI128(
    new xdr.Int128Parts({
      lo: xdr.Uint64.fromString(lo.toString()),
      hi: xdr.Int64.fromString(hi.toString()),
    }),
  );
}

const currencies = ["NGN", "ZAR", "KES", "EGP", "GHS", "RWF", "XOF", "MAD", "TZS", "UGX"];
const weights = [
  { key: "NGN", value: 18 },
  { key: "ZAR", value: 15 },
  { key: "KES", value: 12 },
  { key: "EGP", value: 11 },
  { key: "GHS", value: 9 },
  { key: "RWF", value: 8 },
  { key: "XOF", value: 8 },
  { key: "MAD", value: 7 },
  { key: "TZS", value: 6 },
  { key: "UGX", value: 6 },
];

const validators = xdr.ScVal.scvVec(
  parseOracleValidatorAddresses(process.env.ORACLE_VALIDATOR_ADDRESSES).map((validator) =>
    Address.fromString(validator).toScVal(),
  ),
);
const currenciesVec = xdr.ScVal.scvVec(
  currencies.map((c) => xdr.ScVal.scvVec([xdr.ScVal.scvString(c)])),
); // Tuple structs are represented as 1-element vectors
const basketWeightsMap = xdr.ScVal.scvMap(
  weights.map(
    (w) =>
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvVec([xdr.ScVal.scvString(w.key)]),
        val: toI128(BigInt(w.value)),
      }),
  ),
);

console.log("Validators XDR:", validators.toXDR("base64"));
console.log("Minimum signatures:", ORACLE_MIN_SIGNATURES);
console.log("Currencies XDR:", currenciesVec.toXDR("base64"));
console.log("Weights XDR:", basketWeightsMap.toXDR("base64"));
