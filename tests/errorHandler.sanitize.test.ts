import express from "express";
import request from "supertest";
import { AppError, errorHandler } from "../src/middleware/errorHandler";

describe("errorHandler details sanitization", () => {
  const app = express();

  beforeAll(() => {
    app.get("/validation-error", () => {
      throw new AppError("Validation error", 400, {
        errors: [
          { path: "body.amount", message: "Amount must be a decimal string" },
        ],
      });
    });

    app.get("/zod-validation-error", () => {
      throw new AppError("Validation error", 400, {
        formErrors: [],
        fieldErrors: { amount: ["Amount must be a decimal string"] },
      });
    });

    app.get("/internal-error", () => {
      throw new AppError("Upstream failure", 500, {
        token: "super-secret-token-value",
        stack: "Error: boom\n    at internal/file.ts:42:11",
        nested: { apiKey: "nested-secret", dbPassword: "pg-secret" },
      });
    });

    app.use(errorHandler);
  });

  it("keeps safe field-level validation details", async () => {
    const res = await request(app).get("/validation-error").expect(400);

    expect(res.body.error.details).toEqual({
      errors: [
        { path: "body.amount", message: "Amount must be a decimal string" },
      ],
    });
  });

  it("keeps safe Zod flatten() details", async () => {
    const res = await request(app).get("/zod-validation-error").expect(400);

    expect(res.body.error.details).toEqual({
      formErrors: [],
      fieldErrors: { amount: ["Amount must be a decimal string"] },
    });
  });

  it("redacts sensitive or nested internal state from details", async () => {
    const res = await request(app).get("/internal-error").expect(500);

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain("super-secret-token-value");
    expect(serialized).not.toContain("nested-secret");
    expect(serialized).not.toContain("pg-secret");
    expect(serialized).not.toContain("internal/file.ts");

    expect(res.body.error.details).toEqual({
      type: "object",
      keys: ["token", "stack", "nested"],
    });
  });
});
