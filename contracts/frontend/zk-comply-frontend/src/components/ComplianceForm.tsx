import { useState, useCallback, useEffect, useRef } from "react";
import { useIdentity } from "../hooks/useIdentity";
import type { Credential } from "../types";
import {
  loadCircuit,
  generateProof,
  submitProof,
  ZK_COMPLY_CIRCUIT_SOURCE,
} from "../sdk";

const KYC_LABELS: Record<number, string> = {
  0: "Unverified",
  1: "Basic",
  2: "Enhanced",
  3: "Enterprise",
};

type Step = "identity" | "configure" | "proving" | "done";

export type ProofResult = {
  commitment: string;
  nullifier: string;
  proofHex: string;
  txHash?: string;
  submitted: boolean;
};

function bytesToHex(bytes: Uint8Array): string {
  return (
    "0x" +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

export function ComplianceForm({ apiKey }: { apiKey: string }) {
  const { identity, loading, error: idError } = useIdentity(apiKey);
  const [salt, setSalt] = useState("");
  const [requiredKyc, setRequiredKyc] = useState(1);
  const [allowedCountry, setAllowedCountry] = useState(566);
  const [signerSecret, setSignerSecret] = useState(
    () => sessionStorage.getItem("zk_comply_signer") || ""
  );
  const [verifierContractId, setVerifierContractId] = useState(
    () =>
      import.meta.env.VITE_VERIFIER_CONTRACT_ID ||
      sessionStorage.getItem("zk_comply_verifier") ||
      ""
  );
  const [step, setStep] = useState<Step>("identity");
  const [result, setResult] = useState<ProofResult | null>(null);
  const [err, setErr] = useState("");

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
        <div className="flex flex-col gap-6 p-6">
          <div>
            <h3 className="leading-none font-semibold">Your Identity</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Fetched from ACBU. This data stays in your browser — only the
              proof is submitted to Stellar.
            </p>
          </div>

          {loading ? (
            <div className="space-y-3">
              <div className="h-5 w-32 animate-pulse rounded bg-secondary" />
              <div className="h-5 w-48 animate-pulse rounded bg-secondary" />
              <div className="h-5 w-40 animate-pulse rounded bg-secondary" />
            </div>
          ) : idError ? (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {idError}
            </div>
          ) : identity ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">KYC Level</span>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${
                      identity.isVerified
                        ? "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400"
                        : "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400"
                    }`}
                  >
                    {KYC_LABELS[identity.kycLevel] || "Unknown"}
                  </span>
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Country</span>
                <p className="text-sm font-medium">{identity.countryName}</p>
              </div>
              <div className="col-span-2 space-y-1">
                <span className="text-xs text-muted-foreground">
                  Stellar Address
                </span>
                <p className="text-sm font-mono truncate">
                  {identity.stellarAddress || "Not connected"}
                </p>
              </div>
            </div>
          ) : null}

          {identity && !identity.isVerified && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400">
              Your KYC is not yet verified. Complete KYC in the ACBU app first.
            </div>
          )}

          {identity && identity.isVerified && (
            <button
              onClick={() => setStep("configure")}
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all h-9 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 w-full"
            >
              Continue
            </button>
          )}
        </div>
      </div>

      {step === "configure" && identity && (
        <ConfigureStep
          salt={salt}
          setSalt={setSalt}
          requiredKyc={requiredKyc}
          setRequiredKyc={setRequiredKyc}
          allowedCountry={allowedCountry}
          setAllowedCountry={setAllowedCountry}
          signerSecret={signerSecret}
          setSignerSecret={(s) => {
            setSignerSecret(s);
            sessionStorage.setItem("zk_comply_signer", s);
          }}
          verifierContractId={verifierContractId}
          setVerifierContractId={(s) => {
            setVerifierContractId(s);
            sessionStorage.setItem("zk_comply_verifier", s);
          }}
          onBack={() => setStep("identity")}
          onGenerate={() => {
            setErr("");
            setStep("proving");
          }}
        />
      )}

      {step === "proving" && identity && (
        <ProvingStep
          identity={identity}
          salt={salt}
          requiredKyc={requiredKyc}
          allowedCountry={allowedCountry}
          signerSecret={signerSecret}
          verifierContractId={verifierContractId}
          onResult={(r) => {
            setResult(r);
            setStep("done");
          }}
          onError={(e) => {
            setErr(e);
            setStep("configure");
          }}
        />
      )}

      {step === "done" && result && (
        <ResultCard
          result={result}
          onReset={() => {
            setStep("identity");
            setResult(null);
            setSalt("");
            setErr("");
          }}
        />
      )}

      {err && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {err}
        </div>
      )}
    </div>
  );
}

function ConfigureStep({
  salt,
  setSalt,
  requiredKyc,
  setRequiredKyc,
  allowedCountry,
  setAllowedCountry,
  signerSecret,
  setSignerSecret,
  verifierContractId,
  setVerifierContractId,
  onBack,
  onGenerate,
}: {
  salt: string;
  setSalt: (s: string) => void;
  requiredKyc: number;
  setRequiredKyc: (n: number) => void;
  allowedCountry: number;
  setAllowedCountry: (n: number) => void;
  signerSecret: string;
  setSignerSecret: (s: string) => void;
  verifierContractId: string;
  setVerifierContractId: (s: string) => void;
  onBack: () => void;
  onGenerate: () => void;
}) {
  const generateSalt = useCallback(() => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const s = bytes.reduce((acc, byte) => (acc << 8n) | BigInt(byte), 0n);
    setSalt(s.toString());
  }, [setSalt]);

  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
      <div className="flex flex-col gap-6 p-6">
        <div>
          <h3 className="leading-none font-semibold">Pool Requirements</h3>
          <p className="text-sm text-muted-foreground mt-1">
            These are set by the pool operator. Your proof will enforce that
            your credentials satisfy them.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Minimum KYC Required</label>
            <select
              value={requiredKyc}
              onChange={(e) => setRequiredKyc(Number(e.target.value))}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            >
              {Object.entries(KYC_LABELS).map(([val, label]) => (
                <option key={val} value={val}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Allowed Country</label>
            <select
              value={allowedCountry}
              onChange={(e) => setAllowedCountry(Number(e.target.value))}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            >
              <option value={566}>Nigeria</option>
              <option value={404}>Kenya</option>
              <option value={710}>South Africa</option>
              <option value={818}>Egypt</option>
              <option value={288}>Ghana</option>
              <option value={646}>Rwanda</option>
              <option value={952}>Senegal (XOF)</option>
              <option value={504}>Morocco</option>
              <option value={834}>Tanzania</option>
              <option value={800}>Uganda</option>
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Random Salt</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={salt}
              readOnly
              placeholder="Click generate to create a random salt"
              className="flex-1 h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm font-mono shadow-xs"
            />
            <button
              onClick={generateSalt}
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all h-9 px-4 py-2 border bg-background shadow-xs hover:bg-accent"
            >
              Generate
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">
            Verifier Contract ID (C…)
          </label>
          <input
            type="text"
            value={verifierContractId}
            onChange={(e) => setVerifierContractId(e.target.value.trim())}
            placeholder="C… zk_verifier on testnet"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm font-mono shadow-xs"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">
            Signing secret (testnet S…)
          </label>
          <input
            type="password"
            value={signerSecret}
            onChange={(e) => setSignerSecret(e.target.value.trim())}
            placeholder="Used only in-browser to submit verify()"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm font-mono shadow-xs"
          />
          <p className="text-xs text-muted-foreground">
            Required to call on-chain <code>verify</code>. Never sent to ACBU —
            stays in session storage on this device.
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onBack}
            className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all h-9 px-4 py-2 border bg-background shadow-xs hover:bg-accent"
          >
            Back
          </button>
          <button
            onClick={onGenerate}
            disabled={!salt || !signerSecret || !verifierContractId}
            className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all h-9 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex-1"
          >
            Generate ZK Proof &amp; Submit
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * AZ-009: real proving + on-chain submission.
 * Uses useEffect (not useState IIFE) so StrictMode double-mount is guarded.
 */
function ProvingStep({
  identity,
  salt,
  requiredKyc,
  allowedCountry,
  signerSecret,
  verifierContractId,
  onResult,
  onError,
}: {
  identity: NonNullable<ReturnType<typeof useIdentity>["identity"]>;
  salt: string;
  requiredKyc: number;
  allowedCountry: number;
  signerSecret: string;
  verifierContractId: string;
  onResult: (r: ProofResult) => void;
  onError: (e: string) => void;
}) {
  const [status, setStatus] = useState("Loading circuit…");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    let cancelled = false;

    (async () => {
      try {
        setStatus("Loading Noir circuit…");
        await loadCircuit(ZK_COMPLY_CIRCUIT_SOURCE);
        if (cancelled) return;

        const cred: Credential = {
          kycLevel: identity.kycLevel,
          countryCode: identity.countryCode,
          salt: BigInt(salt),
        };

        setStatus("Generating UltraHonk ZK proof…");
        const artifacts = await generateProof({
          credential: cred,
          requiredKyc,
          allowedCountry,
        });
        if (cancelled) return;

        setStatus("Submitting verify() to Soroban…");
        const submission = await submitProof(
          signerSecret,
          verifierContractId,
          artifacts
        );
        if (cancelled) return;

        if (!submission.success) {
          throw new Error(
            submission.error || "On-chain verify() submission failed"
          );
        }

        onResult({
          commitment: bytesToHex(artifacts.commitment),
          nullifier: bytesToHex(artifacts.nullifier),
          proofHex: bytesToHex(artifacts.proof.slice(0, 64)) + "…",
          txHash: submission.txHash,
          submitted: true,
        });
      } catch (e: unknown) {
        if (!cancelled) {
          onError(e instanceof Error ? e.message : String(e));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    identity,
    salt,
    requiredKyc,
    allowedCountry,
    signerSecret,
    verifierContractId,
    onResult,
    onError,
  ]);

  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
      <div className="flex flex-col items-center gap-4 p-10 text-center">
        <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <div>
          <h3 className="font-semibold">Generating Proof</h3>
          <p className="text-sm text-muted-foreground mt-1">{status}</p>
        </div>
      </div>
    </div>
  );
}

function ResultCard({
  result,
  onReset,
}: {
  result: ProofResult;
  onReset: () => void;
}) {
  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
      <div className="flex flex-col gap-6 p-6">
        <div className="flex items-center gap-3">
          <div className="size-8 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center">
            <svg
              className="size-4 text-green-700 dark:text-green-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.5 12.75l6 6 9-13.5"
              />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold">
              {result.submitted ? "Proof Submitted On-Chain" : "Proof Generated"}
            </h3>
            <p className="text-sm text-muted-foreground">
              {result.submitted
                ? "Nullifier recorded via zk_verifier.verify()"
                : "Ready for on-chain verification"}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-md border bg-secondary/30 p-3">
            <span className="text-xs text-muted-foreground">Commitment</span>
            <p className="text-sm font-mono break-all mt-1">{result.commitment}</p>
          </div>
          <div className="rounded-md border bg-secondary/30 p-3">
            <span className="text-xs text-muted-foreground">Nullifier</span>
            <p className="text-sm font-mono break-all mt-1">{result.nullifier}</p>
          </div>
          <div className="rounded-md border bg-secondary/30 p-3">
            <span className="text-xs text-muted-foreground">Proof (prefix)</span>
            <p className="text-sm font-mono break-all mt-1">{result.proofHex}</p>
          </div>
          {result.txHash && (
            <div className="rounded-md border bg-secondary/30 p-3">
              <span className="text-xs text-muted-foreground">Tx Hash</span>
              <p className="text-sm font-mono break-all mt-1">{result.txHash}</p>
            </div>
          )}
        </div>

        <button
          onClick={onReset}
          className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all h-9 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 w-full"
        >
          Start Over
        </button>
      </div>
    </div>
  );
}
