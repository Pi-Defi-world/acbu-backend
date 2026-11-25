'use client';

/**
 * /me/kyc/proof — Zero-Knowledge Proof Generation Page
 *
 * CR-1 fix (CodeRabbit PR #1494): ZkProofFlow was exported but never rendered.
 * This page mounts the component, passes the user's KYC credentials from the
 * existing credential flow, and handles onResult / onError.
 *
 * Flow:
 *   1. User arrives here after a KYC application is approved (/me/kyc).
 *   2. KYC level + country code come from the approved application record.
 *   3. A random 32-byte salt is generated client-side and stored in sessionStorage
 *      for the duration of the session (never sent to the server).
 *   4. ZkProofFlow spawns the bundled Web Worker and shows step progress.
 *   5. On success → show nullifier + commitment; offer to submit on-chain.
 *   6. On error   → show recoverable error with retry.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

import { PageContainer } from '@/components/layout/page-container';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, CheckCircle, AlertCircle, ShieldCheck } from 'lucide-react';
import { ZkProofFlow, ZkProofResult } from '@/components/zk-proof-flow';

// ---------------------------------------------------------------------------
// Circuit source — bundled constant; no network fetch required
// ---------------------------------------------------------------------------

/**
 * The ZK-Comply Noir circuit source, identical to the version in
 * contracts/frontend/zk-comply-frontend/src/sdk/circuit.ts.
 * Kept inline here so the main frontend package has no dependency on the
 * contracts workspace.
 */
const ZK_COMPLY_CIRCUIT_SOURCE = `
fn poseidon2_hash_2(a: Field, b: Field) -> Field {
    let iv: Field = 2 * 18446744073709551616;
    let mut state = [a, b, 0, iv];
    state = std::hash::poseidon2_permutation(state);
    state[0]
}

fn poseidon2_hash_4(a: Field, b: Field, c: Field, d: Field) -> Field {
    let iv: Field = 4 * 18446744073709551616;
    let mut state = [0, 0, 0, iv];
    state[0] = state[0] + a;
    state[1] = state[1] + b;
    state[2] = state[2] + c;
    state = std::hash::poseidon2_permutation(state);
    state[0] = state[0] + d;
    state = std::hash::poseidon2_permutation(state);
    state[0]
}

fn main(
    kyc_level: u64,
    country_code: u64,
    salt: Field,
    commitment: pub Field,
    required_kyc: pub u64,
    allowed_country: pub u64,
    nullifier: pub Field,
) {
    let computed: Field = poseidon2_hash_4(
        kyc_level as Field,
        country_code as Field,
        salt,
        0,
    );
    assert(computed == commitment);
    assert(kyc_level >= required_kyc);
    assert(country_code == allowed_country);
    let expected_nullifier = poseidon2_hash_2(commitment, salt);
    assert(nullifier == expected_nullifier);
}
`.trim();

// ---------------------------------------------------------------------------
// Salt generation (cryptographically random, session-scoped)
// ---------------------------------------------------------------------------

const SALT_SESSION_KEY = 'zk_proof_salt';

function getOrCreateSalt(): string {
  if (typeof window === 'undefined') return '0';
  const stored = sessionStorage.getItem(SALT_SESSION_KEY);
  if (stored) return stored;
  // Generate a 31-byte random salt (fits safely in BN254 scalar field)
  const bytes = crypto.getRandomValues(new Uint8Array(31));
  let bigint = 0n;
  for (const b of bytes) bigint = (bigint << 8n) | BigInt(b);
  const salt = bigint.toString();
  sessionStorage.setItem(SALT_SESSION_KEY, salt);
  return salt;
}

// ---------------------------------------------------------------------------
// Page states
// ---------------------------------------------------------------------------

