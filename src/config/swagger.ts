import fs from "fs";
import path from "path";

/**
 * Swagger / OpenAPI spec configuration.
 *
 * The committed swagger.json file is generated from src/openapi/route-definitions.ts
 * and the standalone Zod route schemas. Loading that generated artifact at runtime
 * keeps Swagger UI, /api-docs.json, and the checked-in contract in sync.
 *
 * Security (#274): the /api-docs UI is only mounted when NODE_ENV !== "production"
 * (enforced in src/index.ts), so this module does not expose the spec publicly in
 * production deployments.
 */

type SwaggerSpec = Record<string, unknown>;

const specCandidates = [
  process.env.SWAGGER_SPEC_PATH,
  path.resolve(process.cwd(), "swagger.json"),
  path.resolve(__dirname, "../../swagger.json"),
  path.resolve(__dirname, "../../../swagger.json"),
].filter((candidate): candidate is string => Boolean(candidate));

function loadGeneratedSpec(): SwaggerSpec | undefined {
  for (const candidate of [...new Set(specCandidates)]) {
    if (!fs.existsSync(candidate)) continue;
    try {
      return JSON.parse(fs.readFileSync(candidate, "utf8")) as SwaggerSpec;
    } catch (error) {
      console.warn(`[swagger] Failed to load generated spec at ${candidate}`, error);
    }
  }
  return undefined;
}

const port = Number(process.env.PORT) || 5000;
const generatedSpec = loadGeneratedSpec();

export const swaggerSpec: SwaggerSpec = generatedSpec ?? {
  openapi: "3.0.0",
  info: {
    title: "ACBU API",
    version: "1.0.0",
    description: "API documentation for ACBU (African Currency Basket Unit) platform",
  },
  paths: {},
};

swaggerSpec.servers = [
  {
    url: `http://localhost:${port}/api`,
    description: "Development server (the API is mounted under /api)",
  },
];
