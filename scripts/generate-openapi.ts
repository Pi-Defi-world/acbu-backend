import fs from "fs";
import path from "path";
import { zodToJsonSchema } from "zod-to-json-schema";
import { routeSchemas } from "../src/controllers/route-schemas";
import {
  getOpenApiRouteKey,
  openApiRoutes,
  type OpenApiRouteDefinition,
} from "../src/openapi/route-definitions";
import {
  normalizeSchemaConstraints,
  pathParameterNames,
  toOpenApiPath,
} from "../src/openapi/utils";

const outputPath = path.resolve(__dirname, "../swagger.json");
const checkOnly = process.argv.includes("--check");

const tagDescriptions: Record<string, string> = {
  Health: "Health, readiness, and operational metrics",
  Meta: "API metadata and version history",
  Authentication: "User authentication, sessions, and privileged key lifecycle",
  Reserves: "Reserve tracking and status",
  Recipient: "Recipient alias resolution",
  Transfers: "ACBU transfer operations",
  Transactions: "Transaction history and lookup",
  Users: "User profile and wallet management",
  Recovery: "Account recovery operations",
  Mint: "Asset minting and deposits",
  Burn: "Asset burning and redemptions",
  Rates: "ACBU exchange rates and quotes",
  P2P: "Person-to-person transfer operations",
  SME: "SME segment transfer and statement operations",
  International: "International segment rates, minting, and burning",
  Salary: "Salary disbursement and scheduling",
  Enterprise: "Enterprise bulk transfers and treasury views",
  Savings: "Savings vault operations",
  Lending: "Lending pool operations",
  Gateway: "Escrow gateway charge operations",
  Bills: "Bill payment and refund operations",
  Onramp: "Stellar USDC/XLM on-ramp registration",
  Retail: "Retail audience minting and burning",
  Business: "Business audience minting and burning",
  Government: "Government audience minting, burning, and treasury views",
  Investment: "Investment withdrawal management",
  Fiat: "Fiat currency operations",
  Config: "Public asset configuration",
  KYC: "KYC document and validator reward operations",
  Reports: "Statement and transaction exports",
  Compliance: "Data export and account deletion",
  Privacy: "Consent preference management",
  Admin: "Administrative operations",
  Webhooks: "Provider callback endpoints",
};

function zodSchemaToOpenApi(schema: unknown): Record<string, any> {
  const jsonSchema = zodToJsonSchema(schema as never, {
    target: "openApi3",
    effectStrategy: "input",
    $refStrategy: "none",
  }) as Record<string, any>;
  normalizeSchemaConstraints(jsonSchema);
  return jsonSchema;
}

function buildParameters(route: OpenApiRouteDefinition): Record<string, any>[] {
  const parameters: Record<string, any>[] = [];

  for (const name of pathParameterNames(route.path)) {
    parameters.push({
      name,
      in: "path",
      required: true,
      description: route.pathParameterDescriptions?.[name] ?? `${name} path parameter`,
      schema: { type: "string" },
    });
  }

  const schema = routeSchemas[getOpenApiRouteKey(route)];
  if (schema && route.method === "get" && pathParameterNames(route.path).length === 0) {
    const jsonSchema = zodSchemaToOpenApi(schema);
    const properties = (jsonSchema.properties ?? {}) as Record<string, any>;
    const required = new Set<string>((jsonSchema.required ?? []) as string[]);

    for (const [name, property] of Object.entries(properties)) {
      parameters.push({
        name,
        in: "query",
        required: required.has(name),
        description: property.description,
        schema: property,
      });
    }
  }

  for (const header of route.headers ?? []) {
    parameters.push({
      name: header.name,
      in: "header",
      required: header.required ?? false,
      description: header.description,
      schema: header.schema ?? { type: "string" },
    });
  }

  return parameters;
}

