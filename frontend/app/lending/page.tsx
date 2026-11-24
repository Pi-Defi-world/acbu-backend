"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Briefcase,
  HandCoins,
  ShieldAlert,
  CheckCircle2,
  AlertCircle,
  Clock,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageContainer } from "@/components/layout/page-container";
import { useApiOpts } from "@/hooks/use-api";
import * as lendingApi from "@/lib/api/lending";
import * as userApi from "@/lib/api/user";
import { formatAmount } from "@/lib/utils";
import {
  listApplications,
  saveApplication,
  type StoredLoanApplication,
} from "@/lib/lending-store";
import { useI18n } from "@/contexts/i18n-context";
import { BalanceSkeleton } from "@/components/ui/balance-skeleton";

interface LoanProduct {
  id: string;
  translationKey: "personal" | "business" | "emergency";
  minAmount: number;
  maxAmount: number;
  minTerm: number;
  maxTerm: number;
  ratePct: number;
  icon: LucideIcon;
}

const LOAN_PRODUCTS: LoanProduct[] = [
  {
    id: "personal",
    translationKey: "personal",
    minAmount: 50,
    maxAmount: 5000,
    minTerm: 3,
    maxTerm: 24,
    ratePct: 12,
    icon: HandCoins,
  },
  {
    id: "business",
    translationKey: "business",
    minAmount: 500,
    maxAmount: 25000,
    minTerm: 6,
    maxTerm: 36,
    ratePct: 9,
    icon: Briefcase,
  },
  {
    id: "emergency",
    translationKey: "emergency",
    minAmount: 25,
    maxAmount: 1000,
    minTerm: 1,
    maxTerm: 6,
    ratePct: 15,
    icon: ShieldAlert,
  },
];

function generateLocalId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `local-${crypto.randomUUID()}`;
  }
  // Fallback: use crypto.getRandomValues for a cryptographically random suffix
  // instead of Math.random(), which is non-cryptographic and collision-prone.
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `local-${Date.now()}-${hex}`;
}

