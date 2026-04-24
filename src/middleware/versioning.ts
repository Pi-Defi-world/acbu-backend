import { Request, Response, NextFunction } from "express";
import { config } from "../config/env";

// Versions that have been sunset. Map version string → ISO 8601 sunset date.
const SUNSET_DATES: Record<string, string> = {};

// Versions that are deprecated but not yet sunset. Map version string → ISO 8601 deprecation date.
const DEPRECATION_DATES: Record<string, string> = {};

export function versioningMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const currentVersion = config.apiVersion;

  // Always advertise the current API version so clients can track it.
  res.setHeader("X-API-Version", currentVersion);

  // Detect the version being requested from the URL path (e.g. /api/v1/... → "v1").
  const match = /\/api\/(v\d+)\//.exec(req.path);
  const requestedVersion = match?.[1];

  if (requestedVersion && requestedVersion !== currentVersion) {
    const sunsetDate = SUNSET_DATES[requestedVersion];
    const deprecationDate = DEPRECATION_DATES[requestedVersion];

    if (sunsetDate) {
      res.setHeader("Sunset", sunsetDate);
      res.setHeader(
        "Warning",
        `299 - "API version ${requestedVersion} has been sunset as of ${sunsetDate}. Migrate to ${currentVersion}."`,
      );
    } else if (deprecationDate) {
      res.setHeader("Deprecation", deprecationDate);
      res.setHeader(
        "Warning",
        `299 - "API version ${requestedVersion} is deprecated since ${deprecationDate}. Please migrate to ${currentVersion}."`,
      );
    }
  }

  next();
}
