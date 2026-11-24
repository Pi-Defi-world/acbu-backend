/**
 * Canonical identifier helpers for security-sensitive keys.
 *
 * Rate limiters and brute-force guards must never key directly on user input:
 * email casing like user@gmail.com, User@Gmail.com and USER@GMAIL.COM must
 * collapse to the same bucket.
 */
export type NormalizedIdentifierKind = "username" | "email" | "phone" | "anonymous";

export interface NormalizedIdentifier {
  kind: NormalizedIdentifierKind;
  value: string;
}

export function normalizeSecurityIdentifier(
  identifier: string | null | undefined,
): NormalizedIdentifier {
  const trimmed = (identifier || "").trim();
  if (!trimmed) {
    return { kind: "anonymous", value: "anon" };
  }

  const lower = trimmed.toLowerCase();

  if (trimmed.startsWith("+") && /^\+[0-9]{10,15}$/.test(trimmed)) {
    return { kind: "phone", value: trimmed };
  }

  if (lower.startsWith("@")) {
    return { kind: "username", value: lower.slice(1).replace(/\s/g, "") };
  }

  if (lower.includes("@") && lower.includes(".")) {
    return { kind: "email", value: lower };
  }

  return { kind: "username", value: lower.replace(/\s/g, "") };
}

export function normalizeRateLimitIdentifier(identifier: string | null | undefined): string {
  return normalizeSecurityIdentifier(identifier).value;
}

export function maskSecurityIdentifier(identifier: string | null | undefined): string {
  const normalized = normalizeSecurityIdentifier(identifier);

  if (normalized.kind === "email") {
    const [local, domain] = normalized.value.split("@");
    const safeLocal = local.length <= 2 ? `${local[0] ?? "*"}*` : `${local.slice(0, 2)}***`;
    return `${safeLocal}@${domain ?? "***"}`;
  }

  if (normalized.kind === "phone") {
    return `${normalized.value.slice(0, 4)}****${normalized.value.slice(-2)}`;
  }

  if (normalized.kind === "anonymous") {
    return "anonymous";
  }

  return `${normalized.value.slice(0, 2)}***`;
}