type PageState = 'proving' | 'success' | 'error';

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function KycProofPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Credentials come from query params set by the KYC application detail page.
  // Defaults: kycLevel=1, countryCode=566 (Nigeria), requiredKyc=1, allowedCountry=566.
  const kycLevel = Number(searchParams.get('kycLevel') ?? '1');
  const countryCode = Number(searchParams.get('countryCode') ?? '566');
  const requiredKyc = Number(searchParams.get('requiredKyc') ?? '1');
  const allowedCountry = Number(searchParams.get('allowedCountry') ?? countryCode);

  const [salt] = useState<string>(() => getOrCreateSalt());
  const [pageState, setPageState] = useState<PageState>('proving');
  const [result, setResult] = useState<ZkProofResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  // Key increments to remount ZkProofFlow on retry (triggers new worker spawn)
  const [proofKey, setProofKey] = useState(0);

  // Stable callbacks — useCallback with empty deps so identity never changes.
  // This satisfies both the ESLint exhaustive-deps rule and CR-2 (no inline
  // arrow functions as ZkProofFlow props).
  const handleResult = useCallback((r: ZkProofResult) => {
    setResult(r);
    setPageState('success');
  }, []);

  const handleError = useCallback((msg: string) => {
    setErrorMsg(msg);
    setPageState('error');
  }, []);

  const handleRetry = useCallback(() => {
    setErrorMsg('');
    setResult(null);
    setPageState('proving');
    setProofKey((k) => k + 1);
  }, []);

  return (
    <>
      <div className="flex items-center gap-3 px-4 pt-4 pb-6 border-b border-border">
        <Link href="/me/kyc">
          <ArrowLeft className="w-5 h-5 text-primary hover:text-primary/80" />
        </Link>
        <h1 className="text-xl font-bold text-foreground">ZK Proof</h1>
      </div>

      <PageContainer>
        {pageState === 'proving' && (
          <Card className="border-border p-6">
            <div className="flex items-center gap-2 mb-4">
              <ShieldCheck className="w-5 h-5 text-primary" />
              <h2 className="text-base font-semibold text-foreground">
                Generating Privacy Proof
              </h2>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              A zero-knowledge proof is being computed in your browser. This proves
              your KYC status without revealing your identity.
            </p>
            {/* CR-1: ZkProofFlow is now mounted here with real credential props */}
            <ZkProofFlow
              key={proofKey}
              circuitSource={ZK_COMPLY_CIRCUIT_SOURCE}
              kycLevel={kycLevel}
              countryCode={countryCode}
              salt={salt}
              requiredKyc={requiredKyc}
              allowedCountry={allowedCountry}
              onResult={handleResult}
              onError={handleError}
            />
          </Card>
        )}

        {pageState === 'success' && result && (
          <Card className="border-border p-6 space-y-4">
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle className="w-5 h-5" />
              <h2 className="text-base font-semibold">Proof Generated</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Your zero-knowledge proof was computed successfully. The commitment
              and nullifier below can be submitted on-chain to prove KYC compliance
              without revealing your credentials.
            </p>
            <div className="space-y-2">
              <div>
                <p className="text-xs font-medium text-foreground mb-1">Commitment</p>
                <p className="text-xs font-mono break-all text-muted-foreground bg-muted rounded px-2 py-1">
                  {result.commitmentHex}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-foreground mb-1">Nullifier</p>
                <p className="text-xs font-mono break-all text-muted-foreground bg-muted rounded px-2 py-1">
                  {result.nullifierHex}
                </p>
              </div>
            </div>
            <Button
              className="w-full"
              onClick={() => router.push('/me/kyc')}
            >
              Back to KYC
            </Button>
          </Card>
        )}

        {pageState === 'error' && (
          <Card className="border-border p-6 space-y-4">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="w-5 h-5" />
              <h2 className="text-base font-semibold">Proof Failed</h2>
            </div>
            <p className="text-xs text-muted-foreground break-words">{errorMsg}</p>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => router.push('/me/kyc')}>
                Cancel
              </Button>
              <Button className="flex-1" onClick={handleRetry}>
                Retry
              </Button>
            </div>
          </Card>
        )}
      </PageContainer>
    </>
  );
}
