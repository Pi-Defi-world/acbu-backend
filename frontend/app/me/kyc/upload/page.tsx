"use client";

import React, { Suspense, useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import Link from "next/link";
import { PageContainer } from "@/components/layout/page-container";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft } from "lucide-react";
import { ErrorBoundary } from "@/components/error-boundary";
import { useApiOpts } from "@/hooks/use-api";
import * as kycApi from "@/lib/api/kyc";
import type { KycDocumentKind } from "@/lib/api/kyc";

const KINDS: { kind: KycDocumentKind; label: string }[] = [
  { kind: "id_front", label: "ID (front)" },
  { kind: "id_back", label: "ID (back)" },
  { kind: "selfie", label: "Selfie" },
];

function UploadWidget() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const applicationId = searchParams.get("applicationId") ?? "";
  const opts = useApiOpts();
  const [storageRefs, setStorageRefs] = useState<
    Record<KycDocumentKind, string>
  >({ id_front: "", id_back: "", selfie: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleFile = async (kind: KycDocumentKind, file: File | null) => {
    if (!applicationId || !file) return;
    setError("");
    try {
      const { upload_url, storage_ref } = await kycApi.getUploadUrl(
        applicationId,
        kind,
        opts,
      );
      const res = await fetch(upload_url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
      if (!res.ok) throw new Error("Upload failed");
      setStorageRefs((prev) => ({ ...prev, [kind]: storage_ref }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const docs = KINDS.filter((k) => storageRefs[k.kind]).map((k) => ({
      kind: k.kind,
      storage_ref: storageRefs[k.kind],
    }));
    if (docs.length === 0) {
      setError("Upload at least one document");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await kycApi.patchApplicationDocuments(
        applicationId,
        { documents: docs },
        opts,
      );
      setSuccess(true);
      timeoutRef.current = setTimeout(
        () => router.push(`/me/kyc/${applicationId}`),
        1500,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setLoading(false);
    }
  };

  if (!applicationId) {
    return (
      <>
        <div className="border-border bg-card/95 sticky top-0 z-10 border-b backdrop-blur-sm">
          <div className="flex items-center gap-3 px-4 py-3">
            <Link href="/me/kyc">
              <ArrowLeft className="text-primary h-5 w-5" />
            </Link>
            <h1 className="text-foreground text-lg font-bold">
              Upload documents
            </h1>
          </div>
        </div>
        <PageContainer>
          <p className="text-muted-foreground">
            No application selected. Start a KYC application first.
          </p>
          <Link href="/me/kyc/start">
            <Button variant="outline" className="mt-3">
              Start KYC
            </Button>
          </Link>
        </PageContainer>
      </>
    );
  }

  return (
    <>
      <div className="border-border bg-card/95 sticky top-0 z-10 border-b backdrop-blur-sm">
        <div className="flex items-center gap-3 px-4 py-3">
          <Link href={`/me/kyc/${applicationId}`}>
            <ArrowLeft className="text-primary h-5 w-5" />
          </Link>
          <h1 className="text-foreground text-lg font-bold">
            Upload documents
          </h1>
        </div>
      </div>
      <PageContainer>
        <Card className="border-border space-y-4 p-4">
          <p className="text-muted-foreground text-sm">
            Upload id_front, id_back, and selfie. Then submit.
          </p>
          {error && <p className="text-destructive text-sm">{error}</p>}
          {success && (
            <p className="text-sm text-green-600">Documents submitted.</p>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            {KINDS.map(({ kind, label }) => (
              <div key={kind}>
                <label className="text-foreground mb-2 block text-sm font-medium">
                  {label}
                </label>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  className="text-muted-foreground file:bg-primary file:text-primary-foreground block w-full text-sm file:mr-4 file:rounded file:border-0 file:px-4 file:py-2"
                  onChange={(e) =>
                    handleFile(kind, e.target.files?.[0] ?? null)
                  }
                />
                {storageRefs[kind] && (
                  <span className="text-xs text-green-600">Uploaded</span>
                )}
              </div>
            ))}
            <Button type="submit" disabled={loading || !storageRefs.id_front}>
              Submit documents
            </Button>
          </form>
        </Card>
      </PageContainer>
    </>
  );
}

function KycUploadSkeleton() {
  return (
    <>
      <div className="border-border bg-card/95 sticky top-0 z-10 border-b backdrop-blur-sm">
        <div className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-5 w-5" />
          <Skeleton className="h-5 w-36" />
        </div>
      </div>
      <PageContainer>
        <Card className="border-border space-y-4 p-4">
          <Skeleton className="h-4 w-64" />
          <div className="space-y-4">
            {KINDS.map(({ kind }) => (
              <div key={kind} className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
            <Skeleton className="h-10 w-full" />
          </div>
        </Card>
      </PageContainer>
    </>
  );
}

export default function KycUploadPage() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<KycUploadSkeleton />}>
        <UploadWidget />
      </Suspense>
    </ErrorBoundary>
  );
}
