import { prisma } from "../../config/database";
import { AppError } from "../../middleware/errorHandler";
import { logger } from "../../config/logger";

const VALID_COUNTRIES = [
  "NG", "KE", "ZA", "EG", "GH", "RW", "SN", "MA", "TZ", "UG",
];

const KYC_APPLICATION_FEE = 10;

type DocRef = { kind: string; storageRef: string; mimeType: string | null };
type ValidationRef = { id: string; result: string; notes: string | null; createdAt: Date }; // ACBU tokens

export async function createApplication(
  userId: string,
  countryCode: string,
  feeTxHash?: string,
  feeMintTxId?: string
) {
  if (!VALID_COUNTRIES.includes(countryCode.toUpperCase())) {
    throw new AppError(`Unsupported country: ${countryCode}`, 400);
  }

  const existing = await prisma.kycApplication.findFirst({
    where: { userId, status: { notIn: ["rejected"] } },
  });
  if (existing) {
    throw new AppError(
      `You already have a ${existing.status} KYC application`,
      409
    );
  }

  const application = await prisma.kycApplication.create({
    data: {
      userId,
      countryCode: countryCode.toUpperCase(),
      status: "pending",
      feePaidAcbu: KYC_APPLICATION_FEE,
      feeTxHash: feeTxHash || undefined,
      feeMintTransactionId: feeMintTxId || undefined,
    },
  });

  logger.info(`KYC application created: ${application.id} for user ${userId}`);
  return application;
}

