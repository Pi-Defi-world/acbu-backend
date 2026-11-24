"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { KycBadge } from "@/components/ui/kyc-badge";
import { RetryErrorBlock } from "@/components/ui/retry-error-block";
import { useApiOpts } from "@/hooks/use-api";
import * as userApi from "@/lib/api/user";
import { normalizeUsername } from "@/lib/utils";
import type { PatchMeBody, UserMe } from "@/types/api";

const USERNAME_MAX_LENGTH = 32;
const EMAIL_MAX_LENGTH = 254;
const PHONE_E164_MAX_LENGTH = 16;
const USERNAME_PATTERN = "^[a-z0-9](?:[a-z0-9._-]{0,31})$";
const PHONE_E164_PATTERN = "^\\+[1-9]\\d{7,14}$";
const EMAIL_PATTERN = "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$";

type FormData = {
    username: string;
    email: string;
    phone_e164: string;
    privacy_hide_from_search: boolean;
};

type FormErrors = Partial<Record<keyof FormData, string>>;

const validateProfileForm = (values: FormData): FormErrors => {
    const errors: FormErrors = {};

    const normalizedUsername = normalizeUsername(values.username);
    const trimmedEmail = values.email.trim();
    const trimmedPhone = values.phone_e164.trim();

    if (!normalizedUsername) {
        errors.username = "Username is required";
    } else if (normalizedUsername.length > USERNAME_MAX_LENGTH) {
        errors.username = `Username must be ${USERNAME_MAX_LENGTH} characters or fewer`;
    } else if (!new RegExp(USERNAME_PATTERN).test(normalizedUsername)) {
        errors.username =
            "Username can only use lowercase letters, numbers, dots, underscores, and hyphens";
    }

    if (trimmedEmail.length > EMAIL_MAX_LENGTH) {
        errors.email = `Email must be ${EMAIL_MAX_LENGTH} characters or fewer`;
    } else if (trimmedEmail && !new RegExp(EMAIL_PATTERN).test(trimmedEmail)) {
        errors.email = "Enter a valid email address";
    }

    if (trimmedPhone.length > PHONE_E164_MAX_LENGTH) {
        errors.phone_e164 = `Phone number must be ${PHONE_E164_MAX_LENGTH} characters or fewer`;
    } else if (
        trimmedPhone &&
        !new RegExp(PHONE_E164_PATTERN).test(trimmedPhone)
    ) {
        errors.phone_e164 = "Enter a valid E.164 phone number, for example +2348012345678";
    }

    return errors;
};

