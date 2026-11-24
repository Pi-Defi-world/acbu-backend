'use client';

/**
 * ZkProofFlow — W11-CAR-013
 *
 * Renders a Web Worker that computes a real UltraHonk ZK-SNARK proof over
 * user credentials using @noir-lang/noir_js + @aztec/bb.js (Barretenberg).
 * The worker runs off the main thread so the UI stays responsive.
 *
 * CodeRabbit review fixes applied (PR #1494):
 *   CR-1: Component is now rendered by the KYC proof page (app/me/kyc/proof/page.tsx).
 *   CR-2: onResult / onError stored in refs — not useEffect dependencies — so
 *          inline callbacks never cause the worker to restart mid-proof.
 *   CR-worker: Worker referenced via new URL('../workers/zk-proof.worker.ts', import.meta.url)
 *              so webpack bundles it and npm bare specifiers resolve correctly.
 *
 * Architecture
 * ────────────
 *  ┌────────────────────┐  postMessage(GENERATE_PROOF)  ┌──────────────────────────────────┐
 *  │  ZkProofFlow (UI)  │ ───────────────────────────►  │  workers/zk-proof.worker.ts      │
 *  │  (main thread)     │ ◄───────────────────────────  │  (worker thread, webpack bundle) │
 *  └────────────────────┘  PROOF_PROGRESS / RESULT /    └──────────────────────────────────┘
 *                          PROOF_ERROR                   • noir_wasm compile
 *                                                        • bb.js UltraHonk + keccakZK
 */

import React, { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ZkProofRequest {
  /** Noir circuit source code — bundled constant, no network fetch needed. */
  circuitSource: string;
  kycLevel: number;
  countryCode: number;
  /** Decimal string representation of a 32-byte salt (bigint-safe). */
  salt: string;
  requiredKyc: number;
  allowedCountry: number;
}

export interface ZkProofResult {
  /** Hex-encoded UltraHonk proof bytes. */
  proofHex: string;
  /** Hex-encoded flattened public inputs. */
  publicInputsHex: string;
  /** Hex-encoded verification key. */
  vkHex: string;
  /** 32-byte Poseidon2 nullifier (hex). Prevents double-spend. */
  nullifierHex: string;
  /** 32-byte Poseidon2 credential commitment (hex). */
  commitmentHex: string;
}

interface WorkerMessage {
  type: 'PROOF_PROGRESS' | 'PROOF_RESULT' | 'PROOF_ERROR';
  payload: unknown;
}

export interface ZkProofFlowProps extends ZkProofRequest {
  onResult: (result: ZkProofResult) => void;
  onError: (message: string) => void;
  /** Optional render-prop for a custom progress UI. */
  renderProgress?: (step: string) => React.ReactNode;
}

// ---------------------------------------------------------------------------
// Default progress UI
// ---------------------------------------------------------------------------

function DefaultProgress({ step }: { step: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="ZK proof generation in progress"
      className="flex flex-col items-center gap-4 py-8 text-center"
    >
      <svg
        className="h-10 w-10 animate-spin text-primary"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
        />
      </svg>
      <p className="text-sm font-medium text-foreground">Generating ZK proof…</p>
      <p className="text-xs text-muted-foreground">{step}</p>
      <p className="max-w-xs text-xs text-muted-foreground">
        This runs entirely in your browser. Your credentials are never sent to any
        server.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ZkProofFlow component
// ---------------------------------------------------------------------------

/**
 * Spawns a bundled Web Worker that computes a real UltraHonk ZK-SNARK proof.
 * Calls `onResult` on success or `onError` on failure.
 *
 * CR-2 fix: `onResult` and `onError` are stored in refs so that inline
 * callbacks supplied by a parent (which change identity every render) never
 * restart the worker mid-proof. Only credential/circuit props control the
 * worker lifetime.
 */
export function ZkProofFlow({
  circuitSource,
  kycLevel,
  countryCode,
  salt,
  requiredKyc,
  allowedCountry,
  onResult,
  onError,
  renderProgress,
}: ZkProofFlowProps) {
  const [step, setStep] = useState('Initialising…');
  const workerRef = useRef<Worker | null>(null);
  const startedRef = useRef(false);

  // CR-2: Keep the latest callbacks in refs. These are read inside the worker
  // message handler (a stable closure) so changing the callback reference
  // from the parent never triggers cleanup + re-spawn of the worker.
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  useEffect(() => { onResultRef.current = onResult; }, [onResult]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  useEffect(() => {
    // Guard against StrictMode double-invoke
    if (startedRef.current) return;
    startedRef.current = true;

    // CR-worker fix: reference the TypeScript source entry with new URL() so
    // webpack treats it as a worker bundle entry and resolves all npm imports.
    // This replaces the previous /public static-asset approach which could not
    // resolve bare specifiers like `@aztec/bb.js`.
    const worker = new Worker(
      new URL('../workers/zk-proof.worker.ts', import.meta.url),
      { type: 'module' },
    );
    workerRef.current = worker;

    worker.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
      const { type, payload } = event.data;

      switch (type) {
        case 'PROOF_PROGRESS':
          setStep((payload as { step: string }).step);
          break;

        case 'PROOF_RESULT':
          worker.terminate();
          workerRef.current = null;
          // Read from ref — not stale even if parent re-rendered
          onResultRef.current(payload as ZkProofResult);
          break;

        case 'PROOF_ERROR':
          worker.terminate();
          workerRef.current = null;
          onErrorRef.current((payload as { message: string }).message);
          break;
      }
    });

    worker.addEventListener('error', (event: ErrorEvent) => {
      worker.terminate();
      workerRef.current = null;
      onErrorRef.current(event.message ?? 'Unknown worker error');
    });

    worker.postMessage({
      type: 'GENERATE_PROOF',
      payload: {
        circuitSource,
        kycLevel,
        countryCode,
        salt,
        requiredKyc,
        allowedCountry,
      } satisfies ZkProofRequest,
    });

    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      startedRef.current = false;
    };
    // CR-2: onResult and onError intentionally excluded from deps.
    // They are accessed via refs (onResultRef / onErrorRef) so their
    // identity changes never restart the worker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circuitSource, kycLevel, countryCode, salt, requiredKyc, allowedCountry]);

  return (
    <>{renderProgress ? renderProgress(step) : <DefaultProgress step={step} />}</>
  );
}