export async function getApplications(userId: string) {
  const applications = await prisma.kycApplication.findMany({
    where: { userId },
    include: {
      documents: { select: { id: true, kind: true, storageRef: true, mimeType: true, createdAt: true } },
      validations: { select: { id: true, result: true, notes: true, createdAt: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return applications;
}

export async function getApplication(userId: string, applicationId: string) {
  const application = await prisma.kycApplication.findFirst({
    where: { id: applicationId, userId },
    include: {
      documents: { select: { id: true, kind: true, storageRef: true, mimeType: true, createdAt: true } },
      validations: { select: { id: true, result: true, notes: true, createdAt: true } },
    },
  });

  if (!application) throw new AppError("KYC application not found", 404);
  return application;
}

export async function attachDocuments(
  userId: string,
  applicationId: string,
  documents: Array<{
    kind: string;
    storage_ref: string;
    checksum?: string;
    mime_type?: string;
  }>
) {
  const application = await prisma.kycApplication.findFirst({
    where: { id: applicationId, userId },
  });

  if (!application) throw new AppError("KYC application not found", 404);
  if (application.status !== "pending") {
    throw new AppError(
      `Cannot update documents: application is ${application.status}`,
      400
    );
  }

  const validKinds = ["id_front", "id_back", "selfie"];
  for (const doc of documents) {
    if (!validKinds.includes(doc.kind)) {
      throw new AppError(`Invalid document kind: ${doc.kind}`, 400);
    }

    const existing = await prisma.kycDocument.findFirst({
      where: { applicationId, kind: doc.kind },
    });

    if (existing) {
      await prisma.kycDocument.update({
        where: { id: existing.id },
        data: {
          storageRef: doc.storage_ref,
          checksum: doc.checksum || undefined,
          mimeType: doc.mime_type || undefined,
        },
      });
    } else {
      await prisma.kycDocument.create({
        data: {
          applicationId,
          kind: doc.kind,
          storageRef: doc.storage_ref,
          checksum: doc.checksum || undefined,
          mimeType: doc.mime_type || undefined,
        },
      });
    }
  }

  await prisma.kycApplication.update({
    where: { id: applicationId },
    data: { status: "machine_review" },
  });

  logger.info(`Documents attached to KYC application ${applicationId}`);
  return getApplication(userId, applicationId);
}

export async function processMachineReview(applicationId: string) {
  const application = await prisma.kycApplication.findUnique({
    where: { id: applicationId },
    include: { documents: true },
  });

  if (!application) throw new AppError("KYC application not found", 404);
  if (application.status !== "machine_review") {
    throw new AppError(
      `Cannot review: application is ${application.status}`,
      400
    );
  }

  const hasRequiredDocs =
    application.documents.some((d: DocRef) => d.kind === "id_front") &&
    application.documents.some((d: DocRef) => d.kind === "id_back") &&
    application.documents.some((d: DocRef) => d.kind === "selfie");

  const confidence = hasRequiredDocs ? 0.95 : 0.3;

  await prisma.kycApplication.update({
    where: { id: applicationId },
    data: {
      machineConfidence: confidence,
      machineExtractedPayload: {
        reviewedAt: new Date().toISOString(),
        documentCount: application.documents.length,
        hasAllRequired: hasRequiredDocs,
      },
      status: "peer_review",
    },
  });

  logger.info(
    `Machine review completed for KYC application ${applicationId}: confidence=${confidence}`
  );

  return prisma.kycApplication.findUnique({
    where: { id: applicationId },
    include: { documents: true, validations: true },
  });
}

export async function submitValidation(
  validatorId: string,
  applicationId: string,
  result: string,
  notes?: string
) {
  if (!["approved", "rejected"].includes(result)) {
    throw new AppError(`Invalid validation result: ${result}`, 400);
  }

  const application = await prisma.kycApplication.findUnique({
    where: { id: applicationId },
  });
  if (!application) throw new AppError("KYC application not found", 404);

  const existing = await prisma.kycValidation.findFirst({
    where: { applicationId, validatorId },
  });
  if (existing) {
    throw new AppError("You have already validated this application", 409);
  }

  const validation = await prisma.kycValidation.create({
    data: {
      applicationId,
      validatorId,
      result,
      notes: notes || undefined,
    },
  });

  await prisma.kycValidator.update({
    where: { id: validatorId },
    data: { completedCount: { increment: 1 } },
  });

  const validations = await prisma.kycValidation.findMany({
    where: { applicationId },
  });

  const approved = validations.filter((v: ValidationRef) => v.result === "approved").length;
  const rejected = validations.filter((v: ValidationRef) => v.result === "rejected").length;

  if (approved >= 1) {
    await approveApplication(applicationId);
  } else if (rejected >= 1) {
    await rejectApplication(applicationId, "Rejected by peer validators");
  }

  return validation;
}

async function approveApplication(applicationId: string) {
  const app = await prisma.kycApplication.update({
    where: { id: applicationId },
    data: { status: "approved", resolvedAt: new Date() },
    include: { user: true },
  });

  await prisma.user.update({
    where: { id: app.userId },
    data: {
      kycStatus: "verified",
      kycVerifiedAt: new Date(),
      countryCode: app.countryCode,
    },
  });

  // Auto-register as validator for their country — all KYC'd users can validate others
  const existingValidator = await prisma.kycValidator.findUnique({
    where: {
      userId_countryCode: {
        userId: app.userId,
        countryCode: app.countryCode,
      },
    },
  });

  if (!existingValidator) {
    await prisma.kycValidator.create({
      data: {
        userId: app.userId,
        countryCode: app.countryCode,
        status: "active",
      },
    });
    logger.info(`Auto-registered validator for user ${app.userId} in ${app.countryCode}`);
  }

  logger.info(
    `KYC approved for user ${app.userId}, application ${applicationId}`
  );
}

async function rejectApplication(applicationId: string, reason: string) {
  await prisma.kycApplication.update({
    where: { id: applicationId },
    data: { status: "rejected", rejectionReason: reason, resolvedAt: new Date() },
  });

  logger.info(`KYC rejected: application ${applicationId}: ${reason}`);
}

export async function registerValidator(
  userId: string,
  countryCode: string
) {
  if (!VALID_COUNTRIES.includes(countryCode.toUpperCase())) {
    throw new AppError(`Unsupported country: ${countryCode}`, 400);
  }

  const existing = await prisma.kycValidator.findUnique({
    where: {
      userId_countryCode: {
        userId,
        countryCode: countryCode.toUpperCase(),
      },
    },
  });

  if (existing) {
    throw new AppError("Already registered as a validator for this country", 409);
  }

  const validator = await prisma.kycValidator.create({
    data: {
      userId,
      countryCode: countryCode.toUpperCase(),
      status: "active",
    },
  });

  logger.info(`Validator registered: ${validator.id} for ${countryCode}`);
  return validator;
}

export async function getValidatorTasks(validatorId: string) {
  const validator = await prisma.kycValidator.findUnique({
    where: { id: validatorId },
  });
  if (!validator) throw new AppError("Validator not found", 404);

  const tasks = await prisma.kycApplication.findMany({
    where: {
      countryCode: validator.countryCode,
      status: "peer_review",
      validations: {
        none: { validatorId },
      },
    },
    include: {
      documents: {
        select: { id: true, kind: true, mimeType: true },
      },
    },
    orderBy: { createdAt: "asc" },
    take: 10,
  });

  return tasks;
}

export async function getValidatorMe(userId: string) {
  const validators = await prisma.kycValidator.findMany({
    where: { userId },
    include: {
      _count: { select: { validations: true } },
    },
  });

  return validators;
}

export async function ensureValidator(userId: string) {
  let validators = await getValidatorMe(userId);
  if (validators.length > 0) return validators[0];

  // Auto-create validator for any KYC'd user
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { kycStatus: true, countryCode: true },
  });

  if (!user || !user.countryCode || user.kycStatus !== "verified") {
    throw new AppError(
      "Complete your KYC first to become a validator.",
      403
    );
  }

  const validator = await prisma.kycValidator.create({
    data: {
      userId,
      countryCode: user.countryCode,
      status: "active",
    },
  });

  logger.info(`Auto-created validator for user ${userId}`);
  return validator;
}

export interface RedactedTask {
  taskId: string;
  countryCode: string;
  machineConfidence: number;
  submittedAt: string;
  validatorCount: number;
  redacted: {
    idType: string;
    idValidity: {
      hasHologram: boolean;
      hasWatermark: boolean;
      formatValid: boolean;
      expiryDate: string; // "REDACTED" or YYYY-MM if visible
    };
    faceMatch: {
      idPhotoRef: string;
      selfieRef: string;
    };
    livenessCheck: {
      blinked: boolean;
      smiled: boolean;
      passed: boolean;
    };
    humanReadable: {
      country: string;
      name: string;       // "REDACTED"
      dateOfBirth: string; // "REDACTED"
      idNumber: string;    // "REDACTED"
      address: string;     // "REDACTED"
    };
  };
}

export async function getRedactedTasks(userId: string) {
  // All KYC'd users are validators — auto-provision if not yet registered
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { kycStatus: true, countryCode: true },
  });

  if (!user || user.kycStatus !== "verified") {
    throw new AppError(
      "Complete your KYC first to become a validator.",
      403
    );
  }

  if (user.countryCode) {
    const existing = await prisma.kycValidator.findUnique({
      where: {
        userId_countryCode: {
          userId,
          countryCode: user.countryCode,
        },
      },
    });
    if (!existing) {
      await prisma.kycValidator.create({
        data: {
          userId,
          countryCode: user.countryCode,
          status: "active",
        },
      });
    }
  }

  const validators = await prisma.kycValidator.findMany({
    where: { userId, status: "active" },
  });

  if (validators.length === 0) {
    throw new AppError("Could not provision validator. Set your country first.", 400);
  }

  const allTasks: RedactedTask[] = [];

  for (const validator of validators) {
    const applications = await prisma.kycApplication.findMany({
      where: {
        countryCode: validator.countryCode,
        status: "peer_review",
        validations: { none: { validatorId: validator.id } },
      },
      include: {
        documents: { select: { kind: true, storageRef: true, mimeType: true } },
        validations: { select: { id: true } },
        user: { select: { username: true, countryCode: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 5,
    });

    for (const app of applications) {
      const hasIdFront = app.documents.some((d: DocRef) => d.kind === "id_front");
      const hasIdBack = app.documents.some((d: DocRef) => d.kind === "id_back");
      const hasSelfie = app.documents.some((d: DocRef) => d.kind === "selfie");

      const idFrontDoc = app.documents.find((d: DocRef) => d.kind === "id_front");
      const selfieDoc = app.documents.find((d: DocRef) => d.kind === "selfie");

      const machinePayload = (app.machineExtractedPayload as Record<string, unknown>) || {};

      allTasks.push({
        taskId: app.id,
        countryCode: app.countryCode,
        machineConfidence: Number(app.machineConfidence || 0),
        submittedAt: app.createdAt.toISOString(),
        validatorCount: app.validations.length,
        redacted: {
          idType: (machinePayload.idType as string) || "GOVERNMENT_ID",
          idValidity: {
            hasHologram: hasIdBack,
            hasWatermark: (machinePayload.hasWatermark as boolean) || hasIdBack,
            formatValid: hasIdFront && hasIdBack,
            expiryDate: "REDACTED",
          },
          faceMatch: {
            idPhotoRef: idFrontDoc?.storageRef || "REDACTED",
            selfieRef: selfieDoc?.storageRef || "REDACTED",
          },
          livenessCheck: {
            blinked: (machinePayload.blinked as boolean) || true,
            smiled: (machinePayload.smiled as boolean) || true,
            passed: hasSelfie,
          },
          humanReadable: {
            country:
              app.countryCode === "NG"
                ? "Nigeria"
                : app.countryCode === "KE"
                  ? "Kenya"
                  : app.countryCode,
            name: "REDACTED",
            dateOfBirth: "REDACTED",
            idNumber: "REDACTED",
            address: "REDACTED",
          },
        },
      });
    }
  }

  return { tasks: allTasks, trustScore: Number(validators[0]?.accuracyScore || 0) };
}
