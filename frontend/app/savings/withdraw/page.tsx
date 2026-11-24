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

export default function SavingsWithdrawPage() {
    const opts = useApiOpts();
    const [user, setUser] = useState("");
    const [termSeconds, setTermSeconds] = useState("0");
    const [amount, setAmount] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    useEffect(() => {
        let cancelled = false;
        userApi
            .getReceive(opts)
            .then(async (data) => {
                const uri = (data.pay_uri ?? data.alias) as string | undefined;
                if (!uri || typeof uri !== "string") return;
                const resolved = await resolveUserUri(uri, opts);
                if (!cancelled) setUser(resolved);
            })
            .catch((e) => {
                logger.error(
                    e instanceof Error
                        ? e.message
                        : "Failed to load receive address",
                );
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
            await savingsApi.savingsWithdraw(
                {
                    user: user.trim(),
                    term_seconds: parseInt(termSeconds, 10) || 0,
                    amount,
                },
                opts,
            );
            setSuccess("Withdrawal submitted.");
        } catch (e) {
            setError(e instanceof Error ? e.message : "Withdraw failed");
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
                        Withdraw
                    </h1>
                </div>
            </div>
            <PageContainer>
                <Card className="border-border p-4 space-y-4">
                    {error && (
                        <p
                            id="withdraw-error"
                            role="alert"
                            aria-live="assertive"
                            className="text-destructive text-sm"
                        >
                            {error}
                        </p>
                    )}
                    {success && (
                        <p
                            id="withdraw-success"
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
                                htmlFor="withdraw-account"
                                className="text-sm font-medium text-foreground mb-2 block"
                            >
                                Your account
                            </label>
                            <Input
                                id="withdraw-account"
                                value={user}
                                readOnly
                                className="border-border font-mono text-sm bg-muted"
                                aria-describedby={error ? "withdraw-error" : undefined}
                            />
                        </div>
                        <div>
                            <label
                                htmlFor="withdraw-term"
                                className="form-label"
                            >
                                Term (seconds)
                            </label>
                            <Input
                                id="withdraw-term"
                                type="number"
                                min="0"
                                value={termSeconds}
                                onChange={(e) => {
                                    setTermSeconds(e.target.value);
                                    setError("");
                                }}
                                className="border-border"
                                aria-invalid={Boolean(error)}
                                aria-describedby={error ? "withdraw-error" : undefined}
                            />
                        </div>
                        <div>
                            <label
                                htmlFor="withdraw-amount"
                                className="form-label"
                            >
                                Amount
                            </label>
                            <Input
                                id="withdraw-amount"
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
                                aria-describedby={error ? "withdraw-error" : undefined}
                            />
                        </div>
                        <Button
                            type="submit"
                            disabled={loading}
                        >
                            Withdraw
                        </Button>
                    </form>
                </Card>
            </PageContainer>
        </>
    );
}
