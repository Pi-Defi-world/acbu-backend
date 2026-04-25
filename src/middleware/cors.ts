import cors from "cors";
import { config } from "../config/env";

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    if (
      !origin || config.corsOrigin.includes(origin)
    ) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
});
