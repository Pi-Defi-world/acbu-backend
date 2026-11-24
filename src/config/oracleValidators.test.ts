import { Keypair } from "@stellar/stellar-sdk";
import { meetsOracleQuorum, parseOracleValidatorAddresses } from "./oracleValidators";

describe("parseOracleValidatorAddresses", () => {
  it("accepts exactly five unique Stellar account addresses", () => {
    const addresses = Array.from({ length: 5 }, () => Keypair.random().publicKey());

    expect(parseOracleValidatorAddresses(addresses.join(","))).toEqual(addresses);
  });

  it("rejects a validator set with fewer than five addresses", () => {
    const addresses = Array.from({ length: 4 }, () => Keypair.random().publicKey());

    expect(() => parseOracleValidatorAddresses(addresses.join(","))).toThrow(
      "exactly 5 Stellar account addresses",
    );
  });

  it("rejects duplicate and malformed addresses", () => {
    const addresses = Array.from({ length: 4 }, () => Keypair.random().publicKey());

    expect(() => parseOracleValidatorAddresses([...addresses, addresses[0]].join(","))).toThrow(
      "five unique addresses",
    );
    expect(() =>
      parseOracleValidatorAddresses(["invalid", ...addresses.slice(1)].join(",")),
    ).toThrow("exactly 5 Stellar account addresses");
  });
});

describe("meetsOracleQuorum", () => {
  it("requires three signatures and five distinct validators", () => {
    const validators = Array.from({ length: 5 }, () => Keypair.random().publicKey());

    expect(meetsOracleQuorum(validators, 3)).toBe(true);
    expect(meetsOracleQuorum(validators, 2)).toBe(false);
    expect(meetsOracleQuorum([...validators.slice(1), validators[1]], 3)).toBe(false);
  });
});
