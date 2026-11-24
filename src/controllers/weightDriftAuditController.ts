/**
 * Weight Drift Audit Controller
 *
 * Endpoints for:
 * 1. GET /v1/admin/weight-drift-audits - List audits with filtering
 * 2. GET /v1/admin/weight-drift-audits/:id - Get single audit
 * 3. POST /v1/admin/weight-drift-audits - Trigger manual audit
 * 4. POST /v1/admin/weight-drift-audits/:id/approve - Approve audit
 * 5. POST /v1/admin/weight-drift-audits/:id/reject - Reject audit
 *
 * All endpoints require ADMIN_KEY authentication.
 */

import { Request, Response, NextFunction } from "express";
import { weightDriftAuditService } from "../services/reserve/WeightDriftAuditService";
import { logger } from "../config/logger";
import { AppError } from "../middleware/errorHandler";
import { ErrorCodes } from "../types/errorCodes";

/**
 * @swagger
 * /v1/admin/weight-drift-audits:
 *   get:
 *     summary: List weight drift audits
 *     tags: [Admin, WeightDriftAudit]
 *     security:
 *       - AdminKeyAuth: []
 *     parameters:
 *       - name: status
 *         in: query
 *         schema:
 *           type: string
 *           enum: [pending, approved, rejected]
 *       - name: limit
 *         in: query
 *         schema:
 *           type: integer
 *           default: 20
 *       - name: offset
 *         in: query
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: List of audits with pagination
 */
export const listWeightDriftAudits = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { status, limit = 20, offset = 0 } = req.query;

    const result = await weightDriftAuditService.listAudits(
      status as "pending" | "approved" | "rejected" | undefined,
      Number(limit),
      Number(offset),
    );

    res.json({
      audits: result.audits,
      pagination: {
        limit: Number(limit),
        offset: Number(offset),
        total: result.total,
      },
    });
  } catch (e) {
    logger.error("Failed to list weight drift audits", { error: e });
    next(e);
  }
};

/**
 * @swagger
 * /v1/admin/weight-drift-audits/{id}:
 *   get:
 *     summary: Get weight drift audit details
 *     tags: [Admin, WeightDriftAudit]
 *     security:
 *       - AdminKeyAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Full audit details with per-currency breakdown
 *       404:
 *         description: Audit not found
 */
export const getWeightDriftAudit = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const audit = await weightDriftAuditService.getAudit(id);

    res.json(audit);
  } catch (e) {
    if ((e as any).code === "P2025") {
      throw new AppError("Audit not found", 404, ErrorCodes.NOT_FOUND);
    } else {
      logger.error("Failed to get weight drift audit", { error: e });
      next(e);
    }
  }
};

/**
 * @swagger
 * /v1/admin/weight-drift-audits:
 *   post:
 *     summary: Manually trigger weight drift audit
 *     tags: [Admin, WeightDriftAudit]
 *     security:
 *       - AdminKeyAuth: []
 *     responses:
 *       201:
 *         description: Audit created with pending status
 */
export const createWeightDriftAudit = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    // Extract admin ID from auth context (set by middleware)
    const adminId = (req as any).adminId || "system";

    // Calculate drift report
    const report = await weightDriftAuditService.calculateDriftReport();

    // Create audit in DB
    const audit = await weightDriftAuditService.createAudit(report, adminId);

    logger.info("Manual weight drift audit created", {
      auditId: audit.auditId,
      createdBy: adminId,
    });

    res.status(201).json(audit);
  } catch (e) {
    logger.error("Failed to create weight drift audit", { error: e });
    next(e);
  }
};

/**
 * @swagger
 * /v1/admin/weight-drift-audits/{id}/approve:
 *   post:
 *     summary: Approve pending weight drift audit
 *     tags: [Admin, WeightDriftAudit]
 *     security:
 *       - AdminKeyAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               approvalNotes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Audit approved
 *       400:
 *         description: Audit is not in pending status
 *       404:
 *         description: Audit not found
 */
export const approveWeightDriftAudit = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { approvalNotes } = req.body;

    const adminId = (req as any).adminId || "system";

    const audit = await weightDriftAuditService.approveAudit(id, adminId, approvalNotes);

    logger.info("Weight drift audit approved", {
      auditId: id,
      approvedBy: adminId,
    });

    res.json(audit);
  } catch (e) {
    const error = e as any;
    if (error.code === "P2025") {
      throw new AppError("Audit not found", 404, ErrorCodes.NOT_FOUND);
    } else if (error.message?.includes("Cannot approve audit")) {
      throw new AppError(error.message, 400, ErrorCodes.BAD_REQUEST);
    } else {
      logger.error("Failed to approve weight drift audit", { error: e });
      next(e);
    }
  }
};

/**
 * @swagger
 * /v1/admin/weight-drift-audits/{id}/reject:
 *   post:
 *     summary: Reject pending weight drift audit
 *     tags: [Admin, WeightDriftAudit]
 *     security:
 *       - AdminKeyAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 required: true
 *     responses:
 *       200:
 *         description: Audit rejected
 *       400:
 *         description: Audit is not in pending status
 *       404:
 *         description: Audit not found
 */
export const rejectWeightDriftAudit = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason) {
      throw new AppError("Rejection reason is required", 400, ErrorCodes.REJECTION_REASON_REQUIRED);
    }

    const adminId = (req as any).adminId || "system";

    const audit = await weightDriftAuditService.rejectAudit(id, adminId, reason);

    logger.info("Weight drift audit rejected", {
      auditId: id,
      rejectedBy: adminId,
    });

    res.json(audit);
  } catch (e) {
    const error = e as any;
    if (error.code === "P2025") {
      throw new AppError("Audit not found", 404, ErrorCodes.NOT_FOUND);
    } else if (error.message?.includes("Cannot reject audit")) {
      throw new AppError(error.message, 400, ErrorCodes.BAD_REQUEST);
    } else {
      logger.error("Failed to reject weight drift audit", { error: e });
      next(e);
    }
  }
};
