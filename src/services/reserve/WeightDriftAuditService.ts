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
  /** Exact values retained for persistence; omitted from API-shaped reports. */
  decimalEntries?: Array<{
    policyWeight: string;
    actualWeight: string;
    driftPercent: string;
  }>;
  decimalMaxDriftPercent?: string;
}

/** WeightDriftAudit row as stored in the database (no relations). */
export type WeightDriftAuditRow = Prisma.WeightDriftAuditGetPayload<Record<string, never>>;
/** WeightDriftCurrency row as stored in the database. */
export type WeightDriftCurrencyRow = Prisma.WeightDriftCurrencyGetPayload<Record<string, never>>;
/** WeightDriftAudit row including its per-currency snapshot rows. */
export type WeightDriftAuditWithCurrencies = Prisma.WeightDriftAuditGetPayload<{
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
   *
   * W10-B-012: Iterates the union of policy and actual currencies to ensure
   * complete coverage. Validates that policy weights sum to 100% before computing drift.
   */
  async calculateDriftReport(): Promise<WeightDriftReport> {
    try {
      // Get policy (target) weights from active basket config
      const policyBasket = await basketService.getCurrentBasket();
      const policyWeights = new Map(
        policyBasket.map((e) => [e.currency, new Decimal(e.weight)]),
      );

      // W10-B-012: Validate basket weight normalization (should sum to 100%)
      const policySum = [...policyWeights.values()].reduce((sum, w) => sum + w, 0);
      if (Math.abs(policySum - 100) > 0.1) {
        logger.error("Basket weights do not sum to 100%", {
          policySum,
          currencies: policyBasket.length,
        });
        throw new Error(
          `Basket weights must sum to 100%, but sum to ${policySum.toFixed(2)}%. Cannot compute meaningful drift.`,
        );
      }

      // Get actual weights from on-chain/fintech reserves
      const reserveHealth = await reserveTracker.getReserveStatus();
      const actualWeights = new Map(
        reserveHealth.currencies.map((c) => [c.currency, c.actualWeight]),
      );

      // W10-B-012: Iterate the union of policy and actual currencies
      const allCurrencies = new Set([...policyWeights.keys(), ...actualWeights.keys()]);

      // Calculate drift per currency
      const entries: Array<{
        currency: string;
        policyWeight: Decimal;
        actualWeight: Decimal;
        driftPercent: Decimal;
        exceedsThreshold: boolean;
        recommendation: string;
      }> = [];
      let maxDrift = new Decimal(0);
      let exceedingCount = 0;

      for (const [currency, policyWeight] of policyWeights) {
        const actualWeight = new Decimal(actualWeights.get(currency) ?? 0);
        const driftPercent = actualWeight.sub(policyWeight);
        const exceedsThreshold =
          driftPercent.abs().gt(DRIFT_THRESHOLD_PCT);

        if (exceedsThreshold) {
          exceedingCount++;
        }

        maxDrift = Decimal.max(maxDrift, driftPercent.abs());

        const recommendation = this.generateRecommendation(currency, policyWeight, driftPercent);

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
        totalCurrencies: allCurrencies.size,
        currenciesExceedingThreshold: exceedingCount,
        maxDriftPercent: maxDrift.toNumber(),
        entries: entries.map((entry) => ({
          ...entry,
          policyWeight: new Decimal(entry.policyWeight).toNumber(),
          actualWeight: new Decimal(entry.actualWeight).toNumber(),
          driftPercent: new Decimal(entry.driftPercent).toNumber(),
        })),
        status: "pending",
        decimalEntries: entries.map((entry) => ({
          policyWeight: entry.policyWeight.toString(),
          actualWeight: entry.actualWeight.toString(),
          driftPercent: entry.driftPercent.toString(),
        })),
        decimalMaxDriftPercent: maxDrift.toString(),
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
          maxDriftPercent: new Decimal(
            report.decimalMaxDriftPercent ?? report.maxDriftPercent,
          ),
          status: "pending",
          diffReport: report as unknown as Prisma.InputJsonValue,
          createdBy,
        },
      });

      // Create per-currency entries
      const entries = report.decimalEntries ?? report.entries.map((entry) => ({
        policyWeight: entry.policyWeight.toString(),
        actualWeight: entry.actualWeight.toString(),
        driftPercent: entry.driftPercent.toString(),
      }));
      for (let index = 0; index < report.entries.length; index += 1) {
        const entry = report.entries[index];
        const exactEntry = entries[index];
        await tx.weightDriftCurrency.create({
          data: {
            auditId: auditRecord.id,
            currency: entry.currency,
            policyWeight: new Decimal(exactEntry.policyWeight),
            actualWeight: new Decimal(exactEntry.actualWeight),
            driftPercent: new Decimal(exactEntry.driftPercent),
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

    return this.formatAuditReport(updatedAudit, updatedAudit.currencies ?? audit.currencies ?? []);
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
    policyWeight: Decimal | number,
    actualWeight: Decimal | number,
    driftPercent: Decimal | number,
  ): string {
    const drift = new Decimal(driftPercent);
    const policy = new Decimal(policyWeight);
    if (drift.abs().lte(0.5)) {
      return "Within acceptable range. No action required.";
    }

    if (drift.gt(0)) {
      return `Overweight by ${drift.toFixed(2)}%. Consider reducing ${currency} position by ~${drift.abs().toFixed(1)}% to realign with ${policy}% target.`;
    } else {
      return `Underweight by ${drift.abs().toFixed(2)}%. Consider increasing ${currency} position by ~${drift.abs().toFixed(1)}% to reach ${policy}% target.`;
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
