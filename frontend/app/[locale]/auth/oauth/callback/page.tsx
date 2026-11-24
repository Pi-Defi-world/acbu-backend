"use client";

import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import * as authApi from '@/lib/api/auth';
import { useAuth } from '@/contexts/auth-context';
import { logger } from '@/lib/logger';

function OAuthCallbackContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { login } = useAuth();
  const calledRef = useRef(false);
  const [status, setStatus] = useState<"validating" | "success" | "error">(
    "validating",
  );
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (calledRef.current) return;
    calledRef.current = true;

    const exchangeCode = async () => {
      try {
        const code = searchParams.get("code");
        const state = searchParams.get("state");

        if (!code) {
          setStatus("error");
          setErrorMessage("Missing authorization code.");
          return;
        }

        const storedState = sessionStorage.getItem("oauth_state");

        if (!state || !storedState || state !== storedState) {
          setStatus("error");
          setErrorMessage("Invalid state parameter. Possible CSRF attack.");
          return;
        }

        sessionStorage.removeItem("oauth_state");

        // Exchange authorization code for session
        let result;
        try {
          result = await authApi.exchangeOAuthCode(code, state);
        } catch (error) {
          logger.error("OAuth code exchange failed", error);
          setStatus("error");
          setErrorMessage(
            error instanceof Error ? error.message : "Authorization failed. Please try again."
          );
          return;
        }

        // Verify we got valid credentials
        if (!result.user_id) {
          logger.error("OAuth code exchange returned invalid response - missing user_id");
          setStatus("error");
          setErrorMessage("Authentication failed: invalid response from server.");
          return;
        }

        // Establish authenticated session
        login(result.user_id, result.stellar_address);

        setStatus("success");

        const returnPath = sessionStorage.getItem("oauth_return_path") || "/";
        sessionStorage.removeItem("oauth_return_path");
        router.replace(returnPath);
      } catch (err) {
        logger.error("Unexpected error during OAuth callback", err);
        setStatus("error");
        setErrorMessage("An unexpected error occurred. Please try again.");
      }
    };

    void exchangeCode();
  }, [searchParams, router, login]);

  if (status === "validating") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Completing sign-in...</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <h1 className="text-destructive text-xl font-semibold">
          Authentication Error
        </h1>
        <p className="text-muted-foreground">{errorMessage}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-muted-foreground">
        Signed in successfully. Redirecting...
      </p>
    </div>
  );
}

export default function OAuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-muted-foreground">Completing sign-in...</p>
        </div>
      }
    >
      <OAuthCallbackContent />
    </Suspense>
  );
}
