"use client";

import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/auth-context";
import { useStellarWalletsKit } from "@/lib/stellar-wallets-kit";
import * as userApi from "@/lib/api/user";
import { clearTempPassphrase } from "@/lib/passcode-manager";
import {
  readForceWalletSetupFlag,
  clearForceWalletSetupFlag,
} from "@/lib/force-wallet-setup";
import { AlertCircle, ChevronLeft, Lock } from "lucide-react";
import { Keypair } from "@stellar/stellar-sdk";
import { logger } from "@/lib/logger";
import { useI18n } from "@/contexts/i18n-context";

export function WalletSetupModal() {
  const { t } = useI18n();
  const { userId, stellarAddress, refreshStellarAddress, isAuthenticated } =
    useAuth();
  const kit = useStellarWalletsKit();
  const [open, setOpen] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // 1: auto-generated, 2: import seed, 3: connect wallet
  const [option, setOption] = useState<number | null>(null);

  // For importing seed
  const [importSeed, setImportSeed] = useState("");

  useEffect(() => {
    if (!isAuthenticated) {
      setOpen(false);
      return;
    }
    // Check if user has removed their local wallet from settings
    // If they have no stellarAddress, we definitely show it.
    // If they have a stellarAddress, but want to re-import, we need a way to trigger it.
    // Let's check `hasStoredWallet` if they have a stellarAddress.
    // But since WalletKit might be used without local storage, we shouldn't force the modal
    // just because they lack local storage.
    // However, if the user specifically clears the wallet (which reloads the page)
    // AND they have no `stellarAddress` OR we want them to re-setup, we should show it.
    // For now, if `!stellarAddress` it shows up.
    // If they clicked "Remove Local Wallet", they probably want to re-import, but if stellarAddress is still there,
    // they can't. Let's add a flag in localStorage "force_wallet_setup".
    const forceSetup = readForceWalletSetupFlag();

    if (!stellarAddress || forceSetup) {
      setOpen(true);
    } else {
      setOpen(false);
    }
  }, [isAuthenticated, stellarAddress]);

  const handleFinish = async () => {
    clearTempPassphrase();
    clearForceWalletSetupFlag();
    await refreshStellarAddress();
    setOpen(false);
  };

  const handleGenerateConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    setLoading(true);
    try {
      await generateWallet(passphrase);
      await handleFinish();
    } catch (err: unknown) {
      setError((err as Error).message || t("wallet.errors.save_failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleImportSeed = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!importSeed) {
      setError(t("wallet.errors.seed_required"));
      return;
    }

    setLoading(true);
    try {
      await importWallet(importSeed);
      await handleFinish();
    } catch (err: unknown) {
      setError(
        t("wallet.errors.import_failed") + " " + ((err as Error).message || ""),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleConnectWallet = async () => {
    setError("");

    setLoading(true);
    try {
      if (!userId) throw new Error(t("wallet.errors.not_logged_in"));

      // This will prompt the user to select and connect a wallet
      await kit.openModal({
        onWalletSelected: async (selectedOption: { id: string }) => {
          try {
            kit.setWallet(selectedOption.id);
            const { address: pubKey } = await kit.getAddress();

            // Update wallet address on backend
            const result = await userApi.putWalletAddress(pubKey);
            if (
              !result?.ok ||
              (result.stellar_address && result.stellar_address !== pubKey)
            ) {
              throw new Error(t("wallet.errors.address_rejected"));
            }

            // Confirm wallet activation on backend
            try {
              await userApi.postWalletConfirm({ wallet_address: pubKey });
            } catch (err) {
              logger.warn(
                "Wallet confirm failed, but wallet address was set. User can continue.",
                err,
              );
            }

            handleFinish();
          } catch (e: unknown) {
            setError((e as Error).message || t("wallet.errors.connect_failed"));
          }
        },
      });
    } catch (err: unknown) {
      setError((err as Error).message || t("wallet.errors.connect_failed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        // Prevent closing setup until a wallet address has been set.
        if (isAuthenticated && !stellarAddress) return;
        setOpen(val);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("wallet.modal.title")}</DialogTitle>
          <DialogDescription>{t("wallet.modal.description")}</DialogDescription>
        </DialogHeader>

        {error && (
          <div className="border-destructive/30 bg-destructive/10 mb-2 flex gap-3 rounded-lg border p-3">
            <AlertCircle className="text-destructive mt-0.5 h-4 w-4 flex-shrink-0" />
            <p className="text-destructive text-sm">{error}</p>
          </div>
        )}

        {!option ? (
          <div className="space-y-4 py-4">
            <Button
              data-testid="generate-wallet-button"
              onClick={() => {
                // Always generate a fresh key when user explicitly chooses "Generate New Wallet"
                const kp = Keypair.random();
                setPassphrase(kp.secret());
                setOption(1);
              }}
              className="flex h-auto w-full flex-col items-center py-4"
              variant="outline"
            >
              <span className="font-semibold">
                {t("wallet.generate.title")}
              </span>
              <span className="text-muted-foreground mt-1 text-center text-xs text-wrap">
                {t("wallet.generate.description")}
              </span>
            </Button>

            <Button
              data-testid="import-wallet-button"
              onClick={() => setOption(2)}
              className="flex h-auto w-full flex-col items-center py-4"
              variant="outline"
            >
              <span className="font-semibold">{t("wallet.import.title")}</span>
              <span className="text-muted-foreground mt-1 text-center text-xs text-wrap">
                {t("wallet.import.description")}
              </span>
            </Button>

            <Button
              onClick={handleConnectWallet}
              disabled={loading}
              className="bg-primary text-primary-foreground hover:bg-primary/90 flex h-auto w-full flex-col items-center py-4"
            >
              <span className="font-semibold">
                {loading
                  ? t("wallet.connect.connecting")
                  : t("wallet.connect.title")}
              </span>
              <span className="text-primary-foreground/70 mt-1 text-center text-xs text-wrap">
                {t("wallet.connect.description")}
              </span>
            </Button>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            <Button
              variant="ghost"
              onClick={() => setOption(null)}
              className="mb-2 -ml-2 h-8 px-2"
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              {t("wallet.modal.back")}
            </Button>

            {option === 1 && (
              <form onSubmit={handleGenerateConfirm} className="space-y-4">
                <h2 className="text-lg font-semibold">
                  {t("wallet.generate.new_wallet")}
                </h2>

                <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
                  <Lock className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-600 dark:text-blue-400" />
                  <p className="text-xs text-blue-800 dark:text-blue-300">
                    {t("wallet.security_notice")}
                  </p>
                </div>

                <p className="text-muted-foreground text-sm">
                  {t("wallet.generate.save_key_notice")}
                </p>
                <div className="bg-muted border-border rounded border p-3 font-mono text-xs break-all">
                  {passphrase}
                </div>

                <Button type="submit" disabled={loading} className="w-full">
                  {loading
                    ? t("wallet.generate.saving")
                    : t("wallet.generate.saved")}
                </Button>
              </form>
            )}

            {option === 2 && (
              <form onSubmit={handleImportSeed} className="space-y-4">
                <h2 className="text-lg font-semibold">
                  {t("wallet.import.heading")}
                </h2>

                <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
                  <Lock className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-600 dark:text-blue-400" />
                  <p className="text-xs text-blue-800 dark:text-blue-300">
                    {t("wallet.security_notice")}
                  </p>
                </div>

                <p className="text-muted-foreground text-sm">
                  {t("wallet.import.seed_help")}
                </p>

                <label htmlFor="wallet-setup-import-seed" className="sr-only">
                  {t("wallet.import.seed_label")}
                </label>
                <Input
                  id="wallet-setup-import-seed"
                  type="password"
                  placeholder="Starts with S..."
                  aria-label={t("wallet.import.seed_label")}
                  value={importSeed}
                  onChange={(e) => setImportSeed(e.target.value)}
                  disabled={loading}
                />

                <Button type="submit" disabled={loading} className="w-full">
                  {loading
                    ? t("wallet.import.importing")
                    : t("wallet.import.submit")}
                </Button>
              </form>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
