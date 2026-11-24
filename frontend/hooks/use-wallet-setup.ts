"use client";

import { useCallback } from "react";
import { Keypair } from "@stellar/stellar-sdk";
import type { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { useAuth } from "@/contexts/auth-context";
import { useStellarWalletsKit } from "@/lib/stellar-wallets-kit";
import * as userApi from "@/lib/api/user";
import { storeWalletSecret, getWalletSecretAnyLocal } from "@/lib/wallet-storage";
import { getPasscode } from "@/lib/passcode-manager";
import { logger } from "@/lib/logger";
import type { ApiOpts } from "@/hooks/use-api";

export interface WalletSigner {
  userSecret?: string;
  external?: {
    kit: StellarWalletsKit;
    address: string;
  };
  address: string;
}

export function useWalletSetup() {
  const { userId, stellarAddress, refreshStellarAddress } = useAuth();
  const kit = useStellarWalletsKit();

  /**
  * Stores the secret encrypted locally and sends only its public address to the backend.
   */
  const syncWalletToBackend = useCallback(
    async (secret: string, opts?: ApiOpts): Promise<string> => {
      if (!userId) throw new Error("Not logged in");

      const passcode = getPasscode();
      if (!passcode) {
        throw new Error("Passcode not available. Please log in again to set up your wallet.");
      }

      const kp = Keypair.fromSecret(secret);
      const publicKey = kp.publicKey();

      // Step 1: Store secret encrypted with passcode locally
      await storeWalletSecret(userId, secret, passcode);

      // Step 2: Update wallet address on backend
      const result = await userApi.putWalletAddress(publicKey, opts);
      if (!result?.ok || (result.stellar_address && result.stellar_address !== publicKey)) {
        throw new Error("Backend did not accept the new wallet address. Please retry.");
      }

      // Step 3: Confirm wallet activation on backend
      try {
        await userApi.postWalletConfirm({ wallet_address: publicKey }, opts);
      } catch (err) {
        logger.warn("Wallet confirm failed, but wallet address was set. User can continue.", err);
      }

      return publicKey;
    },
    [userId]
  );

  /**
   * Generates a new random wallet or uses provided passphrase/secret, syncs to backend and stores it.
   */
  const generateWallet = useCallback(
    async (existingSecret?: string, opts?: ApiOpts): Promise<{ secret: string; publicKey: string }> => {
      const secret = existingSecret || Keypair.random().secret();
      const publicKey = await syncWalletToBackend(secret, opts);
      return { secret, publicKey };
    },
    [syncWalletToBackend]
  );

  /**
   * Imports an existing Stellar seed, syncs to backend and stores it.
   */
  const importWallet = useCallback(
    async (seed: string, opts?: ApiOpts): Promise<{ publicKey: string }> => {
      if (!seed) throw new Error("Seed is required.");
      Keypair.fromSecret(seed);
      const publicKey = await syncWalletToBackend(seed, opts);
      return { publicKey };
    },
    [syncWalletToBackend]
  );

  /**
   * Prompts user to connect an external wallet (Freighter, Lobstr, etc.) via StellarWalletsKit,
   * updates the backend address and confirms activation.
   */
  const connectExternalWallet = useCallback(
    async (opts?: ApiOpts): Promise<{ publicKey: string }> => {
      if (!kit) throw new Error("Wallet Kit is still initializing...");
      if (!userId) throw new Error("Not logged in");

      return new Promise<{ publicKey: string }>((resolve, reject) => {
        kit
          .openModal({
            onWalletSelected: async (selectedOption: { id: string }) => {
              try {
                kit.setWallet(selectedOption.id);
                const { address: pubKey } = await kit.getAddress();

                const result = await userApi.putWalletAddress(pubKey, opts);
                if (!result?.ok || (result.stellar_address && result.stellar_address !== pubKey)) {
                  throw new Error("Backend did not accept the wallet address. Please retry.");
                }

                try {
                  await userApi.postWalletConfirm({ wallet_address: pubKey }, opts);
                } catch (err) {
                  logger.warn("Wallet confirm failed, but wallet address was set. User can continue.", err);
                }

                resolve({ publicKey: pubKey });
              } catch (e) {
                reject(e);
              }
            },
            onClosed: (err?: unknown) => {
              reject(err || new Error("Wallet modal closed"));
            },
          })
          .catch(reject);
      });
    },
    [kit, userId]
  );

  /**
   * Obtains a wallet signer (local secret or connected external wallet) for transaction signing.
   * Performs address matching validation against the user's recorded stellarAddress.
   */
  const getWalletSigner = useCallback(async (): Promise<WalletSigner> => {
    if (!userId) {
      throw new Error("Not signed in — refresh and try again.");
    }

    const secret = await getWalletSecretAnyLocal(userId, stellarAddress);

    if (secret) {
      const localPubKey = Keypair.fromSecret(secret).publicKey();
      if (stellarAddress && localPubKey !== stellarAddress) {
        throw new Error(
          `Local wallet (${localPubKey.slice(0, 6)}…${localPubKey.slice(-4)}) doesn't match the account on record (${stellarAddress.slice(0, 6)}…${stellarAddress.slice(-4)}). Re-import the correct seed from Settings, or update the wallet address, then retry.`
        );
      }
      return {
        userSecret: secret,
        address: localPubKey,
      };
    } else {
      if (!kit) {
        throw new Error(
          "Your wallet secret isn't available on this device and the wallet connector isn't ready yet. Please wait a moment and retry."
        );
      }

      const address = await new Promise<string>((resolve, reject) => {
        kit
          .openModal({
            onWalletSelected: async (selectedOption: { id: string }) => {
              try {
                kit.setWallet(selectedOption.id);
                const { address } = await kit.getAddress();
                resolve(address);
              } catch (err) {
                reject(err);
              }
            },
            onClosed: (err?: unknown) => {
              reject(err || new Error("Wallet modal closed"));
            },
          })
          .catch(reject);
      });

      if (stellarAddress && address !== stellarAddress) {
        throw new Error(
          `Connected wallet (${address.slice(0, 6)}…${address.slice(-4)}) doesn't match the account on record (${stellarAddress.slice(0, 6)}…${stellarAddress.slice(-4)}). Connect the correct wallet (or update your linked wallet), then retry.`
        );
      }

      return {
        external: { kit, address },
        address,
      };
    }
  }, [userId, stellarAddress, kit]);

  return {
    syncWalletToBackend,
    generateWallet,
    importWallet,
    connectExternalWallet,
    getWalletSigner,
    refreshStellarAddress,
  };
}
