import type { Request, Response } from "express";
import { verifyContentLength } from "../src/middleware/bodyParser";

/**
 * Build a minimal mock Request with optional headers.
 */
function makeReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

const mockRes = {} as Response;

describe("verifyContentLength", () => {
  describe("when Content-Length header is absent", () => {
    it("does not throw", () => {
      const req = makeReq({});
      const buf = Buffer.from('{"foo":"bar"}');
      expect(() => verifyContentLength(req, mockRes, buf, "utf-8")).not.toThrow();
    });
  });

  describe("when Content-Length matches actual body size", () => {
    it("does not throw", () => {
      const body = '{"amount":100}';
      const buf = Buffer.from(body);
      const req = makeReq({ "content-length": String(buf.length) });
      expect(() => verifyContentLength(req, mockRes, buf, "utf-8")).not.toThrow();
    });

    it("handles an empty body with Content-Length: 0", () => {
      const buf = Buffer.alloc(0);
      const req = makeReq({ "content-length": "0" });
      expect(() => verifyContentLength(req, mockRes, buf, "utf-8")).not.toThrow();
    });
  });

  describe("when Content-Length is smaller than actual body (padding attack)", () => {
    it("throws with status 400 and type content_length.mismatch", () => {
      const buf = Buffer.from('{"amount":100,"extra":"padding"}');
      const req = makeReq({ "content-length": "5" }); // claims only 5 bytes
      expect(() => verifyContentLength(req, mockRes, buf, "utf-8")).toThrow(
        expect.objectContaining({
          status: 400,
          type: "content_length.mismatch",
        }),
      );
    });
  });

  describe("when Content-Length is larger than actual body (truncation / smuggling)", () => {
    it("throws with status 400 and type content_length.mismatch", () => {
      const buf = Buffer.from('{"x":1}');
      const req = makeReq({ "content-length": "9999" }); // inflated value
      expect(() => verifyContentLength(req, mockRes, buf, "utf-8")).toThrow(
        expect.objectContaining({
          status: 400,
          type: "content_length.mismatch",
        }),
      );
    });

    it("error message contains declared and actual byte counts", () => {
      const buf = Buffer.from("hello");
      const req = makeReq({ "content-length": "100" });
      let errorMessage = "";
      try {
        verifyContentLength(req, mockRes, buf, "utf-8");
      } catch (err: unknown) {
        errorMessage = (err as Error).message;
      }
      expect(errorMessage).toMatch(/100/);
      expect(errorMessage).toMatch(/5/);
    });
  });

  describe("when Content-Length header is malformed", () => {
    it("throws with status 400 and type content_length.invalid for non-numeric value", () => {
      const buf = Buffer.from('{"x":1}');
      const req = makeReq({ "content-length": "abc" });
      expect(() => verifyContentLength(req, mockRes, buf, "utf-8")).toThrow(
        expect.objectContaining({
          status: 400,
          type: "content_length.invalid",
        }),
      );
    });

    it("throws with status 400 and type content_length.invalid for negative value", () => {
      const buf = Buffer.from('{"x":1}');
      const req = makeReq({ "content-length": "-1" });
      expect(() => verifyContentLength(req, mockRes, buf, "utf-8")).toThrow(
        expect.objectContaining({
          status: 400,
          type: "content_length.invalid",
        }),
      );
    });

    it("throws for an empty string value", () => {
      const buf = Buffer.from("data");
      const req = makeReq({ "content-length": "" });
      expect(() => verifyContentLength(req, mockRes, buf, "utf-8")).toThrow(
        expect.objectContaining({
          status: 400,
          type: "content_length.invalid",
        }),
      );
    });
  });

  describe("multi-byte UTF-8 content", () => {
    it("compares raw byte length, not character count", () => {
      // "€" (U+20AC) is 1 character but 3 UTF-8 bytes
      const str = "€€"; // 2 chars, 6 bytes
      const buf = Buffer.from(str, "utf-8");
      expect(buf.length).toBe(6);

      // Correct byte count should pass
      const reqOk = makeReq({ "content-length": "6" });
      expect(() => verifyContentLength(reqOk, mockRes, buf, "utf-8")).not.toThrow();

      // Character count (2) should fail
      const reqBad = makeReq({ "content-length": "2" });
      expect(() => verifyContentLength(reqBad, mockRes, buf, "utf-8")).toThrow(
        expect.objectContaining({ type: "content_length.mismatch" }),
      );
    });
  });
});
