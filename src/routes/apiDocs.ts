import path from "path";
import express, { Request, Response, NextFunction, Router } from "express";
import swaggerUi from "swagger-ui-express";
import { NO_CACHE, cacheNoCache } from "../middleware/cacheHeaders";

/**
 * API documentation router with explicit Cache-Control policy (W11-AUD-024).
 *
 * - Versioned static assets (`<mount>/assets/<swagger-ui-dist version>/…`) are
 *   served with `public, max-age=31536000, immutable`. The version segment
 *   changes whenever swagger-ui-dist is upgraded, so browsers never keep a
 *   stale bundle and never re-download an unchanged one.
 * - Dynamic documentation (the HTML page, `swagger-ui-init.js` which embeds the
 *   generated spec, and any unversioned legacy asset URL) is served with
 *   `no-cache`, so the browser always revalidates (ETag / Last-Modified) and
 *   picks up spec changes immediately.
 */

// swagger-ui-dist is a dependency of swagger-ui-express, not of this package,
// so resolve it relative to swagger-ui-express (required under pnpm's strict
// node_modules layout).
const swaggerUiExpressDir = path.dirname(require.resolve("swagger-ui-express"));

function resolveSwaggerUiDist(): { distPath: string; version: string } {
  const pkgJsonPath = require.resolve("swagger-ui-dist/package.json", {
    paths: [swaggerUiExpressDir],
  });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { version } = require(pkgJsonPath) as { version: string };
  return { distPath: path.dirname(pkgJsonPath), version };
}

/** Never expose swagger-ui-dist's package.json (mirrors swagger-ui-express). */
function blockPackageJson(req: Request, res: Response, next: NextFunction): void {
  if (req.path.endsWith("/package.json")) {
    res.sendStatus(404);
    return;
  }
  next();
}

export function createApiDocsRouter(spec: object, mountPath = "/api-docs"): Router {
  const router = Router();
  const { distPath, version } = resolveSwaggerUiDist();
  const assetBase = `${mountPath}/assets/${version}`;

  // Rewrite the relative asset references in the generated page to absolute,
  // versioned URLs. Absolute URLs also make the page work whether it is
  // requested as `/api-docs` or `/api-docs/`.
  const html = swaggerUi
    .generateHTML(spec)
    .replace(/(href|src)="\.\/swagger-ui-init\.js"/g, `$1="${mountPath}/swagger-ui-init.js"`)
    .replace(/(href|src)="\.\//g, `$1="${assetBase}/`);

  const [initScript] = swaggerUi.serveFiles(spec) as unknown as express.RequestHandler[];

  router.use(blockPackageJson);

  router.get("/", cacheNoCache, (_req, res) => {
    res.type("html").send(html);
  });

  router.get("/swagger-ui-init.js", cacheNoCache, initScript);

  router.use(
    `/assets/${version}`,
    express.static(distPath, {
      index: false,
      etag: true,
      lastModified: true,
      maxAge: "1y",
      immutable: true,
      fallthrough: false,
    }),
  );

  // Backwards compatibility for unversioned asset URLs: always revalidate.
  router.use(
    express.static(distPath, {
      index: false,
      etag: true,
      lastModified: true,
      setHeaders: (res) => res.setHeader("Cache-Control", NO_CACHE),
    }),
  );

  return router;
}
