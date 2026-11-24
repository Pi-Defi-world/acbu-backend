/**
 * #384: WebSocket upgrade authentication.
 *
 * Tokens MUST be sent in the `Authorization: Bearer <key>` or `x-api-key: <key>` header.
 * Passing a token via the query string (?token=...) is explicitly rejected: query strings
 * appear in proxy/CDN/load-balancer access logs, leaking session credentials to third parties.
 */

import type { IncomingMessage } from "http";
import bcrypt from "bcrypt";
import { prisma } from "../../config/database";
import { logger } from "../../config/logger";
import type { ApiKeyType } from "../../middleware/auth";
import type { PermissionScope } from "../../types/permissions";
import { PermissionScopeEnum } from "../../types/permissions";

const API_KEY_PREFIX = "acbu";
const API_KEY_LOOKUP_LENGTH = 12;
const API_KEY_SECRET_LENGTH = 64;
const API_KEY_FORMAT = new RegExp(
  `^${API_KEY_PREFIX}_([a-f0-9]{${API_KEY_LOOKUP_LENGTH}})_([a-f0-9]{${API_KEY_SECRET_LENGTH}})$`,
  "i",
);

export interface WsAuthResult {
  keyId: string;
  userId: string | null;
  organizationId: string | null;
  keyType: ApiKeyType;
  permissions: PermissionScope[];
}

export class WsAuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 401 | 403 = 401,
  ) {
    super(message);
    this.name = "WsAuthError";
  }
}

function parseApiKey(raw: string): { lookupKey: string; secret: string } | null {
  const match = raw.trim().match(API_KEY_FORMAT);
  if (!match) return null;
  return { lookupKey: match[1].toLowerCase(), secret: match[2].toLowerCase() };
}

function validatePermissions(raw: unknown): PermissionScope[] {
  if (!Array.isArray(raw)) return [];
  const valid: PermissionScope[] = [];
  for (const p of raw) {
    const r = PermissionScopeEnum.safeParse(p);
    if (r.success) valid.push(r.data);
  }
  return valid;
}

/**
 * Authenticate a WebSocket upgrade request.
 *
 * Reads the API key exclusively from request headers (`x-api-key` or
 * `Authorization: Bearer`).  If the caller has also put a token in the query
 * string the connection is immediately rejected — even if the header is valid —
 * to prevent accidental log exposure during mixed-transport rollouts.
 *
 * @throws {WsAuthError} on any authentication failure
 */
export async function authenticateWsUpgrade(req: IncomingMessage): Promise<WsAuthResult> {
  // #384: reject outright if any token-shaped query param is present.
  // The URL on an IncomingMessage for a WS upgrade includes the full path + query string.
  const rawUrl = req.url ?? "";
  const queryString = rawUrl.includes("?") ? rawUrl.slice(rawUrl.indexOf("?") + 1) : "";
  if (queryString) {
    const params = new URLSearchParams(queryString);
    const tokenParams = ["token", "api_key", "apikey", "access_token", "auth"];
    for (const p of tokenParams) {
      if (params.has(p)) {
        logger.warn("[ws-auth] Rejected: auth token in query string", { param: p });
        throw new WsAuthError(
          "Authentication tokens must be sent in request headers, not the query string",
          401,
        );
      }
    }
  }

  // Extract key from header only.
  const xApiKey = req.headers["x-api-key"];
  const authorization = req.headers["authorization"];

  let rawKey: string | undefined;
  if (typeof xApiKey === "string" && xApiKey.trim()) {
    rawKey = xApiKey.trim();
  } else if (typeof authorization === "string") {
    const bearer = authorization.match(/^Bearer\s+(.+)$/i);
    rawKey = bearer?.[1]?.trim();
  }

  if (!rawKey) {
    throw new WsAuthError(
      "WebSocket upgrade requires an API key in x-api-key or Authorization header",
    );
  }

  const parsed = parseApiKey(rawKey);
  if (!parsed) {
    throw new WsAuthError("Invalid API key format");
  }

  const record = await prisma.apiKey.findFirst({
    where: {
      lookupKey: parsed.lookupKey,
      revokedAt: null,
      AND: [
        { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        {
          OR: [{ keyType: { not: "BREAK_GLASS_KEY" } }, { emergencyExpiresAt: { gt: new Date() } }],
        },
      ],
    },
  });

  if (!record) {
    throw new WsAuthError("Invalid API key");
  }

  const valid = await bcrypt.compare(parsed.secret, record.keyHash);
  if (!valid) {
    throw new WsAuthError("Invalid API key");
  }

  // Fire-and-forget lastUsedAt update — don't block the upgrade handshake.
  prisma.apiKey
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch((e: unknown) => logger.error("[ws-auth] Failed to update lastUsedAt", { e }));

  return {
    keyId: record.id,
    userId: record.userId ?? null,
    organizationId: record.organizationId ?? null,
    keyType: record.keyType as ApiKeyType,
    permissions: validatePermissions(record.permissions),
  };
}