export default function LendingPage() {
  const { t } = useI18n();
  const opts = useApiOpts();

  const [apiUser, setApiUser] = useState("");
  const [balance, setBalance] = useState<string | number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const [productId, setProductId] = useState<string>(LOAN_PRODUCTS[0]!.id);
  const [amount, setAmount] = useState('');
  const [term, setTerm] = useState('');
  const [purpose, setPurpose] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [warningMessage, setWarningMessage] = useState("");

  const [applications, setApplications] = useState<StoredLoanApplication[]>([]);

  useEffect(() => {
    setApplications(listApplications());
  }, []);

  useEffect(() => {
    let cancelled = false;
    userApi
      .getReceive(opts)
      .then((data) => {
        const uri = (data.pay_uri ?? data.alias) as string | undefined;
        if (!cancelled && uri) setApiUser(uri);
      })
      .catch(() => {
        /* ignore — lender identity falls back to empty */
      });
    return () => {
      cancelled = true;
    };
  }, [opts.token]);

  useEffect(() => {
    if (!apiUser) return;
    let cancelled = false;
    setBalanceLoading(true);
    setBalanceError(null);
    lendingApi
      .getLendingBalance(apiUser, opts)
      .then((res) => {
        if (!cancelled) setBalance(res.balance);
      })
      .catch((err) => {
        if (!cancelled) {
          setBalance(null);
          setBalanceError(
            err instanceof Error
              ? err.message
              : "Failed to load lending balance",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setBalanceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiUser, opts.token]);

  const selectedProduct = useMemo(
    () => LOAN_PRODUCTS.find((p) => p.id === productId) ?? LOAN_PRODUCTS[0]!,
    [productId]
  );

  const parsedAmount = parseFloat(amount);
  const parsedTerm = parseInt(term, 10);
  const amountValid =
    Number.isFinite(parsedAmount) &&
    parsedAmount >= selectedProduct.minAmount &&
    parsedAmount <= selectedProduct.maxAmount;
  const termValid =
    Number.isFinite(parsedTerm) &&
    parsedTerm >= selectedProduct.minTerm &&
    parsedTerm <= selectedProduct.maxTerm;
  const canSubmit = amountValid && termValid && !submitting;

  const resetForm = () => {
    setAmount("");
    setTerm("");
    setPurpose("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    setSuccessMessage("");
    setWarningMessage("");

    if (!amountValid) {
      setFormError(
        t("lending.errors.amount_range", {
          min: selectedProduct.minAmount,
          max: selectedProduct.maxAmount,
        }),
      );
      return;
    }
    if (!termValid) {
      setFormError(
        t("lending.errors.term_range", {
          min: selectedProduct.minTerm,
          max: selectedProduct.maxTerm,
        }),
      );
      return;
    }

    setSubmitting(true);

    let loanId = generateLocalId();
    let synced = false;
    let errorMessage: string | undefined;

    try {
      const res = await lendingApi.applyForLoan(
        {
          productId: selectedProduct.id,
          amount: parsedAmount,
          term: parsedTerm,
        },
        opts,
      );
      if (res.loanId) loanId = res.loanId;
      synced = Boolean(res.success);
    } catch (err) {
      errorMessage =
        err instanceof Error ? err.message : t("lending.errors.backend_sync");
    }

    const record: StoredLoanApplication = {
      id: loanId,
      productId: selectedProduct.id,
      productName: t(`lending.products.${selectedProduct.translationKey}.name`),
      amount: parsedAmount,
      term: parsedTerm,
      purpose: purpose.trim() || undefined,
      applicantUser: apiUser || undefined,
      status: synced ? "submitted" : "pending",
      syncedWithBackend: synced,
      submittedAt: new Date().toISOString(),
      errorMessage,
    };

    const next = saveApplication(record);
    setApplications(next);
    resetForm();
    setSubmitting(false);

    if (synced) {
      setSuccessMessage(t("lending.messages.submitted", { id: loanId }));
    } else {
      setSuccessMessage(t("lending.messages.saved", { id: loanId }));
      setWarningMessage(
        errorMessage
          ? t("lending.messages.pending_with_error", { error: errorMessage })
          : t("lending.messages.pending"),
      );
    }
  };

  return (
    <>
      <header className="page-header">
        <div className="mx-auto flex max-w-md items-center gap-3 px-4 py-4">
          <Link
            href="/"
            className="hover:bg-muted rounded p-2 transition-colors"
            aria-label={t("lending.go_back")}
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex-1">
            <h1 className="page-title">{t("lending.title")}</h1>
            <p className="text-muted-foreground text-xs">
              {t("lending.subtitle")}
            </p>
          </div>
          <Link
            href="/lending/admin"
            className="text-primary text-xs font-medium hover:underline"
          >
            {t("lending.backoffice")}
          </Link>
        </div>
      </header>

      <PageContainer>
        <div className="space-y-6">
          <Card className="border-border bg-gradient-to-br from-amber-500/10 to-amber-600/10 p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-foreground text-sm font-semibold">
                {t("lending.position")}
              </h2>
              <Wallet className="h-5 w-5 text-amber-600" />
            </div>
            {balanceError ? (
              <div 
                className="border-destructive/30 bg-destructive/5 text-destructive flex items-center gap-2 rounded-lg border p-3 text-xs"
                role="alert"
                aria-live="assertive"
                aria-atomic="true"
              >
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <p>{balanceError}</p>
              </div>
            ) : balanceLoading ? (
              <BalanceSkeleton variant="full" />
            ) : (
              <>
                <p className="text-foreground text-2xl font-bold">
                  {apiUser
                    ? `ACBU ${formatAmount(balance ?? 0)}`
                    : t("lending.sign_in_to_view")}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {apiUser
                    ? t("lending.lender", { user: apiUser })
                    : t("lending.lender_unavailable")}
                </p>
              </>
            )}
          </Card>

          <div className="space-y-3">
            <h3 className="text-foreground text-sm font-semibold">
              {t("lending.choose_product")}
            </h3>
            <div className="grid grid-cols-1 gap-3">
              {LOAN_PRODUCTS.map((product) => {
                const Icon = product.icon;
                const active = product.id === productId;
                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => setProductId(product.id)}
                    className={`w-full rounded-xl border p-4 text-left transition-all ${
                      active
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:border-primary/50"
                    }`}
                    aria-pressed={active}
                  >
                    <div className="flex items-center gap-3">
                      <div className="bg-muted rounded-lg p-2">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-foreground font-semibold">
                            {t(
                              `lending.products.${product.translationKey}.name`,
                            )}
                          </p>
                          <Badge variant="secondary" className="text-xs">
                            {t("lending.apr", { rate: product.ratePct })}
                          </Badge>
                        </div>
                        <p className="text-muted-foreground text-xs">
                          {t(
                            `lending.products.${product.translationKey}.description`,
                          )}
                        </p>
                        <p className="text-muted-foreground mt-1 text-xs">
                          ACBU {product.minAmount}–{product.maxAmount} ·{" "}
                          {t("lending.term_months", {
                            min: product.minTerm,
                            max: product.maxTerm,
                          })}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <Card className="border-border p-4">
            <h3 className="text-foreground mb-4 text-sm font-semibold">
              {t("lending.application_details")}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="loan-amount" className="text-foreground">
                  {t("lending.amount")}
                </Label>
                <Input
                  id="loan-amount"
                  type="number"
                  inputMode="decimal"
                  min={selectedProduct.minAmount}
                  max={selectedProduct.maxAmount}
                  step="any"
                  placeholder={`${selectedProduct.minAmount} – ${selectedProduct.maxAmount}`}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="border-border"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="loan-term" className="text-foreground">
                  {t("lending.term")}
                </Label>
                <Input
                  id="loan-term"
                  type="number"
                  inputMode="numeric"
                  min={selectedProduct.minTerm}
                  max={selectedProduct.maxTerm}
                  step="1"
                  placeholder={`${selectedProduct.minTerm} – ${selectedProduct.maxTerm}`}
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  className="border-border"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="loan-purpose" className="text-foreground">
                  {t("lending.purpose")}
                </Label>
                <Textarea
                  id="loan-purpose"
                  placeholder={t("lending.purpose_placeholder")}
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  rows={3}
                  maxLength={500}
                  className="border-border"
                />
              </div>

              {formError && (
                <div className="border-destructive/30 bg-destructive/5 text-destructive flex items-start gap-2 rounded-lg border p-3 text-xs">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>{formError}</p>
                </div>
              )}
              {successMessage && (
                <div className="flex items-start gap-2 rounded-lg border border-green-500/30 bg-green-500/5 p-3 text-xs text-green-700 dark:text-green-400">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>{successMessage}</p>
                </div>
              )}
              {warningMessage && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>{warningMessage}</p>
                </div>
              )}

              <Button type="submit" disabled={!canSubmit} className="w-full">
                {submitting ? t("lending.submitting") : t("lending.submit")}
              </Button>
            </form>
          </Card>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-foreground text-sm font-semibold">
                {t("lending.your_applications")}
              </h3>
              <Link
                href="/lending/admin"
                className="text-primary text-xs font-medium"
              >
                {t("lending.view_all")}
              </Link>
            </div>
            {applications.length === 0 ? (
              <Card className="border-border p-4">
                <p className="text-muted-foreground text-sm">
                  {t("lending.no_applications")}
                </p>
              </Card>
            ) : (
              <div className="space-y-2">
                {applications.slice(0, 5).map((app) => (
                  <Card key={app.id} className="border-border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-foreground text-sm font-semibold">
                          {app.productName}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {t("lending.application_summary", {
                            amount: formatAmount(app.amount),
                            term: app.term,
                          })}
                        </p>
                        <p
                          className="text-muted-foreground mt-1 truncate text-xs"
                          title={t("lending.reference", { id: app.id })}
                        >
                          {t("lending.reference", { id: app.id })}
                        </p>
                      </div>
                      <Badge
                        variant={
                          app.syncedWithBackend ? "default" : "secondary"
                        }
                        className="text-xs capitalize"
                      >
                        {t(`lending.status.${app.status}`)}
                      </Badge>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </PageContainer>
    </>
  );
}
