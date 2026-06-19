import { Response, NextFunction } from "express";
import { z } from "zod";
import { AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import * as kycService from "../services/kyc";
import { logger } from "../config/logger";

// ── Schemas ──────────────────────────────────────────────

const createApplicationSchema = z.object({
  country_code: z.string().length(2).transform((s) => s.toUpperCase()),
  fee_tx_hash: z.string().max(255).optional(),
  mint_transaction_id: z.string().uuid().optional(),
});

const attachDocumentsSchema = z.object({
  documents: z.array(
    z.object({
      kind: z.string(),
      storage_ref: z.string().max(512),
      checksum: z.string().max(64).optional(),
      mime_type: z.string().max(100).optional(),
    })
  ),
});

const validationResultSchema = z.object({
  result: z.enum(["approved", "rejected"]),
  notes: z.string().max(500).optional(),
});

const registerValidatorSchema = z.object({
  country_code: z.string().length(2).transform((s) => s.toUpperCase()),
});

const uploadUrlSchema = z.object({
  applicationId: z.string().uuid(),
  kind: z.enum(["id_front", "id_back", "selfie"]),
});

// ── Helpers ──────────────────────────────────────────────

function getUserId(req: AuthRequest): string {
  const userId = req.apiKey?.userId;
  if (!userId) throw new AppError("User-scoped API key required", 401);
  return userId;
}

// ── User Endpoints ───────────────────────────────────────

export async function postCreateApplication(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getUserId(req);
    const body = createApplicationSchema.parse(req.body);
    const app = await kycService.createApplication(
      userId,
      body.country_code,
      body.fee_tx_hash,
      body.mint_transaction_id
    );
    res.status(201).json({
      application_id: app.id,
      status: app.status,
      country_code: app.countryCode,
      fee_paid_acbu: app.feePaidAcbu.toString(),
      created_at: app.createdAt.toISOString(),
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return next(
        new AppError(
          e.errors.map((x) => `${x.path.join(".")}: ${x.message}`).join("; "),
          400
        )
      );
    }
    next(e);
  }
}

export async function getMyApplications(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getUserId(req);
    const applications = await kycService.getApplications(userId);
    res.json({ applications });
  } catch (e) {
    next(e);
  }
}

export async function getApplicationById(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getUserId(req);
    const application = await kycService.getApplication(
      userId,
      req.params.id
    );
    res.json(application);
  } catch (e) {
    next(e);
  }
}

export async function patchDocuments(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getUserId(req);
    const body = attachDocumentsSchema.parse(req.body);
    const application = await kycService.attachDocuments(
      userId,
      req.params.id,
      body.documents
    );

    // Trigger machine review in background
    kycService
      .processMachineReview(req.params.id)
      .then(() =>
        logger.info(
          `Background machine review completed for ${req.params.id}`
        )
      )
      .catch((err) =>
        logger.error(
          `Background machine review failed for ${req.params.id}`,
          err
        )
      );

    res.json(application);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return next(
        new AppError(
          e.errors.map((x) => `${x.path.join(".")}: ${x.message}`).join("; "),
          400
        )
      );
    }
    next(e);
  }
}

export async function getUploadUrl(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getUserId(req);
    const { applicationId, kind } = uploadUrlSchema.parse(req.query);

    // Verify the application belongs to this user
    await kycService.getApplication(userId, applicationId);

    // Generate a unique storage reference (in production: S3 pre-signed URL)
    const storageRef = `kyc/${applicationId}/${kind}/${Date.now()}`;

    res.json({
      upload_url: storageRef,
      storage_ref: storageRef,
      kind,
      application_id: applicationId,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return next(
        new AppError(
          e.errors.map((x) => `${x.path.join(".")}: ${x.message}`).join("; "),
          400
        )
      );
    }
    next(e);
  }
}

// ── Validator Endpoints ──────────────────────────────────

export async function postRegisterValidator(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getUserId(req);
    const body = registerValidatorSchema.parse(req.body);
    const validator = await kycService.registerValidator(
      userId,
      body.country_code
    );
    res.status(201).json({
      validator_id: validator.id,
      country_code: validator.countryCode,
      status: validator.status,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return next(
        new AppError(
          e.errors.map((x) => `${x.path.join(".")}: ${x.message}`).join("; "),
          400
        )
      );
    }
    next(e);
  }
}

export async function getMyValidatorTasks(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getUserId(req);

    // Find all validators for this user
    const validators = await kycService.getValidatorMe(userId);
    const allTasks: unknown[] = [];

    for (const v of validators) {
      const tasks = await kycService.getValidatorTasks(v.id);
      allTasks.push(...tasks.map((t: unknown) => ({ ...(t as Record<string, unknown>), validator_id: v.id })));
    }

    res.json({ tasks: allTasks });
  } catch (e) {
    next(e);
  }
}

export async function postValidatorResult(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getUserId(req);
    const body = validationResultSchema.parse(req.body);
    const applicationId = req.params.taskId;

    const validator = await kycService.ensureValidator(userId);
    if (!validator) throw new AppError("Not registered as a validator", 403);

    const validation = await kycService.submitValidation(
      validator.id,
      applicationId,
      body.result,
      body.notes
    );

    res.json({
      validation_id: (validation as any).id,
      result: (validation as any).result,
      application_id: applicationId,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return next(
        new AppError(
          e.errors.map((x) => `${x.path.join(".")}: ${x.message}`).join("; "),
          400
        )
      );
    }
    next(e);
  }
}

export async function getValidatorMe(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getUserId(req);
    const validators = await kycService.getValidatorMe(userId);
    res.json({ validators });
  } catch (e) {
    next(e);
  }
}

export async function getValidatorDashboard(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getUserId(req);
    const dashboard = await kycService.getRedactedTasks(userId);
    res.json(dashboard);
  } catch (e) {
    next(e);
  }
}
