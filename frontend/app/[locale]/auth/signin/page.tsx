"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { AlertCircle, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import * as authApi from "@/lib/api/auth";
import { setPasscode as storePasscode } from "@/lib/passcode-manager";
import { isSafeRedirect } from "@/lib/redirect";
import {
  setChallengeToken,
  setPostAuthRedirect,
} from "@/lib/auth-challenge-store";

export default function SignInPage() {
  const t = useTranslations("auth.signin");
  return (
    <Suspense
      fallback={
        <div className="bg-background flex min-h-screen items-center justify-center p-4">
          <Card className="border-border w-full max-w-md p-8 text-center">
            <div className="text-muted-foreground animate-pulse">
              {t("loading")}
            </div>
          </Card>
        </div>
      }
    >
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams();
  const locale = (params?.locale as string) ?? "en";
  const t = useTranslations("auth.signin");
  const { login } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [passcode, setPasscode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (searchParams.get("created") === "1") {
      setSuccess(t("accountCreated"));
    }
  }, [searchParams, t]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (!identifier.trim() || !passcode) {
        setError(t("errors.missingFields"));
        return;
      }

      const result = await authApi.signin(identifier.trim(), passcode);

      const redirectParam = searchParams.get("redirect");

      if ("requires_2fa" in result && result.requires_2fa) {
        storePasscode(passcode);

        setChallengeToken(result.challenge_token);
        const safe = isSafeRedirect(redirectParam);
        if (safe) setPostAuthRedirect(safe);

        router.push(`/${locale}/auth/2fa`);
        return;
      }

      if ("user_id" in result) {
        storePasscode(passcode);

        login(result.user_id, result.stellar_address, result.api_key);

        if (result.wallet_created || !result.stellar_address) {
          router.push(`/${locale}/auth/wallet-setup`);
        } else {
          const safe = isSafeRedirect(redirectParam);
          router.push(safe ?? `/${locale}`);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.signInFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-background flex min-h-screen items-center justify-center p-4">
      <Card className="border-border w-full max-w-md">
        <div className="p-6 md:p-8">
          <div className="mb-8">
            <h1 className="text-foreground mb-2 text-2xl font-bold md:text-3xl">
              {t("title")}
            </h1>
            <p className="text-muted-foreground text-sm">
              {t("subtitle")}
            </p>
          </div>

          <form onSubmit={handleSignIn} className="space-y-4">
            {error && (
              <div
                id="signin-error"
                role="alert"
                aria-live="assertive"
                className="border-destructive/30 bg-destructive/10 flex gap-3 rounded-lg border p-3"
              >
                <AlertCircle
                  className="text-destructive mt-0.5 h-4 w-4 flex-shrink-0"
                  aria-hidden="true"
                />
                <p className="text-destructive text-sm">{error}</p>
              </div>
            )}
            {success && (
              <div
                id="signin-success"
                role="status"
                aria-live="polite"
                className="flex gap-3 rounded-lg border border-green-500/30 bg-green-500/10 p-3"
              >
                <p className="text-sm text-green-600">{success}</p>
              </div>
            )}

            <div>
              <label htmlFor="signin-detail" className="form-label">
                {t("identifierLabel")}
              </label>
              <Input
                id="signin-detail"
                type="text"
                autoComplete="username"
                placeholder={t("identifierPlaceholder")}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="border-border"
                disabled={loading}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "signin-error" : undefined}
              />
            </div>

            <div>
              <label htmlFor="signin-passcode" className="form-label">
                {t("passcodeLabel")}
              </label>
              <div className="relative">
                <Input
                  id="signin-passcode"
                  type={showPassword ? "text" : "password"}
                  placeholder={t("passcodePlaceholder")}
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  className="border-border pr-10"
                  disabled={loading}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "signin-error" : undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2"
                  aria-label={showPassword ? t("hidePassword") : t("showPassword")}
                  disabled={loading}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="text-right">
              <Link
                href={`/${locale}/auth/signup`}
                className="text-primary hover:text-primary/80 text-sm"
              >
                {t("createAccount")}
              </Link>
            </div>

            <Button
              type="submit"
              className="bg-primary text-primary-foreground hover:bg-primary/90 w-full"
              disabled={loading}
            >
              {loading ? t("submitting") : t("submit")}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-muted-foreground text-sm">
              {t("footer")}
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}