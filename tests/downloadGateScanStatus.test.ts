/**
 * AB-020 — the presigned-download gate must fail closed.
 *
 * `getObjectScanStatus` cannot read the scan tag when S3 rejects the HeadObject
 * (permissions, throttling, transient outage). The download gate has to refuse
 * the request in that case instead of signing a URL for an object whose scan
 * state is unknown.
 */

process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
process.env.MONGODB_URI = "mongodb://localhost/test";
process.env.RABBITMQ_URL = "amqp://localhost";
process.env.JWT_SECRET = "test-secret-min-32-characters-long";

// `config.nodeEnv` is "test", which makes getObjectScanStatus short-circuit to
// "clean" before it ever reads a tag. Mock the config so the tag path under test
// is the one production runs.
jest.mock("../src/config/env", () => ({
  config: {
    nodeEnv: "production",
    s3: {
      region: "us-east-1",
      bucket: "acbu-kyc-test",
      uploadUrlTtlSeconds: 900,
      downloadUrlTtlSeconds: 300,
    },
  },
}));

jest.mock("@aws-sdk/client-s3", () => {
  const send = jest.fn();
  return {
    S3Client: jest.fn().mockImplementation(() => ({ send })),
    PutObjectCommand: jest.fn(),
    GetObjectCommand: jest.fn(),
    GetObjectTaggingCommand: jest.fn(),
    HeadObjectCommand: jest.fn(),
    PutObjectTaggingCommand: jest.fn(),
    __send: send,
  };
});

jest.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: jest.fn().mockResolvedValue("https://s3.example.com/signed"),
}));

jest.mock("../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logFinancialEvent: jest.fn(),
}));

import { generateDownloadUrl, getObjectScanStatus } from "../src/services/storage/s3Service";

const { __send: s3Send } = jest.requireMock("@aws-sdk/client-s3") as { __send: jest.Mock };

const OWNED_KEY = "kyc/user-abc/passport/doc-1";
const tag = (value: string) => ({ TagSet: [{ Key: "scan-status", Value: value }] });

beforeEach(() => {
  jest.clearAllMocks();
});

describe("generateDownloadUrl virus-scan gate (AB-020)", () => {
  it("refuses to sign a URL when the scan status cannot be read", async () => {
    s3Send.mockRejectedValue(
      Object.assign(new Error("AccessDenied: not authorised to head this object"), {
        name: "AccessDenied",
      }),
    );

    await expect(generateDownloadUrl("user-abc", OWNED_KEY)).rejects.toThrow();
  });

  it("does not surface an unreadable status as a scan result", async () => {
    s3Send.mockRejectedValue(
      Object.assign(new Error("SlowDown: reduce your request rate"), { name: "SlowDown" }),
    );

    await expect(getObjectScanStatus(OWNED_KEY)).resolves.toBe("pending");
  });

  it("signs the URL once the scanner has tagged the object clean", async () => {
    s3Send.mockResolvedValue(tag("clean"));

    const result = await generateDownloadUrl("user-abc", OWNED_KEY);

    expect(result.download_url).toBe("https://s3.example.com/signed");
    expect(result.scan_status).toBe("clean");
    expect(result.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("blocks a tag value it does not recognise", async () => {
    s3Send.mockResolvedValue(tag("quarantined"));

    await expect(generateDownloadUrl("user-abc", OWNED_KEY)).rejects.toThrow(/pending virus scan/);
  });

  it("blocks an object the scanner tagged infected", async () => {
    s3Send.mockResolvedValue(tag("infected"));

    await expect(generateDownloadUrl("user-abc", OWNED_KEY)).rejects.toThrow(/failed virus scan/);
  });

  it("rejects a key that belongs to another user before any S3 call", async () => {
    await expect(generateDownloadUrl("user-xyz", OWNED_KEY)).rejects.toThrow("Access denied");
    expect(s3Send).not.toHaveBeenCalled();
  });
});
