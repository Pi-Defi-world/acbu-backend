"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { PageContainer } from "@/components/layout/page-container";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, CheckCircle, AlertCircle, Key, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useApiOpts } from "@/hooks/use-api";
import { useAuth } from "@/contexts/auth-context";
import { removeStoredWallet, hasStoredWallet } from "@/lib/wallet-storage";
import * as userApi from "@/lib/api/user";
import { setForceWalletSetup } from "@/lib/force-wallet-setup";

export default function WalletPage() {
  const opts = useApiOpts();
  const { userId, stellarAddress } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [hasLocalSecret, setHasLocalSecret] = useState(false);

  const loadWalletInfo = async () => {
    try {
      setLoading(true);
      setError("");
      if (userId) {
        const hasSecret = await hasStoredWallet(userId);
        setHasLocalSecret(hasSecret);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load wallet information",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWalletInfo();
  }, [opts.token, userId]);

  const handleRemoveWallet = async () => {
    try {
      setLoading(true);
      setError("");

      // Clear the backend's stellar address first so signin/modal logic can
      // cleanly re-issue or accept a new wallet. Doing this BEFORE wiping the
      // local seed means a failure here leaves the user in a consistent state
      // (seed still present, mint still works with the old address).
      await userApi.deleteWallet();

      if (userId) {
        await removeStoredWallet(userId);
      }

      setSuccess("Wallet removed. Reloading so you can set up a fresh wallet…");
      setHasLocalSecret(false);

      setForceWalletSetup();

      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove wallet");
      setLoading(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <div className="page-header-row">
          <Link href="/me/settings" className="touch-target">
            <ArrowLeft className="text-primary h-5 w-5" />
          </Link>
          <h1 className="page-title">Wallet Settings</h1>
        </div>
      </div>
      <PageContainer>
        <Card className="border-border space-y-6 p-6">
          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <>
              {error && (
                <div className="bg-destructive/10 border-destructive/20 flex gap-2 rounded-lg border p-3">
                  <AlertCircle className="text-destructive mt-0.5 h-4 w-4 flex-shrink-0" />
                  <p className="text-destructive text-sm">{error}</p>
                </div>
              )}
              {success && (
                <div className="flex gap-2 rounded-lg border border-green-500/20 bg-green-500/10 p-3">
                  <CheckCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-600" />
                  <p className="text-sm text-green-600">{success}</p>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-foreground flex items-center gap-2 text-sm font-medium">
                  <Key className="h-4 w-4" /> Connected Stellar Address
                </label>
                {stellarAddress ? (
                  <div className="bg-muted border-border rounded-lg border p-3">
                    <p className="text-muted-foreground font-mono text-xs break-all">
                      {stellarAddress}
                    </p>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    No wallet connected.
                  </p>
                )}
              </div>

              <div className="border-border space-y-2 border-t pt-4">
                <h3 className="text-foreground flex items-center gap-2 text-sm font-medium">
                  Local Keystore
                </h3>
                <p className="text-muted-foreground text-xs">
                  {hasLocalSecret
                    ? "Your secret key is stored on this device (IndexedDB)."
                    : "No secret key is stored on this device. You may be using an external wallet."}
                </p>
              </div>

              <div className="pt-6">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="destructive"
                      className="flex w-full items-center gap-2"
                      disabled={loading}
                    >
                      <Trash2 className="h-4 w-4" />
                      {hasLocalSecret
                        ? "Remove Local Wallet"
                        : "Reset Wallet Connection"}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove wallet?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Your local secret will be deleted and the backend will
                        forget the address. You&apos;ll be prompted to set up a
                        new wallet on next use. This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleRemoveWallet}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Remove wallet
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <p className="text-muted-foreground mt-3 text-center text-xs">
                  Removing your wallet will disconnect it from this device. You
                  will need your secret phrase or external wallet to reconnect.
                </p>
              </div>
            </>
          )}
        </Card>
      </PageContainer>
    </>
  );
}
