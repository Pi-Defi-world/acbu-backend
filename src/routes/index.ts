import { Router, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { config } from "../config/env";
import { deepHealthCheck } from "../controllers/healthController";
import { requireAdminApiKey } from "../middleware/adminAuth";
import { registry } from "../config/promMetrics";

/**
 * W10-OBS-003: Lightweight scrape-token guard for the /metrics endpoint.
 *
 * When METRICS_SCRAPE_TOKEN is set the request must carry:
 *   Authorization: Bearer <METRICS_SCRAPE_TOKEN>
 *
 * When METRICS_SCRAPE_TOKEN is not set the endpoint is open — acceptable for
 * deployments where the metrics path is only reachable inside the cluster
 * network (e.g. behind a NetworkPolicy / ClusterIP service).
 */
function requireScrapeToken(req: Request, res: Response, next: NextFunction): void {
  const token = process.env.METRICS_SCRAPE_TOKEN ?? (config as Record<string, unknown>).metricsScrapeToken as string | undefined;

  // No token configured → open endpoint (internal-network deployments)
  if (!token) {
    next();
    return;
  }

  const authHeader = req.headers.authorization ?? "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!provided) {
    res.status(401).set("WWW-Authenticate", 'Bearer realm="metrics"').end();
    return;
  }

  // Constant-time comparison to prevent timing attacks
  const providedBuf = Buffer.from(provided, "utf8");
  const expectedBuf = Buffer.from(token, "utf8");
  const valid =
    providedBuf.length === expectedBuf.length &&
    crypto.timingSafeEqual(providedBuf, expectedBuf);

  if (!valid) {
    res.status(403).end();
    return;
  }

  next();
}
import reserveRoutes from "./reserveRoutes";
import recipientRoutes from "./recipientRoutes";
import transferRoutes from "./transferRoutes";
import userRoutes from "./userRoutes";
import recoveryRoutes from "./recoveryRoutes";
import authRoutes from "./authRoutes";
import mintRoutes from "./mintRoutes";
import burnRoutes from "./burnRoutes";
import ratesRoutes from "./ratesRoutes";
import transactionRoutes from "./transactionRoutes";
import p2pRoutes from "./p2pRoutes";
import smeRoutes from "./smeRoutes";
import internationalRoutes from "./internationalRoutes";
import salaryRoutes from "./salaryRoutes";
import enterpriseRoutes from "./enterpriseRoutes";
import savingsRoutes from "./savingsRoutes";
import lendingRoutes from "./lendingRoutes";
import gatewayRoutes from "./gatewayRoutes";
import billsRoutes from "./billsRoutes";
import onrampRoutes from "./onrampRoutes";
import retailFundsRoutes from "./retailFundsRoutes";
import businessFundsRoutes from "./businessFundsRoutes";
import governmentFundsRoutes from "./governmentFundsRoutes";
import investmentRoutes from "./investmentRoutes";
import fiatRoutes from "./fiatRoutes";
import configRoutes from "./configRoutes";
import complianceRoutes from "./complianceRoutes";
import kycRoutes from "./kycRoutes";
import weightDriftAuditRoutes from "./weightDriftAuditRoutes";
import reportRoutes from "./reportRoutes";
import privacyRoutes from "./privacy";

const router: ReturnType<typeof Router> = Router({ caseSensitive: true });

// Shallow health check — always 200, no dependency probing (used by load balancers)
router.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: config.apiVersion,
  });
});

// Changelog / version history — lists current and past API versions with status
router.get("/changelog", (_req, res) => {
  res.json({
    currentVersion: config.apiVersion,
    versions: [
      {
        version: "v1",
        status: "current",
        releasedAt: "2024-01-01",
        description: "Initial public release of the ACBU API.",
      },
    ],
  });
});

// Kubernetes readiness check — probes all critical dependencies; returns 503 if any are down
// Use this endpoint for K8s readinessProbe configurations
router.get("/health/ready", deepHealthCheck);

// Deep health check — probes PostgreSQL, MongoDB, RabbitMQ; returns 503 if any are down
router.get("/health/deep", requireAdminApiKey, deepHealthCheck);

// Extended health / metrics (reserve ratio when available; for monitoring dashboards)
router.get("/health/metrics", requireAdminApiKey, deepHealthCheck);

// #388 / W10-OBS-003: Prometheus-compatible metrics endpoint.
//
// Authentication behaviour (controlled by METRICS_SCRAPE_TOKEN env var):
//
//   METRICS_SCRAPE_TOKEN set   — requires  "Authorization: Bearer <token>"
//                                 header on every scrape request.
//                                 Set this when the /metrics path is reachable
//                                 from outside the cluster.
//
//   METRICS_SCRAPE_TOKEN unset — endpoint is open (no auth required).
//                                 Acceptable when the path is only reachable
//                                 inside the cluster network (e.g. Prometheus
//                                 scraping via ClusterIP with NetworkPolicy).
//
// Prometheus scrape_config example (with token):
//
//   scrape_configs:
//     - job_name: acbu-backend
//       metrics_path: /api/v1/metrics
//       bearer_token: <METRICS_SCRAPE_TOKEN value>
//       static_configs:
//         - targets: ["acbu-backend:5000"]
//
// Prometheus scrape_config example (without token / internal only):
//
//   scrape_configs:
//     - job_name: acbu-backend
//       metrics_path: /api/v1/metrics
//       static_configs:
//         - targets: ["acbu-backend:5000"]
router.get("/metrics", requireScrapeToken, async (_req, res) => {
  res.set("Content-Type", registry.contentType);
  res.end(await registry.metrics());
});

// API routes
router.use("/auth", authRoutes);
router.use("/reserves", reserveRoutes);
router.use("/recipient", recipientRoutes);
router.use("/transfers", transferRoutes);
router.use("/users", userRoutes);
router.use("/recovery", recoveryRoutes);
router.use("/mint", mintRoutes);
router.use("/burn", burnRoutes);
router.use("/rates", ratesRoutes);
router.use("/transactions", transactionRoutes);
router.use("/p2p", p2pRoutes);
router.use("/sme", smeRoutes);
router.use("/international", internationalRoutes);
router.use("/salary", salaryRoutes);
router.use("/enterprise", enterpriseRoutes);
router.use("/savings", savingsRoutes);
router.use("/lending", lendingRoutes);
router.use("/gateway", gatewayRoutes);
router.use("/bills", billsRoutes);
router.use("/onramp", onrampRoutes);
router.use("/retail", retailFundsRoutes);
router.use("/business", businessFundsRoutes);
router.use("/government", governmentFundsRoutes);
router.use("/investment", investmentRoutes);
router.use("/fiat", fiatRoutes);
router.use("/config", configRoutes);
router.use("/kyc", kycRoutes);
router.use("/reports", reportRoutes);
router.use("/compliance", complianceRoutes);
router.use("/privacy", privacyRoutes);
router.use("/admin/weight-drift-audits", weightDriftAuditRoutes);

export default router;
