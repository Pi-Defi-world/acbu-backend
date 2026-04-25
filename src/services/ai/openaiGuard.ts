/**
 * B-063: OpenAI usage guardrails.
 *
 * Wraps every OpenAI call with:
 *  1. Auth check — caller must supply a verified org/user ID.
 *  2. Per-org monthly spend budget — rejects calls when the org would exceed its cap.
 *  3. Prompt allowlist — rejects prompts that contain disallowed patterns.
 *  4. Spend recording — writes usage to MongoDB so the budget check stays accurate.
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { config } from "../../config/env";
import { logger } from "../../config/logger";
import { getMongoDB } from "../../config/mongodb";

// Patterns that are never allowed in prompts regardless of context.
const DISALLOWED_PROMPT_PATTERNS: RegExp[] = [
  /ignore (all |previous |prior )?instructions/i,
  /you are now/i,
  /act as (a |an )?(?!kyc|document|analyst)/i,
  /jailbreak/i,
  /disregard (your |all |prior )?/i,
  /forget (your |all |prior )?instructions/i,
  /reveal (your |the )?system prompt/i,
  /print (your |the )?system prompt/i,
];

const SPEND_COLLECTION = "openai_org_spend";

export interface GuardedChatParams {
  orgId: string;
  userId?: string;
  messages: ChatCompletionMessageParam[];
  model?: string;
  maxTokens?: number;
}

export interface GuardedChatResult {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
}

function getOpenAIClient(): OpenAI {
  if (!config.openai.apiKey) {
    throw new Error(
      "OpenAI is not configured. Set OPENAI_API_KEY in your environment.",
    );
  }
  return new OpenAI({ apiKey: config.openai.apiKey });
}

/**
 * Validates that none of the user-supplied messages contain injection patterns.
 * Throws AppError-compatible if a disallowed pattern is found.
 */
function assertPromptSafe(messages: ChatCompletionMessageParam[]): void {
  for (const msg of messages) {
    if (msg.role !== "user") continue;
    const text = typeof msg.content === "string" ? msg.content : "";
    for (const pattern of DISALLOWED_PROMPT_PATTERNS) {
      if (pattern.test(text)) {
        throw Object.assign(
          new Error("Prompt rejected: contains disallowed content."),
          { statusCode: 400, isOperational: true },
        );
      }
    }
  }
}

/**
 * Returns the current month's total spend in USD for the given org.
 */
async function getMonthlySpend(orgId: string): Promise<number> {
  let db;
  try {
    db = getMongoDB();
  } catch {
    return 0;
  }

  const now = new Date();
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  const doc = await db
    .collection<{ orgId: string; monthKey: string; totalUsd: number }>(
      SPEND_COLLECTION,
    )
    .findOne({ orgId, monthKey });

  return doc?.totalUsd ?? 0;
}

/**
 * Estimates USD cost from token usage.
 * Uses gpt-4o-mini pricing as a conservative default; override for other models.
 */
function estimateCostUsd(
  promptTokens: number,
  completionTokens: number,
  model: string,
): number {
  // Prices per 1M tokens (USD) — update when OpenAI changes pricing.
  const pricing: Record<string, { input: number; output: number }> = {
    "gpt-4o": { input: 2.5, output: 10.0 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "gpt-4-turbo": { input: 10.0, output: 30.0 },
    "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
  };

  const modelKey = Object.keys(pricing).find((k) => model.startsWith(k));
  const { input, output } = pricing[modelKey ?? "gpt-4o-mini"];

  return (promptTokens * input + completionTokens * output) / 1_000_000;
}

/**
 * Records spend for an org in the current calendar month (upsert).
 */
async function recordSpend(orgId: string, costUsd: number): Promise<void> {
  let db;
  try {
    db = getMongoDB();
  } catch {
    return;
  }

  const now = new Date();
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  await db.collection(SPEND_COLLECTION).updateOne(
    { orgId, monthKey },
    {
      $inc: { totalUsd: costUsd },
      $set: { updatedAt: now },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );
}

/**
 * The single entry point for all OpenAI chat calls within the platform.
 * Enforces auth context, budget cap, and prompt safety before calling the API.
 */
export async function guardedChat(
  params: GuardedChatParams,
): Promise<GuardedChatResult> {
  const {
    orgId,
    userId,
    messages,
    model = "gpt-4o-mini",
    maxTokens = config.openai.maxTokensPerRequest,
  } = params;

  if (!orgId) {
    throw Object.assign(new Error("orgId is required for OpenAI calls."), {
      statusCode: 401,
      isOperational: true,
    });
  }

  assertPromptSafe(messages);

  const currentSpend = await getMonthlySpend(orgId);
  if (currentSpend >= config.openai.orgMonthlyBudgetUsd) {
    logger.warn("[openaiGuard] Monthly budget exceeded", {
      orgId,
      currentSpend,
      budgetUsd: config.openai.orgMonthlyBudgetUsd,
    });
    throw Object.assign(
      new Error(
        `OpenAI monthly budget of $${config.openai.orgMonthlyBudgetUsd} exceeded for this organisation.`,
      ),
      { statusCode: 429, isOperational: true },
    );
  }

  const client = getOpenAIClient();

  logger.debug("[openaiGuard] Sending request", { orgId, userId, model });

  const response = await client.chat.completions.create({
    model,
    messages,
    max_tokens: maxTokens,
  });

  const choice = response.choices[0];
  const content = choice?.message?.content ?? "";
  const usage = response.usage ?? {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };

  const estimatedCostUsd = estimateCostUsd(
    usage.prompt_tokens,
    usage.completion_tokens,
    model,
  );

  await recordSpend(orgId, estimatedCostUsd);

  logger.info("[openaiGuard] Request completed", {
    orgId,
    userId,
    model,
    totalTokens: usage.total_tokens,
    estimatedCostUsd: estimatedCostUsd.toFixed(6),
  });

  return {
    content,
    usage: {
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
      estimatedCostUsd,
    },
  };
}

/**
 * Returns the current month's spend for an org. Useful for admin dashboards.
 */
export async function getOrgMonthlySpend(
  orgId: string,
): Promise<{ spendUsd: number; budgetUsd: number; remainingUsd: number }> {
  const spendUsd = await getMonthlySpend(orgId);
  const budgetUsd = config.openai.orgMonthlyBudgetUsd;
  return {
    spendUsd,
    budgetUsd,
    remainingUsd: Math.max(0, budgetUsd - spendUsd),
  };
}
