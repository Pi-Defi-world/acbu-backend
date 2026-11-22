"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { PageContainer } from "@/components/layout/page-container";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft } from "lucide-react";
import { useApiOpts } from "@/hooks/use-api";
import * as userApi from "@/lib/api/user";
import * as savingsApi from "@/lib/api/savings";
import { resolveRecipient } from "@/lib/api/recipient";
import { logger } from "@/lib/logger";

async function resolveUserUri(
  raw: string,
  opts: Parameters<typeof resolveRecipient>[1],
): Promise<string> {
  try {
    const resolved = await resolveRecipient(raw, opts);
    return resolved.pay_uri ?? resolved.alias ?? raw;
  } catch {
    return raw;
  }
}

export default function SavingsDepositPage() {
    const opts = useApiOpts();
    const [user, setUser] = useState("");
    const [amount, setAmount] = useState("");
    const [termSeconds, setTermSeconds] = useState("0");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

  useEffect(() => {
    let cancelled = false;
    userApi.getReceive(opts).then(async (data) => {
      const uri = (data.pay_uri ?? data.alias) as string | undefined;
      if (!uri || typeof uri !== 'string') return;
      const resolved = await resolveUserUri(uri, opts);
      if (!cancelled) setUser(resolved);
    }).catch((e) => {
      logger.error(e instanceof Error ? e.message : 'Failed to load receive address');
    }).finally(() => {
      if (cancelled) return;
    });
    return () => { cancelled = true; };
  }, [opts.token]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setSuccess("");
        if (!user.trim()) {
            setError("Your account address is still loading. Please try again shortly.");
            return;
        }
        if (!amount || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
            setError("Enter an amount greater than zero.");
            return;
        }
        setLoading(true);
        try {
            await savingsApi.savingsDeposit(
                {
                    user: user.trim(),
                    amount,
                    term_seconds: parseInt(termSeconds, 10) || 0,
                },
                opts,
            );
            setSuccess("Deposit submitted.");
        } catch (e) {
            setError(e instanceof Error ? e.message : "Deposit failed");
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <div className="page-header">
                <div className="page-header-row">
                    <Link href="/savings">
                        <ArrowLeft className="w-5 h-5 text-primary" />
                    </Link>
                    <h1 className="page-title">
                        Deposit
                    </h1>
                </div>
            </div>
            <PageContainer>
                <Card className="border-border p-4 space-y-4">
                    {error && (
                        <p
                            id="deposit-error"
                            role="alert"
                            aria-live="assertive"
                            className="text-destructive text-sm"
                        >
                            {error}
                        </p>
                    )}
                    {success && (
                        <p
                            id="deposit-success"
                            role="status"
                            aria-live="polite"
                            className="text-green-600 text-sm"
                        >
                            {success}
                        </p>
                    )}
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label
                                htmlFor="deposit-account"
                                className="form-label"
                            >
                                Your account
                            </label>
                            <Input
                                id="deposit-account"
                                value={user}
                                readOnly
                                className="border-border font-mono text-sm bg-muted"
                                aria-describedby={error ? "deposit-error" : undefined}
                            />
                        </div>
                        <div>
                            <label
                                htmlFor="deposit-amount"
                                className="form-label"
                            >
                                Amount
                            </label>
                            <Input
                                id="deposit-amount"
                                type="number"
                                min="0"
                                step="any"
                                value={amount}
                                onChange={(e) => {
                                    setAmount(e.target.value);
                                    setError("");
                                }}
                                className="border-border"
                                aria-invalid={Boolean(error)}
                                aria-describedby={error ? "deposit-error" : undefined}
                            />
                        </div>
                        <div>
                            <label
                                htmlFor="deposit-term"
                                className="form-label"
                            >
                                Term (seconds)
                            </label>
                            <Input
                                id="deposit-term"
                                type="number"
                                min="0"
                                value={termSeconds}
                                onChange={(e) => {
                                    setTermSeconds(e.target.value);
                                    setError("");
                                }}
                                className="border-border"
                                aria-invalid={Boolean(error)}
                                aria-describedby={error ? "deposit-error" : undefined}
                            />
                        </div>
                        <Button
                            type="submit"
                            disabled={loading}
                        >
                            Deposit
                        </Button>
                    </form>
                </Card>
            </PageContainer>
        </>
    );
}
