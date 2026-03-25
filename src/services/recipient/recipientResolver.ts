/**
 * Resolves alias (@username, E.164, email) to recipient display info.
 * Respects privacyHideFromSearch: when true, only returns result for self or (Phase 2) contacts.
 * Never returns stellarAddress.
 */
import { prisma } from "../../config/database";
import { logger } from "../../config/logger";
import type {
  ResolveResult,
  RecipientQuery,
  RecipientQueryKind,
} from "./types";

const STELLAR_ADDRESS_LENGTH = 56;
const E164_PREFIX = "+";

/**
 * Normalize raw input into a RecipientQuery for lookup.
 * - "@jane" or "jane" -> username, lowercased
 * - "+2348012345678" -> phone (E.164, as-is if already +)
 * - "a@b.com" -> email, lowercased
 * - 56-char G... -> treat as raw address, not resolved here (caller handles)
 */
export function normalizeRecipientQuery(
  q: string,
): RecipientQuery | { kind: "address"; value: string } {
  const trimmed = (q || "").trim();
  if (!trimmed) {
    throw new Error("Recipient query is required");
  }
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("@")) {
    return { kind: "username", value: lower.slice(1).replace(/\s/g, "") };
  }
  if (trimmed.startsWith(E164_PREFIX) && /^\+[0-9]{10,15}$/.test(trimmed)) {
    return { kind: "phone", value: trimmed };
  }
  if (trimmed.includes("@") && trimmed.includes(".")) {
    return { kind: "email", value: lower };
  }
  if (
    trimmed.length === STELLAR_ADDRESS_LENGTH &&
    /^G[A-Z2-7]+$/.test(trimmed)
  ) {
    return { kind: "address", value: trimmed };
  }
  // Default: treat as username (no @)
  return { kind: "username", value: lower.replace(/\s/g, "") };
}

function maskPhone(phoneE164: string | null): string | undefined {
  if (!phoneE164 || phoneE164.length < 6) return undefined;
  return phoneE164.slice(0, 4) + "****" + phoneE164.slice(-4);
}

function maskEmail(email: string | null): string | undefined {
  if (!email || !email.includes("@")) return undefined;
  const [local, domain] = email.split("@");
  if (local.length <= 2) return "**@" + domain;
  return local.slice(0, 2) + "***@" + domain;
}

/**
 * Resolve alias to recipient display result.
 * When privacyHideFromSearch is true, returns null unless callerUserId === recipient.id
 * (Phase 2 will allow contacts). Never includes stellarAddress.
 */
export async function resolveRecipient(
  q: string,
  callerUserId: string | null,
): Promise<ResolveResult | null> {
  const parsed = normalizeRecipientQuery(q);
  if (parsed.kind === "address") {
    return null; // Raw Stellar address: resolver does not return a ResolveResult; caller uses address as-is
  }

  const kind = parsed.kind as RecipientQueryKind;
  const value = parsed.value;

  const where =
    kind === "username"
      ? { username: value }
      : kind === "phone"
        ? { phoneE164: value }
        : { email: value };

  const user = await prisma.user.findFirst({
    where,
    select: {
      id: true,
      username: true,
      phoneE164: true,
      email: true,
      privacyHideFromSearch: true,
    },
  });

  if (!user) {
    logger.debug("resolveRecipient: no user found", {
      kind,
      value: kind === "email" ? "***" : value,
    });
    return null;
  }

  if (user.privacyHideFromSearch && callerUserId !== user.id) {
    const isContact = callerUserId
      ? await prisma.userContact.findFirst({
          where: {
            userId: user.id,
            contactUserId: callerUserId,
          },
          select: { id: true },
        })
      : null;
    if (!isContact) {
      logger.debug("resolveRecipient: hidden by privacy", {
        userId: user.id,
        callerUserId,
      });
      return null;
    }
  }

  const displayName = user.username
    ? `@${user.username}`
    : user.phoneE164 || user.email || user.id.slice(0, 8);

  const result: ResolveResult = {
    userId: user.id,
    displayName,
    canReceive: true,
  };
  if (user.username) result.username = user.username;
  if (user.phoneE164) result.maskedPhone = maskPhone(user.phoneE164);
  if (user.email) result.maskedEmail = maskEmail(user.email);

  return result;
}

/**
 * Resolve alias to stellarAddress (internal use by transfer service).
 * Returns null if not found or hidden by privacy.
 */
export async function resolveRecipientToStellarAddress(
  q: string,
  callerUserId: string | null,
): Promise<string | null> {
  const parsed = normalizeRecipientQuery(q);
  if (parsed.kind === "address") {
    return parsed.value;
  }
  const res = await resolveRecipient(q, callerUserId);
  if (!res) return null;
  const user = await prisma.user.findUnique({
    where: { id: res.userId },
    select: { stellarAddress: true },
  });
  return user?.stellarAddress ?? null;
}
