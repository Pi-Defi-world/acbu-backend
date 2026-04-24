process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
process.env.MONGODB_URI = "mongodb://localhost/test";
process.env.RABBITMQ_URL = "amqp://localhost";
process.env.JWT_SECRET = "test-secret-key-for-clock-skew-tests";

import jwt from "jsonwebtoken";
import { signChallengeToken, verifyChallengeToken } from "../src/utils/jwt";

const SECRET = "test-secret-key-for-clock-skew-tests";
const AUDIENCE = "2fa_challenge";
const ISSUER = "acbu/auth";

describe("B-065 — JWT clock skew / leeway handling", () => {
  it("verifies a normally issued challenge token", () => {
    const token = signChallengeToken("user-abc");
    const payload = verifyChallengeToken(token);
    expect(payload.userId).toBe("user-abc");
  });

  it("rejects a token with a tampered audience", () => {
    const token = jwt.sign(
      { userId: "user-abc", aud: "wrong_audience", iss: ISSUER },
      SECRET,
      { expiresIn: "5m" },
    );
    expect(() => verifyChallengeToken(token)).toThrow();
  });

  it("rejects an expired token outside the tolerance window", () => {
    // iat and exp both in the past, well beyond any tolerance
    const token = jwt.sign(
      { userId: "user-abc", aud: AUDIENCE, iss: ISSUER },
      SECRET,
      { expiresIn: "-120s" },
    );
    expect(() => verifyChallengeToken(token)).toThrow();
  });

  it("accepts a token issued slightly in the future within clock tolerance", () => {
    // Simulate a token issued 15s in the future (within default 30s tolerance)
    const nowPlusFifteen = Math.floor(Date.now() / 1000) + 15;
    const token = jwt.sign(
      {
        userId: "user-skew",
        aud: AUDIENCE,
        iss: ISSUER,
        iat: nowPlusFifteen,
        exp: nowPlusFifteen + 300,
      },
      SECRET,
    );
    const payload = verifyChallengeToken(token);
    expect(payload.userId).toBe("user-skew");
  });

  it("rejects a token issued far in the future beyond the tolerance window", () => {
    // 120s clock skew — well past the 30s default tolerance
    const farFuture = Math.floor(Date.now() / 1000) + 120;
    const token = jwt.sign(
      {
        userId: "user-future",
        aud: AUDIENCE,
        iss: ISSUER,
        iat: farFuture,
        exp: farFuture + 300,
      },
      SECRET,
    );
    expect(() => verifyChallengeToken(token)).toThrow();
  });

  it("rejects a token signed with the wrong secret", () => {
    const token = jwt.sign(
      { userId: "user-abc", aud: AUDIENCE, iss: ISSUER },
      "wrong-secret",
      { expiresIn: "5m" },
    );
    expect(() => verifyChallengeToken(token)).toThrow();
  });
});
