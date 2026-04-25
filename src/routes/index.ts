import { Router } from "express";
import { config } from "../config/env";
import { deepHealthCheck } from "../controllers/healthController";
import reserveRoutes from "./reserveRoutes";
import recipientRoutes from "./recipientRoutes";
import transferRoutes from "./transferRoutes";
import userRoutes from "./userRoutes";
import recoveryRoutes from "./recoveryRoutes";
import authRoutes from "./authRoutes";
import webhookRoutes from "./webhookRoutes";
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

const router: ReturnType<typeof Router> = Router();

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
router.get("/health/deep", deepHealthCheck);

// Extended health / metrics (reserve ratio when available; for monitoring dashboards)
router.get("/health/metrics", deepHealthCheck);

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
router.use("/webhooks", webhookRoutes);

export default router;
