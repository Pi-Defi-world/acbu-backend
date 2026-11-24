/**
 * In-memory store for the 2FA challenge token and post-auth redirect.
 *
 * Using module-level variables keeps the values out of Web Storage (which is
 * readable by any injected script), while still surviving the client-side
 * navigation from /signin → /2fa within the same page session.
 *
 * The values are intentionally short-lived: they are cleared once consumed
 * by the 2FA page, or on a fresh sign-in attempt.
 */

let _challengeToken: string | null = null;
let _postAuthRedirect: string | null = null;

export function setChallengeToken(token: string): void {
  _challengeToken = token;
}

export function getChallengeToken(): string | null {
  return _challengeToken;
}

export function clearChallengeToken(): void {
  _challengeToken = null;
}

export function setPostAuthRedirect(path: string): void {
  _postAuthRedirect = path;
}

export function getPostAuthRedirect(): string | null {
  return _postAuthRedirect;
}

export function clearPostAuthRedirect(): void {
  _postAuthRedirect = null;
}
