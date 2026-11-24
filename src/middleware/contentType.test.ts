import express from "express";
import request from "supertest";
import { requireJsonContentType } from "./contentType";
import { errorHandler } from "./errorHandler";

describe("requireJsonContentType", () => {
  const app = express();

  beforeAll(() => {
    app.post("/webhook", requireJsonContentType, (_req, res) => {
      res.status(204).send();
    });
    app.use(errorHandler);
  });

  it("allows application/json requests", async () => {
    await request(app)
      .post("/webhook")
      .set("Content-Type", "application/json")
      .send("{}")
      .expect(204);
  });

  it("allows application/json requests with content-type parameters", async () => {
    await request(app)
      .post("/webhook")
      .set("Content-Type", "application/json; charset=utf-8")
      .send("{}")
      .expect(204);
  });

  it("rejects non-json content types", async () => {
    await request(app)
      .post("/webhook")
      .set("Content-Type", "text/xml")
      .send("<webhook />")
      .expect(415)
      .expect((res) => {
        expect(res.body.error.code).toBe("INVALID_CONTENT_TYPE");
        expect(res.body.error.message).toBe("Content-Type must be application/json");
      });
  });

  it("rejects requests without a content type", async () => {
    await request(app)
      .post("/webhook")
      .expect(415)
      .expect((res) => {
        expect(res.body.error.code).toBe("INVALID_CONTENT_TYPE");
      });
  });
});
