import { AppError } from "../middleware/errorHandler";

// ─── Generic HTTP error classes ──────────────────────────────────────────

export class ConflictError extends AppError {
  constructor(message = "Resource conflict") {
    super(message, 409, "CONFLICT");
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(message, 404, "NOT_FOUND");
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed") {
    super(message, 400, "VALIDATION_ERROR");
  }
}

export class AuthenticationError extends AppError {
  constructor(message = "Authentication failed", code = "AUTHENTICATION_ERROR") {
    super(message, 401, code);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Access denied", code = "FORBIDDEN") {
    super(message, 403, code);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = "Service unavailable", code = "SERVICE_UNAVAILABLE") {
    super(message, 503, code);
  }
}

// ─── Auth-specific errors ───────────────────────────────────────────────

export class UsernameTakenError extends ConflictError {
  constructor() {
    super("Username already taken");
  }
}

export class InvalidCredentialsError extends AuthenticationError {
  constructor() {
    super("Invalid credentials", "INVALID_CREDENTIALS");
  }
}

export class TooManyAttemptsError extends ForbiddenError {
  constructor() {
    super("Too many attempts. Please try again later.", "TOO_MANY_ATTEMPTS");
  }
}

export class CaptchaRequiredError extends ForbiddenError {
  constructor() {
    super("CAPTCHA required", "CAPTCHA_REQUIRED");
  }
}

export class TwoFactorChannelNotConfiguredError extends ValidationError {
  constructor() {
    super("2FA channel not configured");
  }
}

export class OtpDeliveryUnavailableError extends ServiceUnavailableError {
  constructor() {
    super("OTP delivery unavailable");
  }
}

export class InvalidOrExpiredChallengeError extends AuthenticationError {
  constructor() {
    super("Invalid or expired challenge", "INVALID_OR_EXPIRED_CHALLENGE");
  }
}

export class InvalidCodeError extends AuthenticationError {
  constructor() {
    super("Invalid code", "INVALID_CODE");
  }
}

export class InvalidOrExpiredCodeError extends AuthenticationError {
  constructor() {
    super("Invalid or expired code", "INVALID_OR_EXPIRED_CODE");
  }
}

export class TotpNotConfiguredError extends ValidationError {
  constructor() {
    super("TOTP not configured");
  }
}

export class UnsupportedTwoFactorMethodError extends ValidationError {
  constructor() {
    super("Unsupported 2FA method");
  }
}

export class AdminTierAccessRequiredError extends ForbiddenError {
  constructor() {
    super("Admin-tier access required", "ADMIN_TIER_REQUIRED");
  }
}

export class OrganizationContextRequiredError extends ForbiddenError {
  constructor() {
    super("Organization context required for admin-tier users", "ORGANIZATION_CONTEXT_REQUIRED");
  }
}

export class TwoFactorRequiredForAdminError extends ForbiddenError {
  constructor() {
    super("2FA required for admin-tier users", "2FA_REQUIRED_FOR_ADMIN");
  }
}

export class ReasonRequiredError extends ValidationError {
  constructor() {
    super("Reason is required");
  }
}

export class AdminScopeRequiredError extends ValidationError {
  constructor() {
    super("At least one admin scope is required");
  }
}

export class BreakGlassTtlError extends ValidationError {
  constructor() {
    super("Break-glass TTL must be between 1 and 60 minutes");
  }
}

export class PrivilegedKeyNotFoundError extends NotFoundError {
  constructor() {
    super("Privileged key not found");
  }
}

export class InvalidOrExpiredRefreshTokenError extends AuthenticationError {
  constructor() {
    super("Invalid or expired refresh token", "INVALID_REFRESH_TOKEN");
  }
}

export class InvalidRefreshTokenError extends AuthenticationError {
  constructor() {
    super("Invalid refresh token", "INVALID_REFRESH_TOKEN");
  }
}

// ─── Fiat-specific errors ───────────────────────────────────────────────

export class InvalidCurrencyError extends ValidationError {
  constructor(currency?: string) {
    super(currency ? `Invalid currency: ${currency}` : "Invalid currency");
  }
}

export class TrustlineMissingError extends ValidationError {
  constructor(message = "Trustline missing") {
    super(message);
  }
}

export class NonExistentContractFunctionError extends ServiceUnavailableError {
  constructor() {
    super("Non-existent contract function");
  }
}

export class InvalidMintAmountError extends ValidationError {
  constructor(message = "Invalid mint amount") {
    super(message);
  }
}

export class InvalidCurrencyForOnRampError extends ValidationError {
  constructor() {
    super("Invalid currency for on-ramp.");
  }
}
