"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { PageContainer } from "@/components/layout/page-container";
import { useAuth } from "@/contexts/auth-context";
import { getPasscode, clearTempPassphrase } from "@/lib/passcode-manager";
import { AlertCircle, CheckCircle, ChevronLeft, Lock } from "lucide-react";
import { Keypair } from "@stellar/stellar-sdk";
import { useWalletSetup } from "@/hooks/use-wallet-setup";
import { logger } from "@/lib/logger";

/**
 * Wallet Setup Confirmation Page
 *
 * This page is shown after user signs up/signs in with a newly created wallet.
 * It allows the user to confirm and complete their wallet setup, then syncs
 * the wallet to the backend and calls postWalletConfirm to activate it.
 */
export default function WalletSetupPage() {
  const t = useTranslations("auth.walletSetup");
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) ?? "en";
  const { userId, stellarAddress, refreshStellarAddress, isAuthenticated } = useAuth();
  const { generateWallet, importWallet, connectExternalWallet } = useWalletSetup();
  
  const [passphrase, setPassphrase] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [option, setOption] = useState<number | null>(null);
  const [importSeed, setImportSeed] = useState("");

  useEffect(() => {
    if (!isAuthenticated) {
      router.push(`/${locale}/auth/signin`);
      return;
    }

    // Guard: Check if passcode is available in memory
    const passcode = getPasscode();
    if (!passcode) {
      clearTempPassphrase();
      router.push(`/${locale}/auth/signin`);
      return;
    }

    if (stellarAddress) {
      router.push(`/${locale}`);
      return;
    }
  }, [isAuthenticated, stellarAddress, router, locale]);



  const handleGenerateConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!passphrase) {
      setError(t("errors.passphraseRequired"));
      return;
    }

    setLoading(true);
    try {
      await generateWallet(passphrase);
      setSuccess(t("success.walletSetUp"));
      
      clearTempPassphrase();
      await refreshStellarAddress();
      
      setTimeout(() => {
        router.push(`/${locale}`);
      }, 1500);
    } catch (err: unknown) {
      setError((err as Error).message || t("errors.setupFailed"));
      setLoading(false);
    }
  };

  const handleImportSeed = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!importSeed) {
      setError(t("errors.seedRequired"));
      return;
    }

    setLoading(true);
    try {
      await importWallet(importSeed);
      setSuccess(t("success.walletImported"));
      
      clearTempPassphrase();
      await refreshStellarAddress();

      setTimeout(() => {
        router.push(`/${locale}`);
      }, 1500);
    } catch (err: unknown) {
      setError(
        t("errors.importFailed") + " " + ((err as Error).message || ""),
      );
      setLoading(false);
    }
  };

  const handleConnectWallet = async () => {
    setError("");

    setLoading(true);
    try {
      await connectExternalWallet();
      setSuccess(t("success.walletConnected"));
      await refreshStellarAddress();

      setTimeout(() => {
        router.push(`/${locale}`);
      }, 1500);
    } catch (err: unknown) {
      setError((err as Error).message || t("errors.connectFailed"));
      setLoading(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <div className="px-4 py-3">
          <h1 className="page-title">{t("title")}</h1>
          <p className="text-muted-foreground text-xs">
            {t("subtitle")}
          </p>
        </div>
      </div>

      <PageContainer>
        <Dialog open>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t("dialogTitle")}</DialogTitle>
              <DialogDescription>
                {t("dialogDescription")}
              </DialogDescription>
            </DialogHeader>

            {error && (
              <div
                id="wallet-setup-error"
                role="alert"
                className="flex gap-3 p-3 rounded-lg border border-destructive/30 bg-destructive/10"
              >
                <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" aria-hidden="true" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            {success && (
              <div className="flex gap-3 p-3 rounded-lg border border-green-500/30 bg-green-500/10">
                <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-green-600">{success}</p>
              </div>
            )}

            {!option ? (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {t("chooseMethod")}
                </p>

              <Button
                onClick={() => {
                  const kp = Keypair.random();
                  setPassphrase(kp.secret());
                  setOption(1);
                }}
                disabled={loading}
                className="flex h-auto w-full flex-col items-center py-4"
                variant="outline"
              >
                <span className="font-semibold">{t("generate.title")}</span>
                <span className="text-muted-foreground mt-1 text-xs">
                  {t("generate.description")}
                </span>
              </Button>

              <Button
                onClick={() => setOption(2)}
                disabled={loading}
                className="flex h-auto w-full flex-col items-center py-4"
                variant="outline"
              >
                <span className="font-semibold">{t("import.title")}</span>
                <span className="text-muted-foreground mt-1 text-xs">
                  {t("import.description")}
                </span>
              </Button>

              <Button
                onClick={handleConnectWallet}
                disabled={loading}
                className="bg-primary text-primary-foreground hover:bg-primary/90 flex h-auto w-full flex-col items-center py-4"
              >
                <span className="font-semibold">
                  {loading ? t("connect.connecting") : t("connect.title")}
                </span>
                <span className="text-primary-foreground/70 mt-1 text-xs">
                  {t("connect.description")}
                </span>
              </Button>
              </div>
            ) : (
              <div className="space-y-4">
              <Button
                variant="ghost"
                onClick={() => setOption(null)}
                className="mb-2 -ml-2 h-8 px-2"
                disabled={loading}
              >
                <ChevronLeft className="mr-1 h-4 w-4" />
                {t("back")}
              </Button>

              {option === 1 && (
                <form onSubmit={handleGenerateConfirm} className="space-y-4">
                  <div>
                    <h2 className="mb-2 text-lg font-semibold">
                      {t("generate.newWalletTitle")}
                    </h2>

                    <div className="mb-3 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
                      <Lock className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-600 dark:text-blue-400" />
                      <p className="text-xs text-blue-800 dark:text-blue-300">
                        {t("securityNotice")}
                      </p>
                    </div>

                    <p className="text-muted-foreground text-sm">
                      {t("generate.saveWarning")}
                    </p>
                  </div>

                  <div className="bg-muted border-border max-h-32 overflow-y-auto rounded border p-3 font-mono text-xs break-all">
                    {passphrase}
                  </div>

                  <Button type="submit" disabled={loading} className="w-full">
                    {loading ? t("generate.saving") : t("generate.savedKey")}
                  </Button>
                </form>
              )}

              {option === 2 && (
                <form onSubmit={handleImportSeed} className="space-y-4">
                  <div>
                    <h2 className="mb-2 text-lg font-semibold">{t("import.title")}</h2>

                    <div className="mb-3 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
                      <Lock className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-600 dark:text-blue-400" />
                      <p className="text-xs text-blue-800 dark:text-blue-300">
                        {t("securityNotice")}
                      </p>
                    </div>

                    <p className="text-muted-foreground text-sm">
                      {t("import.instructions")}
                    </p>
                  </div>

                  <Input
                    id="import-seed"
                    type="password"
                    placeholder={t("import.placeholder")}
                    value={importSeed}
                    onChange={(e) => setImportSeed(e.target.value)}
                    disabled={loading}
                    aria-describedby={error ? "wallet-setup-error" : undefined}
                  />

                  <Button type="submit" disabled={loading} className="w-full">
                    {loading ? t("import.importing") : t("import.importWallet")}
                  </Button>
                </form>
              )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </PageContainer>
    </>
  );
}