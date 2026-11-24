"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { AlertCircle, Eye, EyeOff } from "lucide-react";
import * as authApi from "@/lib/api/auth";

const MIN_PASSCODE_LENGTH = 12;
const STRONG_PASSCODE_MIN_SCORE = 4;
const PASSCODE_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{12,$}$/;

const PASSCODE_WEAK_PATTERNS = [
  "password",
  "passcode",
  "qwerty",
  "letmein",
  "123456",
  "abcdef",
];

const getPasscodeStrength = (value: string, labels: string[]) => {
  let score = 0;

  if (value.length >= MIN_PASSCODE_LENGTH) score += 1;
  if (value.length >= 16) score += 1;
  if (/[a-z]/.test(value)) score += 1;
  if (/[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z\d]/.test(value)) score += 1;

  if (/(.)\1{2,}/.test(value)) score -= 1;
  if (/(0123|1234|2345|3456|4567|5678|6789)/.test(value)) score -= 1;
  if (/(abcd|bcde|cdef|defg|efgh|fghi|ghij)/i.test(value)) score -= 1;

  const lowered = value.toLowerCase();
  if (PASSCODE_WEAK_PATTERNS.some((pattern) => lowered.includes(pattern))) {
    score -= 2;
  }

  const normalizedScore = Math.max(0, Math.min(5, score));
  const barColors = [
    "bg-destructive/80",
    "bg-orange-500/80",
    "bg-amber-500/80",
    "bg-lime-500/80",
    "bg-emerald-500/80",
    "bg-emerald-500",
  ];

  return {
    score: normalizedScore,
    label: labels[normalizedScore],
    barColor: barColors[normalizedScore],
  };
};

export default function SignUpPage() {
  const t = useTranslations("auth.signup");
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) ?? "en";
  const [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState("");
  const [passcode, setPasscode] = useState("");
  const [confirmPasscode, setConfirmPasscode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const strengthLabels = [
    t("strength.veryWeak"),
    t("strength.weak"),
    t("strength.fair"),
    t("strength.good"),
    t("strength.strong"),
    t("strength.veryStrong"),
  ];

  const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUsername(e.target.value.toLowerCase().trim());
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (passcode !== confirmPasscode) {
      setError(t("errors.passcodesDoNotMatch"));
      return;
    }
    if (passcode.length < MIN_PASSCODE_LENGTH) {
      setError(t("errors.passcodeTooShort", { count: MIN_PASSCODE_LENGTH }));
      return;
    }

    if (!PASSCODE_REGEX.test(passcode)) {
      setError(t("errors.passcodePolicy"));
      return;
    }

    const { score } = getPasscodeStrength(passcode, strengthLabels);
    if (score < STRONG_PASSCODE_MIN_SCORE) {
      setError(t("errors.passcodeTooWeak"));
      return;
    }
    if (!username) {
      setError(t("errors.usernameRequired"));
      return;
    }
    setLoading(true);
    try {
      await authApi.signup(username, passcode);
      router.push(`/${locale}/auth/signin?created=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.createFailed"));
    } finally {
      setLoading(false);
    }
  };

  const passcodeStrength = getPasscodeStrength(passcode, strengthLabels);

  return (
    <div className="bg-background flex min-h-screen items-center justify-center p-4">
      <Card className="border-border w-full max-w-md">
        <div className="p-6 md:p-8">
          <Link
            href={`/${locale}/auth/signin`}
            className="text-muted-foreground hover:text-foreground mb-6 inline-flex items-center gap-2 text-sm"
          >
            {t("backToSignIn")}
          </Link>
          <div className="mb-8">
            <h1 className="text-foreground mb-2 text-2xl font-bold md:text-3xl">
              {t("title")}
            </h1>
            <p className="text-muted-foreground text-sm">
              {t("subtitle")}
            </p>
          </div>

          <form onSubmit={handleSignUp} className="space-y-4">
            {error && (
              <div
                id="signup-error"
                role="alert"
                aria-live="assertive"
                className="border-destructive/30 bg-destructive/10 flex gap-3 rounded-lg border p-3"
              >
                <AlertCircle
                  className="text-destructive mt-0.5 h-4 w-4 shrink-0"
                  aria-hidden="true"
                />
                <p className="text-destructive text-sm">{error}</p>
              </div>
            )}

            <div>
              <label htmlFor="signup-username" className="form-label">
                {t("usernameLabel")}
              </label>
              <Input
                id="signup-username"
                type="text"
                autoComplete="username"
                placeholder={t("usernamePlaceholder")}
                value={username}
                onChange={handleUsernameChange}
                className="border-border"
                disabled={loading}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "signup-error" : undefined}
              />
            </div>

            <div>
              <label htmlFor="signup-passcode" className="form-label">
                {t("passcodeLabel", { count: MIN_PASSCODE_LENGTH })}
              </label>
              <div className="relative">
                <Input
                  id="signup-passcode"
                  type={showPassword ? "text" : "password"}
                  placeholder={t("passcodePlaceholder")}
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  className="border-border pr-10"
                  disabled={loading}
                  aria-invalid={Boolean(error)}
                  aria-describedby={
                    [error && "signup-error", "signup-passcode-policy"]
                      .filter(Boolean)
                      .join(" ")
                  }
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2"
                  disabled={loading}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {passcode.length > 0 && (
                <div className="mt-3 space-y-2">
                  <div className="grid grid-cols-5 gap-1">
                    {Array.from({ length: 5 }).map((_, idx) => (
                      <div
                        key={idx}
                        className={`h-1.5 rounded-full ${
                          idx < passcodeStrength.score
                            ? passcodeStrength.barColor
                            : "bg-muted"
                        }`}
                      />
                    ))}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {t("strengthLabel")}{" "}
                    <span className="text-foreground font-medium">
                      {passcodeStrength.label}
                    </span>
                  </p>
                </div>
              )}
              <p className="text-muted-foreground mt-2 text-xs">
                {t("passcodePolicy")}
              </p>
            </div>

            <div>
              <label htmlFor="confirm-passcode" className="form-label">
                {t("confirmPasscodeLabel")}
              </label>
              <Input
                id="confirm-passcode"
                type={showPassword ? "text" : "password"}
                placeholder={t("passcodePlaceholder")}
                value={confirmPasscode}
                onChange={(e) => setConfirmPasscode(e.target.value)}
                className="border-border"
                disabled={loading}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "signup-error" : undefined}
              />
            </div>

            <Button
              type="submit"
              className="bg-primary text-primary-foreground hover:bg-primary/90 w-full"
              disabled={loading}
            >
              {loading ? t("creating") : t("submit")}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-muted-foreground text-sm">
              {t("haveAccount")}{" "}
              <Link
                href={`/${locale}/auth/signin`}
                className="text-primary font-medium"
              >
                {t("signIn")}
              </Link>
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
