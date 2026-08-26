import { Response, NextFunction } from "express";
import { z } from "zod";
import bcrypt from "bcrypt";
import { AuthRequest } from "../middleware/auth";
import { prisma } from "../config/database";
import { AppError } from "../middleware/errorHandler";
import { tombstoneDeleteUser } from "../services/user";

/** Normalize username: lowercase, no spaces. */
function normalizeUsername(s: string): string {
  return s.trim().toLowerCase().replace(/\s/g, "");
}

export const patchMeSchema = z.object({
  username: z.string().min(1).max(64).transform(normalizeUsername).optional(),
  email: z
    .string()
    .email()
    .max(255)
    .transform((s) => s.trim().toLowerCase())
    .optional()
    .nullable(),
  phone_e164: z
    .string()
    .regex(/^\+[0-9]{10,15}$/, "Must be E.164 (e.g. +2348012345678)")
    .optional()
    .nullable(),
  privacy_hide_from_search: z.boolean().optional(),
  passcode: z.string().min(8).max(64).optional(), // set or update passcode for Tier-1 recovery
});

/**
 * GET /users/me
 * Current user profile. No stellarAddress in response.
 */
export async function getMe(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) {
      throw new AppError("User-scoped API key required", 401);
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        phoneE164: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        privacyHideFromSearch: true,
        kycStatus: true,
        countryCode: true,
        createdAt: true,
      },
    });
    if (!user) {
      throw new AppError("User not found", 404);
    }
    res.json({
      user_id: user.id,
      username: user.username ?? undefined,
      email: user.email ?? undefined,
      phone_e164: user.phoneE164 ?? undefined,
      email_verified_at: user.emailVerifiedAt?.toISOString() ?? undefined,
      phone_verified_at: user.phoneVerifiedAt?.toISOString() ?? undefined,
      privacy_hide_from_search: user.privacyHideFromSearch,
      kyc_status: user.kycStatus,
      country_code: user.countryCode ?? undefined,
      created_at: user.createdAt.toISOString(),
    });
  } catch (e) {
    next(e);
  }
}

/**
 * PATCH /users/me
 * Update username, email, phone_e164, privacy_hide_from_search.
 */
export async function patchMe(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) {
      throw new AppError("User-scoped API key required", 401);
    }
    const body = patchMeSchema.parse(req.body);
    const data: {
      username?: string;
      email?: string | null;
      phoneE164?: string | null;
      privacyHideFromSearch?: boolean;
      passcodeHash?: string | null;
    } = {};
    if (body.username !== undefined) data.username = body.username;
    if (body.email !== undefined) data.email = body.email;
    if (body.phone_e164 !== undefined) data.phoneE164 = body.phone_e164;
    if (body.privacy_hide_from_search !== undefined)
      data.privacyHideFromSearch = body.privacy_hide_from_search;
    if (body.passcode !== undefined) data.passcodeHash = await bcrypt.hash(body.passcode, 10);

    const user = await prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        username: true,
        email: true,
        phoneE164: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        privacyHideFromSearch: true,
        kycStatus: true,
        countryCode: true,
        createdAt: true,
      },
    });
    res.json({
      user_id: user.id,
      username: user.username ?? undefined,
      email: user.email ?? undefined,
      phone_e164: user.phoneE164 ?? undefined,
      email_verified_at: user.emailVerifiedAt?.toISOString() ?? undefined,
      phone_verified_at: user.phoneVerifiedAt?.toISOString() ?? undefined,
      privacy_hide_from_search: user.privacyHideFromSearch,
      kyc_status: user.kycStatus,
      country_code: user.countryCode ?? undefined,
      created_at: user.createdAt.toISOString(),
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg = e.errors.map((x) => x.message).join("; ");
      return next(new AppError(msg, 400));
    }
    next(e);
  }
}

export const addContactSchema = z.object({
  contact_user_id: z.string().uuid(),
});

/**
 * POST /users/me/contacts
 * Add a contact (allowed senders when privacy_hide_from_search is true).
 */
export async function postContacts(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) throw new AppError("User-scoped API key required", 401);
    const body = addContactSchema.parse(req.body);
    if (body.contact_user_id === userId) {
      throw new AppError("Cannot add self as contact", 400);
    }
    const contact = await prisma.userContact.upsert({
      where: {
        userId_contactUserId: { userId, contactUserId: body.contact_user_id },
      },
      create: {
        userId,
        contactUserId: body.contact_user_id,
      },
      update: {},
      select: { id: true, contactUserId: true, createdAt: true },
    });
    res.status(201).json({
      contact_id: contact.id,
      contact_user_id: contact.contactUserId,
      created_at: contact.createdAt.toISOString(),
    });
  } catch (e) {
    if (e instanceof z.ZodError)
      return next(new AppError(e.errors.map((x) => x.message).join("; "), 400));
    next(e);
  }
}

/**
 * GET /users/me/contacts
 * List current user's contacts.
 */
export async function getContacts(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) throw new AppError("User-scoped API key required", 401);
    const contacts = await prisma.userContact.findMany({
      where: { userId, contactUserId: { not: null } },
      select: {
        id: true,
        contactUserId: true,
        contactUser: { select: { username: true } },
        createdAt: true,
      },
    });
    res.json({
      contacts: contacts.map((c: (typeof contacts)[number]) => ({
        contact_id: c.id,
        contact_user_id: c.contactUserId,
        username: c.contactUser?.username ?? undefined,
        created_at: c.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    next(e);
  }
}

/**
 * DELETE /users/me/contacts/:id
 * Remove a contact.
 */
export async function deleteContact(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) throw new AppError("User-scoped API key required", 401);
    const { id } = req.params;
    const contact = await prisma.userContact.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!contact) throw new AppError("Contact not found", 404);
    await prisma.userContact.delete({ where: { id: contact.id } });
    res.status(204).send();
  } catch (e) {
    next(e);
  }
}

