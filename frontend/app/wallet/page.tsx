"use client";

import React, { useEffect, useRef, useState } from "react";
import { PageContainer } from "@/components/layout/page-container";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "next/navigation";
import { getPasscode } from "@/lib/passcode-manager";
import {
  AlertCircle,
  Wallet,
  Key,
  Link as LinkIcon,
  CheckCircle,
  Lock,
} from "lucide-react";
import { Keypair } from "@stellar/stellar-sdk";
import { useApiOpts, useApiError } from "@/hooks/use-api";
import { useWalletSetup } from "@/hooks/use-wallet-setup";
import { useI18n } from "@/contexts/i18n-context";

export default function WalletPage() {
  const { t } = useI18n();
  const { userId, stellarAddress, refreshStellarAddress, logout } = useAuth();
  const opts = useApiOpts();
  const router = useRouter();
  const { generateWallet, importWallet, connectExternalWallet } =
    useWalletSetup();
  const [passphrase, setPassphrase] = useState("");
  const { uiError, setApiError: handleError, clearError } = useApiError();
  const error = uiError?.message ?? "";
  const setError = (msg: string) => handleError(new Error(msg));
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (successTimerRef.current) {
        clearTimeout(successTimerRef.current);
      }
    };
  }, []);

  // 1: auto-generated, 2: import seed, 3: connect wallet
  const [option, setOption] = useState<number | null>(null);

  // For importing seed
  const [importSeed, setImportSeed] = useState("");

  useEffect(() => {
    if (option === 1 && !passphrase) {
      // Generate a new keypair when they select Generate
      const keypair = Keypair.random();
      setPassphrase(keypair.secret());
    }
  }, [option, passphrase]);

  const handleFinish = async (msg: string) => {
    await refreshStellarAddress();
    setSuccessMsg(msg);
    setOption(null);
    setImportSeed("");
    setPassphrase("");
    if (successTimerRef.current) {
      clearTimeout(successTimerRef.current);
    }
    successTimerRef.current = setTimeout(() => {
      setSuccessMsg("");
      successTimerRef.current = null;
    }, 3000);
  };

  const handleGenerateConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    setLoading(true);
    try {
      if (!userId) throw new Error(t("wallet.errors.not_logged_in"));

      const passcode = getPasscode();
      if (!passcode) {
        await logout();
        router.push("/auth/signin");
        return;
      }

      await generateWallet(passphrase, opts);
      await handleFinish(t("wallet.success.created"));
    } catch (err: unknown) {
      handleError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleImportSeed = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    if (!importSeed) {
      setError(t("wallet.errors.seed_required"));
      return;
    }

    setLoading(true);
    try {
      if (!userId) throw new Error(t("wallet.errors.not_logged_in"));

      const passcode = getPasscode();
      if (!passcode) {
        await logout();
        router.push("/auth/signin");
        return;
      }

      await importWallet(importSeed, opts);
      await handleFinish(t("wallet.success.imported"));
    } catch (err: unknown) {
      handleError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleConnectWallet = async () => {
    clearError();
    setLoading(true);
    try {
      if (!userId) throw new Error(t("wallet.errors.not_logged_in"));

      await connectExternalWallet(opts);
      await handleFinish(t("wallet.success.connected"));
    } catch (err: unknown) {
      handleError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <div className="px-4 py-3">
          <h1 className="page-title">{t("wallet.title")}</h1>
          <p className="text-muted-foreground text-xs">
            {t("wallet.subtitle")}
          </p>
        </div>
      </div>

      <PageContainer>
        <div className="space-y-6">
          {successMsg && (
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-100 p-3 dark:border-green-800 dark:bg-green-900/30">
              <CheckCircle className="h-5 w-5 flex-shrink-0 text-green-600 dark:text-green-400" />
              <p className="text-sm font-medium text-green-800 dark:text-green-300">
                {successMsg}
              </p>
            </div>
          )}

          {stellarAddress && !option && (
            <Card className="border-border bg-muted/30 p-5">
              <h2 className="mb-2 text-sm font-semibold">
                {t("wallet.current_address")}
              </h2>
              <div className="bg-background border-border rounded-lg border p-3">
                <p className="text-muted-foreground font-mono text-xs break-all">
                  {stellarAddress}
                </p>
              </div>
            </Card>
          )}

          {!option ? (
            <div className="space-y-4">
              <h2 className="text-base font-semibold">
                {t("wallet.setup_title")}
              </h2>

              <Button
                onClick={() => setOption(1)}
                className="flex h-auto w-full items-center justify-start gap-4 px-5 py-4"
                variant="outline"
              >
                <div className="bg-primary/10 text-primary rounded-full p-2">
                  <Wallet className="h-5 w-5" />
                </div>
                <div className="text-left">
                  <span className="block font-semibold">
                    {t("wallet.generate.title")}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t("wallet.generate.description")}
                  </span>
                </div>
              </Button>

              <Button
                onClick={() => setOption(2)}
                className="flex h-auto w-full items-center justify-start gap-4 px-5 py-4"
                variant="outline"
              >
                <div className="bg-primary/10 text-primary rounded-full p-2">
                  <Key className="h-5 w-5" />
                </div>
                <div className="text-left">
                  <span className="block font-semibold">
                    {t("wallet.import.title")}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t("wallet.import.description")}
                  </span>
                </div>
              </Button>

              <Button
                onClick={handleConnectWallet}
                disabled={loading}
                className="bg-primary text-primary-foreground hover:bg-primary/90 flex h-auto w-full items-center justify-start gap-4 px-5 py-4"
              >
                <div className="bg-primary-foreground/20 rounded-full p-2">
                  <LinkIcon className="h-5 w-5" />
                </div>
                <div className="text-left">
                  <span className="block font-semibold">
                    {loading
                      ? t("wallet.connect.connecting")
                      : t("wallet.connect.title")}
                  </span>
                  <span className="text-primary-foreground/70 text-xs">
                    {t("wallet.connect.description")}
                  </span>
                </div>
              </Button>

              {error && (
                <p className="text-destructive mt-2 text-center text-sm">
                  {error}
                </p>
              )}
            </div>
          ) : (
            <Card className="border-border p-5">
              <Button
                variant="ghost"
                onClick={() => {
                  setOption(null);
                  setError("");
                }}
                className="mb-4 -ml-2"
              >
                {t("wallet.back")}
              </Button>

              {error && (
                <div className="border-destructive/30 bg-destructive/10 mb-4 flex gap-3 rounded-lg border p-3">
                  <AlertCircle className="text-destructive mt-0.5 h-4 w-4 flex-shrink-0" />
                  <p className="text-destructive text-sm">{error}</p>
                </div>
              )}

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
                  <div className="bg-muted rounded p-3 font-mono text-sm break-all">
                    {passphrase}
                  </div>

                  <Button
                    type="submit"
                    disabled={loading}
                    className="mt-4 w-full"
                  >
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

                  <div>
                    <label htmlFor="import-seed" className="sr-only">
                      {t("wallet.import.seed_label")}
                    </label>
                    <Input
                      id="import-seed"
                      type="password"
                      placeholder="S..."
                      aria-label={t("wallet.import.seed_label")}
                      value={importSeed}
                      onChange={(e) => setImportSeed(e.target.value)}
                      disabled={loading}
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={loading}
                    className="mt-4 w-full"
                  >
                    {loading
                      ? t("wallet.import.importing")
                      : t("wallet.import.submit")}
                  </Button>
                </form>
              )}
            </Card>
          )}
        </div>
      </PageContainer>
    </>
  );
}
