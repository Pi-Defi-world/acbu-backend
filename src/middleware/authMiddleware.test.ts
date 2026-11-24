import crypto from "crypto";
import jwt from "jsonwebtoken";
import { assertJwtTypHeader, EXPECTED_JWT_TYP, getJwtHeader, verifyJwt } from "./authMiddleware";

function signWithoutTypHeader(payload: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const data = `${header}.${body}`;
  const signature = crypto.createHmac("sha256", secret).update(data).digest("base64url");

  return `${data}.${signature}`;
}

describe("authMiddleware JWT typ header validation", () => {
  const secret = "test-secret";

  it("accepts tokens with typ JWT", () => {
    const token = jwt.sign({ sub: "user-1" }, secret, {
      header: { typ: EXPECTED_JWT_TYP, alg: "HS256" },
    });

    expect(() => assertJwtTypHeader(token)).not.toThrow();
    expect(verifyJwt(token, secret)).toMatchObject({ sub: "user-1" });
    expect(getJwtHeader(token)?.typ).toBe("JWT");
  });

  it("rejects OAuth access tokens with typ at+JWT", () => {
    const token = jwt.sign({ sub: "user-1", aud: "api" }, secret, {
      header: { typ: "at+JWT", alg: "HS256" },
    });

    expect(() => assertJwtTypHeader(token)).toThrow(/unexpected jwt typ/i);
    expect(() => verifyJwt(token, secret)).toThrow(/unexpected jwt typ/i);
  });

  it("rejects tokens with a missing typ header", () => {
    const token = signWithoutTypHeader({ sub: "user-1" }, secret);

    expect(getJwtHeader(token)?.typ).toBeUndefined();
    expect(() => assertJwtTypHeader(token)).toThrow(/typ header is required/i);
  });
});