export const addGuardianSchema = z
  .object({
    guardian_user_id: z.string().uuid().optional(),
    guardian_email: z.string().email().max(255).optional(),
    guardian_phone: z
      .string()
      .regex(/^\+[0-9]{10,15}$/, "Must be E.164")
      .optional(),
  })
  .refine((d) => d.guardian_user_id ?? d.guardian_email ?? d.guardian_phone, {
    message: "Provide at least one of guardian_user_id, guardian_email, guardian_phone",
  });

/**
 * POST /users/me/guardians
 * Add a guardian (for Tier-2 recovery: 2-of-N must approve).
 */
export async function postGuardians(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) throw new AppError("User-scoped API key required", 401);
    const body = addGuardianSchema.parse(req.body);
    const orConditions: {
      guardianUserId?: string;
      guardianEmail?: string;
      guardianPhone?: string;
    }[] = [];
    if (body.guardian_user_id) orConditions.push({ guardianUserId: body.guardian_user_id });
    if (body.guardian_email)
      orConditions.push({
        guardianEmail: body.guardian_email.trim().toLowerCase(),
      });
    if (body.guardian_phone) orConditions.push({ guardianPhone: body.guardian_phone });
    const existing = await prisma.guardian.findFirst({
      where: { userId, OR: orConditions },
      select: { id: true },
    });
    if (existing) throw new AppError("Guardian already added", 409);
    const guardian = await prisma.guardian.create({
      data: {
        userId,
        guardianUserId: body.guardian_user_id ?? undefined,
        guardianEmail: body.guardian_email?.trim().toLowerCase() ?? undefined,
        guardianPhone: body.guardian_phone ?? undefined,
        status: "pending",
      },
      select: {
        id: true,
        guardianUserId: true,
        guardianEmail: true,
        guardianPhone: true,
        status: true,
        invitedAt: true,
      },
    });
    res.status(201).json({
      guardian_id: guardian.id,
      guardian_user_id: guardian.guardianUserId ?? undefined,
      guardian_email: guardian.guardianEmail ?? undefined,
      guardian_phone: guardian.guardianPhone ?? undefined,
      status: guardian.status,
      invited_at: guardian.invitedAt.toISOString(),
    });
  } catch (e) {
    if (e instanceof z.ZodError)
      return next(new AppError(e.errors.map((x) => x.message).join("; "), 400));
    next(e);
  }
}

/**
 * GET /users/me/guardians
 * List current user's guardians.
 */
export async function getGuardians(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) throw new AppError("User-scoped API key required", 401);
    const guardians = await prisma.guardian.findMany({
      where: { userId },
      select: {
        id: true,
        guardianUserId: true,
        guardianEmail: true,
        guardianPhone: true,
        status: true,
        order: true,
        invitedAt: true,
        approvedAt: true,
      },
      orderBy: [{ order: "asc" }, { invitedAt: "asc" }],
    });
    res.json({
      guardians: guardians.map((g: (typeof guardians)[number]) => ({
        guardian_id: g.id,
        guardian_user_id: g.guardianUserId ?? undefined,
        guardian_email: g.guardianEmail ?? undefined,
        guardian_phone: g.guardianPhone ?? undefined,
        status: g.status,
        order: g.order,
        invited_at: g.invitedAt.toISOString(),
        approved_at: g.approvedAt?.toISOString() ?? undefined,
      })),
    });
  } catch (e) {
    next(e);
  }
}

/**
 * DELETE /users/me/guardians/:id
 * Remove a guardian.
 */
export async function deleteGuardian(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) throw new AppError("User-scoped API key required", 401);
    const { id } = req.params;
    const guardian = await prisma.guardian.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!guardian) throw new AppError("Guardian not found", 404);
    await prisma.guardian.delete({ where: { id: guardian.id } });
    res.status(204).send();
  } catch (e) {
    next(e);
  }
}

/**
 * DELETE /users/me
 * Delete account: performs a tombstone delete for GDPR compliance.
 */
export async function deleteMe(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) throw new AppError("User-scoped API key required", 401);

    await tombstoneDeleteUser(userId, "deleteMe");

    res.status(204).send();
  } catch (e) {
    next(e);
  }
}

/**
 * GET /users/me/receive
 * Returns alias and pay_uri for the current user (e.g. acbu:@username).
 */
export async function getReceive(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) throw new AppError("User-scoped API key required", 401);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, phoneE164: true, email: true },
    });
    if (!user) throw new AppError("User not found", 404);
    const alias = user.username
      ? `@${user.username}`
      : (user.phoneE164 ?? user.email ?? userId.slice(0, 8));
    const pay_uri = `acbu:${alias}`;
    res.json({ alias, pay_uri });
  } catch (e) {
    next(e);
  }
}

/**
 * GET /users/me/receive/qrcode
 * Returns QR code as data URL for pay_uri.
 */
export async function getReceiveQrcode(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) throw new AppError("User-scoped API key required", 401);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, phoneE164: true, email: true },
    });
    if (!user) throw new AppError("User not found", 404);
    const alias = user.username
      ? `@${user.username}`
      : (user.phoneE164 ?? user.email ?? userId.slice(0, 8));
    const pay_uri = `acbu:${alias}`;
    const QRCode = await import("qrcode");
    const qr_data_url = await QRCode.toDataURL(pay_uri, {
      type: "image/png",
      margin: 2,
    });
    res.json({ pay_uri, qr_data_url });
  } catch (e) {
    next(e);
  }
}