function buildRequestBody(route: OpenApiRouteDefinition): Record<string, any> | undefined {
  if (route.requestBody) {
    return {
      required: route.requestBody.required ?? false,
      content: route.requestBody.content,
    };
  }

  if (!["post", "put", "patch"].includes(route.method)) {
    return undefined;
  }

  const schema = routeSchemas[getOpenApiRouteKey(route)];
  if (!schema) {
    return undefined;
  }

  const jsonSchema = zodSchemaToOpenApi(schema);
  const hasProperties = Object.keys(jsonSchema.properties ?? {}).length > 0;
  if (!hasProperties) {
    return undefined;
  }

  return {
    required: true,
    content: {
      "application/json": {
        schema: jsonSchema,
      },
    },
  };
}

function buildSecurity(route: OpenApiRouteDefinition): Record<string, string[]>[] {
  switch (route.auth ?? "apiKey") {
    case "adminKey":
      return [{ AdminKeyAuth: [] }];
    case "none":
    case "optional":
      return [];
    case "apiKey":
    default:
      return [{ ApiKeyAuth: [] }];
  }
}

function buildOperation(route: OpenApiRouteDefinition): Record<string, any> {
  const status = route.successStatus ?? "200";
  const operation: Record<string, any> = {
    tags: [route.tag],
    summary: route.summary,
    operationId: `${route.method}_${route.path.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
    security: buildSecurity(route),
    responses: {
      [status]: {
        description: route.successDescription ?? "Successful response",
      },
    },
  };

  if (route.description) {
    operation.description = route.description;
  }

  const parameters = buildParameters(route);
  if (parameters.length > 0) {
    operation.parameters = parameters;
  }

  const requestBody = buildRequestBody(route);
  if (requestBody) {
    operation.requestBody = requestBody;
  }

  if ((route.auth ?? "apiKey") !== "none") {
    operation.responses["401"] = { description: "Authentication required" };
  }
  if (requestBody) {
    operation.responses["400"] = { description: "Invalid request" };
  }

  return operation;
}

function buildSpec(): Record<string, any> {
  const paths: Record<string, Record<string, any>> = {};
  const tags = new Map<string, string>();
  const seenRoutes = new Set<string>();

  for (const route of openApiRoutes) {
    const routeKey = getOpenApiRouteKey(route);
    if (seenRoutes.has(routeKey)) {
      throw new Error(`Duplicate route definition: ${routeKey}`);
    }
    seenRoutes.add(routeKey);

    tags.set(route.tag, tagDescriptions[route.tag] ?? `${route.tag} operations`);
    const openApiPath = toOpenApiPath(route.path);
    paths[openApiPath] ??= {};
    if (route.tag === "Webhooks") {
      paths[openApiPath].servers = [
        {
          url: "http://localhost:5000",
          description: "Webhook endpoint (mounted at the root, not under /api)",
        },
      ];
    }
    paths[openApiPath][route.method] = buildOperation(route);
  }

  return {
    openapi: "3.0.0",
    info: {
      title: "ACBU API",
      version: "1.0.0",
      description: "API documentation for ACBU (African Currency Basket Unit) platform",
      contact: {
        name: "ACBU Support",
      },
    },
    servers: [
      {
        url: "http://localhost:5000/api",
        description: "Development server (the API is mounted under /api)",
      },
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "X-API-Key",
        },
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
        AdminKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "X-Admin-Key",
        },
      },
    },
    security: [{ ApiKeyAuth: [] }],
    tags: [...tags.entries()].map(([name, description]) => ({ name, description })),
    paths,
  };
}

const serialized = `${JSON.stringify(buildSpec(), null, 2)}\n`;

if (checkOnly) {
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
  if (current !== serialized) {
    console.error(
      "[openapi] swagger.json is out of date. Run `pnpm openapi:generate` and commit the result.",
    );
    process.exit(1);
  }
  console.log("[openapi] swagger.json matches the route and Zod schema definitions.");
} else {
  fs.writeFileSync(outputPath, serialized);
  console.log(`[openapi] wrote ${outputPath}`);
}
