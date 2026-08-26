/**
 * Weight Drift Audit Service
 *
 * Responsibilities:
 * 1. Calculate weight drift: actual weight vs policy (basket config target)
 * 2. Generate drift report with per-currency analysis
 * 3. Create audit records in DB with pending status
 * 4. Track manual approval workflow with audit trail
 * 5. Emit audit logs for all policy changes
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/database";
import { logger } from "../../config/logger";
import { basketService } from "../basket";
import { reserveTracker } from "../reserve/ReserveTracker";
import { logAudit } from "../audit";
import { Decimal } from "@prisma/client/runtime/library";

const DRIFT_THRESHOLD_PCT = 2; // Trigger audit if drift exceeds 2%

export interface WeightDriftEntry {
  currency: string;
  policyWeight: number;
  actualWeight: number;
  driftPercent: number;
  exceedsThreshold: boolean;
  recommendation: string;
}

export interface WeightDriftReport {
  auditId: string;
  auditPeriodStart: Date;
  auditPeriodEnd: Date;
  totalCurrencies: number;
  currenciesExceedingThreshold: number;
  maxDriftPercent: number;
  entries: WeightDriftEntry[];
  status: "pending" | "approved" | "rejected";
}

/** WeightDriftAudit row as stored in the database (no relations). */
type WeightDriftAuditRow = Prisma.WeightDriftAuditGetPayload<{}>;
/** WeightDriftCurrency row as stored in the database. */
type WeightDriftCurrencyRow = Prisma.WeightDriftCurrencyGetPayload<{}>;
/** WeightDriftAudit row including its per-currency snapshot rows. */
type WeightDriftAuditWithCurrencies = Prisma.WeightDriftAuditGetPayload<{
  include: { currencies: true };
}>;

export class WeightDriftAuditService {
  /**
   * The extended `prisma` client is typed as a union of the base and Accelerate
   * extensions, which makes model delegates with `include` uncallable. The plain
   * transaction-client type exposes clean, callable delegates for direct reads.
   */
  private get prismaTx(): Prisma.TransactionClient {
    return prisma as unknown as Prisma.TransactionClient;
  }

  /**
   * Calculate drift for each currency: actual vs policy weight.
   * Returns audit-ready report.
   */
  async calculateDriftReport(): Promise<WeightDriftReport> {
    try {
      // Get policy (target) weights from active basket config
      const policyBasket = await basketService.getCurrentBasket();
      const policyWeights = new Map(policyBasket.map((e) => [e.currency, e.weight]));

      // Get actual weights from on-chain/fintech reserves
      const reserveHealth = await reserveTracker.getReserveStatus();
      const actualWeights = new Map(
        reserveHealth.currencies.map((c) => [c.currency, c.actualWeight]),
      );

      // Calculate drift per currency
      const entries: WeightDriftEntry[] = [];
      let maxDrift = 0;
      let exceedingCount = 0;

      for (const [currency, policyWeight] of policyWeights) {
        const actualWeight = actualWeights.get(currency) || 0;
        const driftPercent = actualWeight - policyWeight;
        const exceedsThreshold = Math.abs(driftPercent) >= DRIFT_THRESHOLD_PCT;

        if (exceedsThreshold) {
          exceedingCount++;
        }

        maxDrift = Math.max(maxDrift, Math.abs(driftPercent));

        const recommendation = this.generateRecommendation(
          currency,
          policyWeight,
          driftPercent,
        );

        entries.push({
          currency,
          policyWeight,
          actualWeight,
          driftPercent,
          exceedsThreshold,
          recommendation,
        });
      }

      const now = new Date();
      const periodStart = new Date(now);
      periodStart.setDate(periodStart.getDate() - 7); // Last 7 days

      return {
        auditId: "", // Will be set after DB insert
        auditPeriodStart: periodStart,
        auditPeriodEnd: now,
        totalCurrencies: policyBasket.length,
        currenciesExceedingThreshold: exceedingCount,
        maxDriftPercent: maxDrift,
        entries,
        status: "pending",
      };
    } catch (e) {
      logger.error("Failed to calculate weight drift report", { error: e });
      throw e;
    }
  }

  /**
   * Store audit report in DB with pending status.
   */
  async createAudit(report: WeightDriftReport, createdBy: string): Promise<WeightDriftReport> {
    const tx = await prisma.$transaction(async (tx) => {
      // Create main audit record
      const auditRecord = await tx.weightDriftAudit.create({
        data: {
          auditPeriodStart: report.auditPeriodStart,
          auditPeriodEnd: report.auditPeriodEnd,
          totalCurrencies: report.totalCurrencies,
          currenciesExceedingThreshold: report.currenciesExceedingThreshold,
          maxDriftPercent: new Decimal(report.maxDriftPercent),
          status: "pending",
          diffReport: report as unknown as Prisma.InputJsonValue,
          createdBy,
        },
      });

      // Create per-currency entries
      for (const entry of report.entries) {
        await tx.weightDriftCurrency.create({
          data: {
            auditId: auditRecord.id,
            currency: entry.currency,
            policyWeight: new Decimal(entry.policyWeight),
            actualWeight: new Decimal(entry.actualWeight),
            driftPercent: new Decimal(entry.driftPercent),
            exceedsThreshold: entry.exceedsThreshold,
            recommendation: entry.recommendation,
          },
        });
      }

      // Emit audit log for audit creation
      await logAudit({
        eventType: "WEIGHT_DRIFT_AUDIT_CREATED",
        entityType: "WeightDriftAudit",
        entityId: auditRecord.id,
        action: "create",
        performedBy: createdBy,
        newValue: {
          status: "pending",
          currenciesExceedingThreshold: report.currenciesExceedingThreshold,
          maxDriftPercent: report.maxDriftPercent,
        },
      });

      logger.info("Weight drift audit created", {
        auditId: auditRecord.id,
        exceedingThreshold: report.currenciesExceedingThreshold,
        maxDrift: report.maxDriftPercent,
      });

      return {
        ...report,
        auditId: auditRecord.id,
        status: "pending" as const,
      };
    });

    return tx;
  }