export default function ProfilePage() {
    const opts = useApiOpts();
    const [user, setUser] = useState<UserMe | null>(null);
    const [formData, setFormData] = useState<FormData>({
        username: "",
        email: "",
        phone_e164: "",
        privacy_hide_from_search: false,
    });
    const [fieldErrors, setFieldErrors] = useState<FormErrors>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState("");
    const [tick, setTick] = useState(0);

    const refetch = () => setTick((t) => t + 1);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError("");

        userApi
            .getMe(opts)
            .then((data) => {
                if (cancelled) return;

                setUser(data);
                setFormData({
                    username: data.username ?? "",
                    email: data.email ?? "",
                    phone_e164: data.phone_e164 ?? "",
                    privacy_hide_from_search:
                        data.privacy_hide_from_search ?? false,
                });
            })
            .catch((e) => {
                if (!cancelled) {
                    setError(
                        e instanceof Error
                            ? e.message
                            : "Failed to load profile",
                    );
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [opts.token, tick]);

    const handleChange = (
        field: keyof FormData,
        value: string | boolean,
    ) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
        setFieldErrors((prev) => ({ ...prev, [field]: "" }));
        setError("");
        setSaved(false);
    };

    const handleSave = async () => {
        const nextValues: FormData = {
            username: normalizeUsername(formData.username),
            email: formData.email.trim(),
            phone_e164: formData.phone_e164.trim(),
            privacy_hide_from_search: formData.privacy_hide_from_search,
        };

        const validationErrors = validateProfileForm(nextValues);
        setFieldErrors(validationErrors);

        if (Object.keys(validationErrors).length > 0) {
            setError("Please correct the highlighted fields.");
            setSaved(false);
            return;
        }

        const payload: PatchMeBody = {
            username: nextValues.username,
            email: nextValues.email || null,
            phone_e164: nextValues.phone_e164 || null,
            privacy_hide_from_search: nextValues.privacy_hide_from_search,
        };

        setSaving(true);
        setError("");

        try {
            const updatedUser = await userApi.patchMe(payload, opts);

            setUser(updatedUser);
            setFormData({
                username: updatedUser.username ?? nextValues.username,
                email: updatedUser.email ?? "",
                phone_e164: updatedUser.phone_e164 ?? "",
                privacy_hide_from_search:
                    updatedUser.privacy_hide_from_search ??
                    nextValues.privacy_hide_from_search,
            });
            setSaved(true);
        } catch (e) {
            setSaved(false);
            setError(
                e instanceof Error ? e.message : "Failed to update profile",
            );
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <>
                <div className="flex items-center gap-3 border-b border-border px-4 pb-6 pt-4">
                    <Link href="/me" aria-label="Back to profile">
                        <ArrowLeft className="h-5 w-5 text-primary" />
                    </Link>
                    <h1 className="text-xl font-bold text-foreground">
                        Profile
                    </h1>
                </div>
                <PageContainer>
                    <Skeleton className="mb-2 h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                </PageContainer>
            </>
        );
    }

    if (error && !user) {
        return (
            <>
                <div className="flex items-center gap-3 border-b border-border px-4 pb-6 pt-4">
                    <Link href="/me" aria-label="Back to profile">
                        <ArrowLeft className="h-5 w-5 text-primary" />
                    </Link>
                    <h1 className="text-xl font-bold text-foreground">
                        Profile
                    </h1>
                </div>
                <PageContainer>
                    <RetryErrorBlock message={error} onRetry={refetch} className="p-4" />
                </PageContainer>
            </>
        );
    }

    return (
        <>
            <div className="flex items-center gap-3 border-b border-border px-4 pb-6 pt-4">
                <Link href="/me" aria-label="Back to profile">
                    <ArrowLeft className="h-5 w-5 text-primary hover:text-primary/80" />
                </Link>
                <h1 className="text-xl font-bold text-foreground">Profile</h1>
            </div>

            <PageContainer>
                <form
                    className="space-y-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        void handleSave();
                    }}
                >
                    {error && (
                        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                            {error}
                        </div>
                    )}
                    {saved && (
                        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-950">
                            Profile updated successfully
                        </div>
                    )}

                    <div>
                        <label
                            htmlFor="profile-username"
                            className="mb-2 block text-sm font-medium text-foreground"
                        >
                            Username
                        </label>
                        <Input
                            id="profile-username"
                            type="text"
                            autoComplete="username"
                            inputMode="text"
                            maxLength={USERNAME_MAX_LENGTH}
                            pattern={USERNAME_PATTERN}
                            title="Use lowercase letters, numbers, dots, underscores, or hyphens"
                            value={formData.username}
                            onChange={(e) =>
                                handleChange("username", e.target.value)
                            }
                            className="border-border"
                            placeholder="Username"
                            aria-invalid={Boolean(fieldErrors.username)}
                        />
                        {fieldErrors.username && (
                            <p className="mt-2 text-sm text-destructive">
                                {fieldErrors.username}
                            </p>
                        )}
                    </div>

                    <div>
                        <label
                            htmlFor="profile-email"
                            className="mb-2 block text-sm font-medium text-foreground"
                        >
                            Email
                        </label>
                        <Input
                            id="profile-email"
                            type="email"
                            autoComplete="email"
                            inputMode="email"
                            maxLength={EMAIL_MAX_LENGTH}
                            pattern={EMAIL_PATTERN}
                            title="Enter a valid email address"
                            value={formData.email}
                            onChange={(e) =>
                                handleChange("email", e.target.value)
                            }
                            className="border-border"
                            placeholder="your@email.com"
                            aria-invalid={Boolean(fieldErrors.email)}
                        />
                        {fieldErrors.email && (
                            <p className="mt-2 text-sm text-destructive">
                                {fieldErrors.email}
                            </p>
                        )}
                    </div>

                    <div>
                        <label
                            htmlFor="profile-phone"
                            className="mb-2 block text-sm font-medium text-foreground"
                        >
                            Phone (E.164)
                        </label>
                        <Input
                            id="profile-phone"
                            type="tel"
                            autoComplete="tel"
                            inputMode="tel"
                            maxLength={PHONE_E164_MAX_LENGTH}
                            pattern={PHONE_E164_PATTERN}
                            title="Use international format like +2348012345678"
                            value={formData.phone_e164}
                            onChange={(e) =>
                                handleChange("phone_e164", e.target.value)
                            }
                            className="border-border"
                            placeholder="+2348012345678"
                            aria-invalid={Boolean(fieldErrors.phone_e164)}
                        />
                        {fieldErrors.phone_e164 && (
                            <p className="mt-2 text-sm text-destructive">
                                {fieldErrors.phone_e164}
                            </p>
                        )}
                    </div>

                    <label className="flex cursor-pointer items-center gap-2">
                        <input
                            type="checkbox"
                            checked={formData.privacy_hide_from_search}
                            onChange={(e) =>
                                handleChange(
                                    "privacy_hide_from_search",
                                    e.target.checked,
                                )
                            }
                            className="rounded border-border"
                        />
                        <span className="text-sm text-foreground">
                            Hide from search
                        </span>
                    </label>

                    <Card className="mt-6 border-border bg-muted p-4">
                        <p className="mb-2 text-xs text-muted-foreground">
                            Account status
                        </p>
                        <div className="space-y-1">
                            <div className="flex justify-between text-sm">
                                <span className="text-foreground">
                                    Email verified
                                </span>
                                <span
                                    className={
                                        user?.email_verified_at
                                            ? "font-medium text-green-600"
                                            : "text-muted-foreground"
                                    }
                                >
                                    {user?.email_verified_at ? "Yes" : "No"}
                                </span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-foreground">
                                    Phone verified
                                </span>
                                <span
                                    className={
                                        user?.phone_verified_at
                                            ? "font-medium text-green-600"
                                            : "text-muted-foreground"
                                    }
                                >
                                    {user?.phone_verified_at ? "Yes" : "No"}
                                </span>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-foreground">
                                    KYC status
                                </span>
                                <KycBadge status={user?.kyc_status} />
                            </div>
                        </div>
                    </Card>

                    <Button
                        type="submit"
                        disabled={saving}
                        className="mt-6 w-full bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                        {saving ? "Saving..." : "Save Changes"}
                    </Button>
                </form>
            </PageContainer>
        </>
    );
}
