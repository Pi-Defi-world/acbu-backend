import { get, post, del } from "./client";
import type { RequestOptions } from "./client";
import type {
  SavingsPositionsResponse,
  SavingsDepositBody,
  SavingsWithdrawBody,
  SavingsGoal,
  SavingsGoalsListResponse,
  CreateSavingsGoalBody,
  UpdateSavingsGoalBody,
} from "@/types/api";

export async function getSavingsPositions(
  user: string,
  termSeconds?: number,
  opts?: RequestOptions,
): Promise<SavingsPositionsResponse> {
  const params = new URLSearchParams({ user });
  if (termSeconds != null) params.set("term_seconds", String(termSeconds));
  return get<SavingsPositionsResponse>(
    `/savings/positions?${params.toString()}`,
    opts,
  );
}

export async function savingsDeposit(
  body: SavingsDepositBody,
  opts?: RequestOptions,
): Promise<{ transaction_hash: string; new_balance: string | number }> {
  return post("/savings/deposit", body, opts);
}

export async function savingsWithdraw(
  body: SavingsWithdrawBody,
  opts?: RequestOptions,
): Promise<{ transaction_hash: string }> {
  return post("/savings/withdraw", body, opts);
}

// ──────────────────────────────────────────────
// Savings Goals CRUD
// ──────────────────────────────────────────────

/**
 * Fetch all savings goals for the authenticated user.
 */
export async function getSavingsGoals(
  opts?: RequestOptions,
): Promise<SavingsGoal[]> {
  const res = await get<SavingsGoalsListResponse | SavingsGoal[]>(
    "/savings/goals",
    opts,
  );
  // Backend may return { goals: [...] } or a bare array
  if (Array.isArray(res)) return res;
  return (res as SavingsGoalsListResponse).goals ?? [];
}

/**
 * Create a new savings goal.
 */
export async function createSavingsGoal(
  body: CreateSavingsGoalBody,
  opts?: RequestOptions,
): Promise<SavingsGoal> {
  return post<SavingsGoal>("/savings/goals", body, opts);
}

/**
 * Update an existing savings goal (name, target, deadline, current_amount).
 */
export async function updateSavingsGoal(
  id: string,
  body: UpdateSavingsGoalBody,
  opts?: RequestOptions,
): Promise<SavingsGoal> {
  // Using PATCH via post helper routed to the goal endpoint.
  // If the API client gains a `patch()` helper later, swap this in.
  return post<SavingsGoal>(`/savings/goals/${id}`, body, opts);
}

/**
 * Delete a savings goal by ID.
 */
export async function deleteSavingsGoal(
  id: string,
  opts?: RequestOptions,
): Promise<void> {
  return del<void>(`/savings/goals/${id}`, opts);
}
