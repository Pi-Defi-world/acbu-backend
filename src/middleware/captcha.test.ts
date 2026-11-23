import type { Request, Response } from "express";

const mockVerify = jest.fn();
const mockConfig: { auth: { captchaEnforcement: string } } = {
  auth: { captchaEnforcement: "optional" },
};

jest.mock("../services/auth/authService", () => ({
  verifyCaptcha: (...args: unknown[]) => mockVerify(...args),
}));
jest.mock("../config/env", () => ({ config: mockConfig }));

import { requireCaptcha } from "./captcha";
import { CaptchaRequiredError } from "../errors";

function makeReq(body: unknown = {}, header?: string): Request {
  return {
    body,
    ip: "1.2.3.4",
    get: (name: string) => (name.toLowerCase() === "x-captcha-token" ? header : undefined),
  } as unknown as Request;
}

async function run(req: Request) {
  const next = jest.fn();
  await requireCaptcha()(req, {} as Response, next);
  return next;
}

describe("requireCaptcha", () => {
  beforeEach(() => {
    mockVerify.mockReset();
    mockConfig.auth.captchaEnforcement = "optional";
  });

  it("off: skips verification", async () => {
    mockConfig.auth.captchaEnforcement = "off";
    const next = await run(makeReq({ captcha_token: "tok" }));
    expect(mockVerify).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it("optional: allows a missing token", async () => {
    const next = await run(makeReq({}));
    expect(mockVerify).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it("optional: rejects an invalid supplied token", async () => {
    mockVerify.mockResolvedValue(false);
    const next = await run(makeReq({ captcha_token: "bad" }));
    expect(next.mock.calls[0][0]).toBeInstanceOf(CaptchaRequiredError);
  });

  it("strict: rejects a missing token", async () => {
    mockConfig.auth.captchaEnforcement = "strict";
    const next = await run(makeReq({}));
    expect(mockVerify).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toBeInstanceOf(CaptchaRequiredError);
  });

  it("strict: accepts a valid token", async () => {
    mockConfig.auth.captchaEnforcement = "strict";
    mockVerify.mockResolvedValue(true);
    const next = await run(makeReq({ captcha_token: "good" }));
    expect(mockVerify).toHaveBeenCalledWith("good", "1.2.3.4");
    expect(next).toHaveBeenCalledWith();
  });

  it("reads the token from camelCase body and from the header", async () => {
    mockVerify.mockResolvedValue(true);
    await run(makeReq({ captchaToken: "camel" }));
    expect(mockVerify).toHaveBeenLastCalledWith("camel", "1.2.3.4");
    await run(makeReq({}, "hdr"));
    expect(mockVerify).toHaveBeenLastCalledWith("hdr", "1.2.3.4");
  });
});
