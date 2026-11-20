import { Address } from "@stellar/stellar-sdk";

export const ORACLE_MIN_SIGNATURES = 3;
export const ORACLE_VALIDATOR_COUNT = 5;

export function meetsOracleQuorum(validators: readonly unknown[], minSignatures: number): boolean {
  const uniqueValidators = new Set(
    validators.filter((validator): validator is string => typeof validator === "string"),
  );
  return uniqueValidators.size >= ORACLE_VALIDATOR_COUNT && minSignatures >= ORACLE_MIN_SIGNATURES;
}

export function parseOracleValidatorAddresses(value: string | undefined): string[] {
  if (!value) {
    throw new Error(
      "ORACLE_VALIDATOR_ADDRESSES must contain five comma-separated Stellar validator public keys",
    );
  }

  const addresses = value.split(",").map((address) => address.trim());
  if (
    addresses.length !== ORACLE_VALIDATOR_COUNT ||
    addresses.some((address) => !/^G[A-Z2-7]{55}$/.test(address))
  ) {
    throw new Error(
      `ORACLE_VALIDATOR_ADDRESSES must contain exactly ${ORACLE_VALIDATOR_COUNT} Stellar account addresses`,
    );
  }

  const normalized = addresses.map((address) => Address.fromString(address).toString());
  if (new Set(normalized).size !== ORACLE_VALIDATOR_COUNT) {
    throw new Error("ORACLE_VALIDATOR_ADDRESSES must contain five unique addresses");
  }

  return normalized;
}
