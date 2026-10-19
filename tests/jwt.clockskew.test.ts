jest.mock("dotenv", () => ({
  config: jest.fn(),
}));

// #984 — the JTI deny-list is now shared through Redis. The real redisService
// would try to reach a live server, so back it with an in-memory store that
// preserves the SET NX semantics under test.
const mockRedisStore = new Map<string, string>();

jest.mock("../src/services/cache", () => ({
  redisService: {
    get: jest.fn(async (key: string) => (mockRedisStore.has(key) ? "1" : null)),
    set: jest.fn(async (key: string) => {
      mockRedisStore.set(key, "1");
      return "OK";
    }),
    setNx: jest.fn(async (key: string) => {
      if (mockRedisStore.has(key)) return false;
      mockRedisStore.set(key, "1");
      return true;
    }),
  },
}));

describe("B-065 — JWT clock skew / leeway handling", () => {
  const ORIGINAL = process.env;
  const REQUIRED_ENV = {
    DATABASE_URL: "postgresql://test:test@localhost/test",
    MONGODB_URI: "mongodb://localhost/test",
    RABBITMQ_URL: "amqp://localhost",
    JWT_SECRET: "test-secret-key-for-clock-skew-tests",
  };

  beforeEach(() => {
    jest.resetModules();
    mockRedisStore.clear();
    process.env = { ...ORIGINAL, ...REQUIRED_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL;
  });

  const SECRET = "test-secret-key-for-clock-skew-tests";
  const AUDIENCE = "2fa_challenge";
  const ISSUER = "acbu/auth";

  // Import after env is set up
  const jwt = require("jsonwebtoken");
  const { signChallengeToken, verifyChallengeToken } = require("../src/utils/jwt");

  it("verifies a normally issued challenge token", async () => {
    const token = signChallengeToken("user-abc");
    const payload = await verifyChallengeToken(token);
    expect(payload.userId).toBe("user-abc");
  });

  it("rejects a token with a tampered audience", async () => {
    const token = jwt.sign(
      { userId: "user-abc", aud: "wrong_audience", iss: ISSUER },
      SECRET,
      { expiresIn: "5m" },
    );
    await expect(verifyChallengeToken(token)).rejects.toThrow();
  });

  it("rejects an expired token outside the tolerance window", async () => {
    // iat and exp both in the past, well beyond any tolerance
    const token = jwt.sign(
      { userId: "user-abc", aud: AUDIENCE, iss: ISSUER },
      SECRET,
      { expiresIn: "-120s" },
    );
    await expect(verifyChallengeToken(token)).rejects.toThrow();
  });

  it("accepts a token issued slightly in the future within clock tolerance", async () => {
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
    const payload = await verifyChallengeToken(token);
    expect(payload.userId).toBe("user-skew");
  });

  it("rejects a token issued far in the future beyond the tolerance window", async () => {
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
    await expect(verifyChallengeToken(token)).rejects.toThrow();
  });

  it("rejects a token signed with the wrong secret", async () => {
    const token = jwt.sign(
      { userId: "user-abc", aud: AUDIENCE, iss: ISSUER },
      "wrong-secret",
      { expiresIn: "5m" },
    );
    await expect(verifyChallengeToken(token)).rejects.toThrow();
  });

  it("rejects OAuth access tokens with typ at+JWT (JWT confusion)", async () => {
    const token = jwt.sign(
      { userId: "user-abc", aud: AUDIENCE, iss: ISSUER },
      SECRET,
      {
        expiresIn: "5m",
        header: { typ: "at+JWT", alg: "HS256" },
      },
    );
    await expect(verifyChallengeToken(token)).rejects.toThrow();
  });

  it("signs challenge tokens with typ JWT", () => {
    const token = signChallengeToken("user-abc");
    const header = jwt.decode(token, { complete: true });
    expect(header && typeof header !== "string" ? header.header.typ : null).toBe("JWT");
  });

  it("rejects a challenge token replayed after its jti was consumed (#984)", async () => {
    const token = signChallengeToken("user-replay");
    const first = await verifyChallengeToken(token);
    expect(first.userId).toBe("user-replay");

    // The JTI is now claimed in the shared store; the second use is a replay.
    await expect(verifyChallengeToken(token)).rejects.toThrow(/already been used/);
  });

  it("does not consume the jti when consumeJti is false (#984)", async () => {
    const token = signChallengeToken("user-no-consume");
    await verifyChallengeToken(token, { consumeJti: false });
    await expect(
      verifyChallengeToken(token, { consumeJti: false }),
    ).resolves.toMatchObject({ userId: "user-no-consume" });
  });
});
