"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ArrowLeft, AlertCircle } from "lucide-react";
import * as recoveryApi from "@/lib/api/recovery";
import { locales } from "@/i18n/locales";

/**
 * Derive the active locale from the current pathname so the post-unlock
 * redirect lands on the correct locale-prefixed sign-in route (e.g.
 * /en/auth/signin) rather than the bare /auth/signin which has no route
 * and resolves to a 404.
 */
function getLocaleFromPath(pathname: string): string {
  for (const locale of locales) {
    if (pathname === `/${locale}` || pathname.startsWith(`/${locale}/`)) {
      return locale;
    }
  }
  return "en";
}

/**
 * Account recovery / unlock (no API key required).
 * POST /recovery/unlock
 */
export default function RecoveryUnlockPage() {
    const router = useRouter();
    const pathname = usePathname();
    const locale = getLocaleFromPath(pathname);
    const signInPath = `/${locale}/auth/signin`;

    const [recoveryCode, setRecoveryCode] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const handleUnlock = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);
        try {
            if (!recoveryCode.trim()) {
                setError("Please enter your recovery code");
                setLoading(false);
                return;
            }
            await recoveryApi.unlock({ recovery_code: recoveryCode.trim() });
            router.push(signInPath);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unlock failed");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
            <Card className="w-full max-w-md border-border">
                <div className="p-6 md:p-8">
                    <Link
                        href={signInPath}
                        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to sign in
                    </Link>
                    <div className="mb-8">
                        <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
                            Unlock account
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            Enter the recovery code from your guardians to
                            unlock your account.
                        </p>
                    </div>

                    <form onSubmit={handleUnlock} className="space-y-4">
                        {error && (
                            <div className="flex gap-3 p-3 rounded-lg border border-destructive/30 bg-destructive/10">
                                <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                                <p className="text-sm text-destructive">
                                    {error}
                                </p>
                            </div>
                        )}

                        <div>
                            <label
                                htmlFor="recovery-code"
                                className="form-label"
                            >
                                Recovery code
                            </label>
                            <Input
                                id="recovery-code"
                                type="text"
                                placeholder="Enter code from guardians"
                                value={recoveryCode}
                                onChange={(e) =>
                                    setRecoveryCode(e.target.value)
                                }
                                className="border-border"
                                disabled={loading}
                            />
                        </div>

                        <Button
                            type="submit"
                            className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                            disabled={loading}
                        >
                            {loading ? "Unlocking..." : "Unlock"}
                        </Button>
                    </form>
                </div>
            </Card>
        </div>
    );
}
