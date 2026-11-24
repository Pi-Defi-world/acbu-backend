/**
 * Local persistence for submitted loan applications.
 *
 * Why: the `/lending/apply` backend endpoint may not be live yet, but the MVP
 * requires submitted applications to be visible in an admin/backoffice stub.
 *
 * Privacy note (AF-016):
 *   `purpose` and `applicantUser` are PII. They are intentionally kept out of
 *   localStorage (which persists indefinitely on shared/compromised devices) and
 *   stored in sessionStorage instead, which is cleared when the browser tab/
 *   session closes.
 *
 *   localStorage holds only non-sensitive fields: id, productId, productName,
 *   amount, term, status, syncedWithBackend, submittedAt, and errorMessage.
 *
 *   IMPORTANT: This local store is a stub — it is NOT a substitute for server
 *   persistence. Records stored here exist only on this device and are not
 *   visible to other users or sessions.
 */

export type LoanApplicationStatus =
  | 'pending'
  | 'submitted'
  | 'approved'
  | 'rejected';

/** Fields safe to persist in localStorage (no PII). */
export interface StoredLoanApplicationBase {
  id: string;
  productId: string;
  productName: string;
  amount: number;
  term: number;
  status: LoanApplicationStatus;
  syncedWithBackend: boolean;
  submittedAt: string;
  errorMessage?: string;
}

/** Full record including PII — only available for the current session. */
export interface StoredLoanApplication extends StoredLoanApplicationBase {
  /** Loan purpose — stored in sessionStorage only, not localStorage. */
  purpose?: string;
  /** Applicant identifier — stored in sessionStorage only, not localStorage. */
  applicantUser?: string;
}

/** PII payload stored per-application in sessionStorage. */
interface ApplicationPii {
  purpose?: string;
  applicantUser?: string;
}

const STORAGE_KEY = 'acbu:lending:applications';
const SESSION_PII_KEY = 'acbu:lending:applications:pii';

function hasWindow(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

// ── PII helpers (sessionStorage) ─────────────────────────────────────────────

function readAllPii(): Record<string, ApplicationPii> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.sessionStorage.getItem(SESSION_PII_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, ApplicationPii>;
  } catch {
    return {};
  }
}

function savePii(id: string, pii: ApplicationPii): void {
  if (typeof window === 'undefined') return;
  const all = readAllPii();
  all[id] = pii;
  window.sessionStorage.setItem(SESSION_PII_KEY, JSON.stringify(all));
}

function removePii(id: string): void {
  if (typeof window === 'undefined') return;
  const all = readAllPii();
  delete all[id];
  window.sessionStorage.setItem(SESSION_PII_KEY, JSON.stringify(all));
}

// ── Public API ────────────────────────────────────────────────────────────────

export function listApplications(): StoredLoanApplication[] {
  if (!hasWindow()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    const bases = parsed.filter((a): a is StoredLoanApplicationBase =>
      !!a && typeof a === 'object' && typeof (a as StoredLoanApplicationBase).id === 'string'
    );

    // Rehydrate PII from sessionStorage for the current session
    const allPii = readAllPii();
    return bases.map((base) => ({
      ...base,
      ...(allPii[base.id] ?? {}),
    }));
  } catch {
    return [];
  }
}

export function saveApplication(app: StoredLoanApplication): StoredLoanApplication[] {
  if (!hasWindow()) return [];

  // Separate PII from the persisted base record
  const { purpose, applicantUser, ...base } = app;

  // Persist PII in sessionStorage only
  savePii(app.id, { purpose, applicantUser });

  // Persist non-PII fields in localStorage
  const currentBases = listApplications().map(({ purpose: _p, applicantUser: _a, ...b }) => b);
  const nextBases: StoredLoanApplicationBase[] = [
    base,
    ...currentBases.filter((a) => a.id !== base.id),
  ];
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextBases));

  // Return full records (with PII rehydrated) for this session
  return listApplications();
}

export function updateApplicationStatus(
  id: string,
  status: LoanApplicationStatus
): StoredLoanApplication[] {
  if (!hasWindow()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredLoanApplicationBase[];
    if (!Array.isArray(parsed)) return [];

    const next = parsed.map((a) => (a.id === id ? { ...a, status } : a));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return listApplications();
}

/**
 * Remove a single application from both localStorage and sessionStorage.
 */
export function removeApplication(id: string): StoredLoanApplication[] {
  if (!hasWindow()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredLoanApplicationBase[];
      if (Array.isArray(parsed)) {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(parsed.filter((a) => a.id !== id))
        );
      }
    }
  } catch {
    // ignore
  }
  removePii(id);
  return listApplications();
}
