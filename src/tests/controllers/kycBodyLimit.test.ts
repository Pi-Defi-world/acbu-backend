import express from "express";
import request from "supertest";

const MAX_REQUEST_BODY_SIZE = "1mb";

function buildApp(): express.Express {
  const app = express();

  app.use(express.urlencoded({ extended: true, limit: MAX_REQUEST_BODY_SIZE }));
  app.use(express.json({ limit: MAX_REQUEST_BODY_SIZE }));

  app.use(
    (
      err: Error & { type?: string },
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (err?.type === "entity.too.large") {
        res.status(413).json({
          error: {
            code: "PAYLOAD_TOO_LARGE",
            message: "Request body exceeds maximum allowed size",
          },
        });
        return;
      }
      next(err);
    },
  );

  app.post("/api/v1/kyc/documents/upload-url", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  return app;
}

describe("KYC request body limits", () => {
  it("rejects oversized KYC upload metadata requests with 413", async () => {
    const app = buildApp();

    const oversizedPayload = {
      document_kind: "passport",
      mime_type: "application/pdf",
      document_id: "00000000-0000-0000-0000-000000000000",
      padding: "a".repeat(2 * 1024 * 1024),
    };

    const response = await request(app)
      .post("/api/v1/kyc/documents/upload-url")
      .send(oversizedPayload)
      .set("Content-Type", "application/json");

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "Request body exceeds maximum allowed size",
      },
    });
  });
});