  /**
   * Approve pending audit by admin with optional notes.
   * Updates status to approved and logs approval.
   */
  async approveAudit(
    auditId: string,
    approvedBy: string,
    approvalNotes?: string,
  ): Promise<WeightDriftReport> {
    const audit = await this.prismaTx.weightDriftAudit.findUniqueOrThrow({
      where: { id: auditId },
      include: { currencies: true },
    });

    if (audit.status !== "pending") {
      throw new Error(`Cannot approve audit with status: ${audit.status}`);
    }

    const updatedAudit = await prisma.$transaction(async (tx: any) => {
      const updated = await tx.weightDriftAudit.update({
        where: { id: auditId },
        data: {
          status: "approved",
          approvedBy,
          approvalNotes,
          approvedAt: new Date(),
        },
      });

      // Emit audit log for approval
      await logAudit({
        eventType: "WEIGHT_DRIFT_AUDIT_APPROVED",
        entityType: "WeightDriftAudit",
        entityId: auditId,
        action: "approve",
        performedBy: approvedBy,
        newValue: {
          status: "approved",
          approvalNotes,
        },
      });

      logger.info("Weight drift audit approved", {
        auditId,
        approvedBy,
      });

      return updated;
    });

    return this.formatAuditReport(updatedAudit, audit.currencies);
  }

  /**
   * Reject pending audit with reason.
   */
  async rejectAudit(
    auditId: string,
    rejectedBy: string,
    reason: string,
  ): Promise<WeightDriftReport> {
    const audit = await this.prismaTx.weightDriftAudit.findUniqueOrThrow({
      where: { id: auditId },
      include: { currencies: true },
    });

    if (audit.status !== "pending") {
      throw new Error(`Cannot reject audit with status: ${audit.status}`);
    }

    const updatedAudit = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.weightDriftAudit.update({
        where: { id: auditId },
        data: {
          status: "rejected",
          approvalNotes: reason,
        },
      });

      // Emit audit log for rejection
      await logAudit({
        eventType: "WEIGHT_DRIFT_AUDIT_REJECTED",
        entityType: "WeightDriftAudit",
        entityId: auditId,
        action: "reject",
        performedBy: rejectedBy,
        newValue: {
          status: "rejected",
          reason,
        },
      });

      logger.info("Weight drift audit rejected", {
        auditId,
        rejectedBy,
      });

      return updated;
    });

    return this.formatAuditReport(updatedAudit, audit.currencies);
  }

  /**
   * Get paginated list of recent audits with optional filtering.
   */
  async listAudits(
    status?: "pending" | "approved" | "rejected",
    limit = 20,
    offset = 0,
  ): Promise<{ audits: WeightDriftReport[]; total: number }> {
    const where = status ? { status } : {};

    const [audits, total] = await Promise.all([
      this.prismaTx.weightDriftAudit.findMany({
        where,
        include: { currencies: true },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      this.prismaTx.weightDriftAudit.count({ where }),
    ]);

    return {
      audits: audits.map((a: any) => this.formatAuditReport(a, a.currencies)),
      total,
    };
  }

  /**
   * Get single audit with full details.
   */
  async getAudit(auditId: string): Promise<WeightDriftReport> {
    const audit = await this.prismaTx.weightDriftAudit.findUniqueOrThrow({
      where: { id: auditId },
      include: { currencies: true },
    });

    return this.formatAuditReport(audit, audit.currencies);
  }

  // Helper: Generate remediation recommendation based on drift
  private generateRecommendation(
    currency: string,
    policyWeight: number,
    driftPercent: number,
  ): string {
    if (Math.abs(driftPercent) <= 0.5) {
      return "Within acceptable range. No action required.";
    }

    if (driftPercent > 0) {
      return `Overweight by ${driftPercent.toFixed(2)}%. Consider reducing ${currency} position by ~${Math.abs(driftPercent).toFixed(1)}% to realign with ${policyWeight}% target.`;
    } else {
      return `Underweight by ${Math.abs(driftPercent).toFixed(2)}%. Consider increasing ${currency} position by ~${Math.abs(driftPercent).toFixed(1)}% to reach ${policyWeight}% target.`;
    }
  }

  // Helper: Format audit record for API response
  private formatAuditReport(audit: any, currencies: any[]): WeightDriftReport {
    return {
      auditId: audit.id,
      auditPeriodStart: audit.auditPeriodStart,
      auditPeriodEnd: audit.auditPeriodEnd,
      totalCurrencies: audit.totalCurrencies,
      currenciesExceedingThreshold: audit.currenciesExceedingThreshold,
      maxDriftPercent: Number(audit.maxDriftPercent),
      entries: currencies.map((c) => ({
        currency: c.currency,
        policyWeight: Number(c.policyWeight),
        actualWeight: Number(c.actualWeight),
        driftPercent: Number(c.driftPercent),
        exceedsThreshold: c.exceedsThreshold,
        recommendation: c.recommendation || "",
      })),
      status: audit.status as WeightDriftReport["status"],
    };
  }
}

export const weightDriftAuditService = new WeightDriftAuditService();
