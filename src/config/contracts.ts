import { config } from "./env";

export interface ContractAddresses {
  oracle: string;
  reserveTracker: string;
  minting: string;
  burning: string;
  savingsVault: string;
  lendingPool: string;
  escrow: string;
  zkVerifier: string;
}

/**
 * Get contract addresses from environment variables
 * These should be set after contract deployment
 */
export const getContractAddresses = (): ContractAddresses => {
  const network = config.stellar.network;

  // Try to load from environment variables first
  const addresses: ContractAddresses = {
    oracle: process.env[`CONTRACT_ORACLE_${network.toUpperCase()}`] || "",
    reserveTracker: process.env[`CONTRACT_RESERVE_TRACKER_${network.toUpperCase()}`] || "",
    minting: process.env[`CONTRACT_MINTING_${network.toUpperCase()}`] || "",
    burning: process.env[`CONTRACT_BURNING_${network.toUpperCase()}`] || "",
    savingsVault: process.env[`CONTRACT_SAVINGS_VAULT_${network.toUpperCase()}`] || "",
    lendingPool: process.env[`CONTRACT_LENDING_POOL_${network.toUpperCase()}`] || "",
    escrow: process.env[`CONTRACT_ESCROW_${network.toUpperCase()}`] || "",
    zkVerifier: process.env[`CONTRACT_ZK_VERIFIER_${network.toUpperCase()}`] || "",
  };

  // Fallback to generic environment variables
  if (!addresses.oracle) {
    addresses.oracle = process.env.CONTRACT_ORACLE || "";
  }
  if (!addresses.reserveTracker) {
    addresses.reserveTracker = process.env.CONTRACT_RESERVE_TRACKER || "";
  }
  if (!addresses.minting) {
    addresses.minting = process.env.CONTRACT_MINTING || "";
  }
  if (!addresses.burning) {
    addresses.burning = process.env.CONTRACT_BURNING || "";
  }
  if (!addresses.savingsVault) {
    addresses.savingsVault = process.env.CONTRACT_SAVINGS_VAULT || "";
  }
  if (!addresses.lendingPool) {
    addresses.lendingPool = process.env.CONTRACT_LENDING_POOL || "";
  }
  if (!addresses.escrow) {
    addresses.escrow = process.env.CONTRACT_ESCROW || "";
  }
  if (!addresses.zkVerifier) {
    addresses.zkVerifier = process.env.CONTRACT_ZK_VERIFIER || "";
  }

  return addresses;
};

/**
 * Validate that all contract addresses are set
 */
export const validateContractAddresses = (): void => {
  const addresses = getContractAddresses();
  const missing: string[] = [];

  if (!addresses.oracle) missing.push("oracle");
  if (!addresses.reserveTracker) missing.push("reserveTracker");
  if (!addresses.minting) missing.push("minting");
  if (!addresses.burning) missing.push("burning");

  if (missing.length > 0) {
    throw new Error(
      `Missing contract addresses: ${missing.join(", ")}. Please set the CONTRACT_* environment variables.`,
    );
  }
};
