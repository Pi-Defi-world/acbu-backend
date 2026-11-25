import fs from "fs";
import path from "path";
import { zodToJsonSchema } from "zod-to-json-schema";
import OpenAPISchemaValidator from "openapi-schema-validator";
import { swaggerSpec } from "../src/config/swagger";
import { routeSchemas } from "../src/controllers/route-schemas";
import { getOpenApiRouteKey, openApiRoutes } from "../src/openapi/route-definitions";
import {
  normalizeSchemaConstraints,
  pathParameterNames,
  toExpressPath,
  toOpenApiPath,
} from "../src/openapi/utils";

const swaggerDocumentPath = path.resolve(__dirname, "../swagger.json");
const swaggerDocument = JSON.parse(fs.readFileSync(swaggerDocumentPath, "utf8"));
const paths = swaggerDocument.paths as Record<string, Record<string, any>>;
const routeDirectory = path.resolve(__dirname, "../src/routes");
const httpMethods = new Set(["get", "post", "put", "patch", "delete"]);

type ParsedRouteFile = {
  imports: Map<string, string>;
  routes: Array<{ method: string; path: string }>;
  mounts: Array<{ path: string; target: string }>;
};

function routeFileOf(importPath: string): string {
  return path.join(routeDirectory, `${importPath}.ts`);
}

function parseRouteFile(filePath: string): ParsedRouteFile {
  const source = fs.readFileSync(filePath, "utf8");
  const imports = new Map<string, string>();
  const routes: ParsedRouteFile["routes"] = [];
  const mounts: ParsedRouteFile["mounts"] = [];

  for (const match of source.matchAll(/import\s+(\w+)\s+from\s+["']\.\/([^"']+)["'];/g)) {
    imports.set(match[1], routeFileOf(match[2]));
  }
  for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']\.\/([^"']+)["'];/g)) {
    for (const rawName of match[1].split(",")) {
      const name = rawName.trim().replace(/^type\s+/, "");
      if (name) imports.set(name, routeFileOf(match[2]));
    }
  }

  for (const match of source.matchAll(
    /\brouter\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g,
  )) {
    routes.push({ method: match[1].toUpperCase(), path: match[2] });
  }
  for (const match of source.matchAll(
    /\brouter\.use\(\s*["']([^"']+)["']\s*,\s*(\w+)(?:\(\))?\s*\)/g,
  )) {
    mounts.push({ path: match[1], target: match[2] });
  }

  return { imports, routes, mounts };
}

function collectExpressRouteKeys(): Set<string> {
  const keys = new Set<string>();
  const visited = new Set<string>();

  const walk = (filePath: string, prefix: string): void => {
    const visitKey = `${filePath}|${prefix}`;
    if (visited.has(visitKey)) return;
    visited.add(visitKey);

    const parsed = parseRouteFile(filePath);
    for (const route of parsed.routes) {
      const fullPath = `${prefix}${route.path}`.replace(/\/$/, "") || "/";
      keys.add(`${route.method} ${fullPath}`);
    }

    for (const mount of parsed.mounts) {
      const targetFile = parsed.imports.get(mount.target);
      if (!targetFile) continue;
      const fullPrefix = `${prefix}${mount.path}`.replace(/\/$/, "");
      walk(targetFile, fullPrefix);
    }
  };

  walk(path.join(routeDirectory, "index.ts"), "/v1");

  // Webhooks are mounted directly in src/index.ts under /v1/webhooks rather
  // than through the main API router.
  for (const provider of ["flutterwave", "paystack", "bills/:provider"]) {
    keys.add(`POST /v1/webhooks/${provider}`);
  }

  return keys;
}

function zodSchemaToOpenApi(schema: unknown): Record<string, any> {
  const jsonSchema = zodToJsonSchema(schema as never, {
    target: "openApi3",
    effectStrategy: "input",
    $refStrategy: "none",
  }) as Record<string, any>;
  normalizeSchemaConstraints(jsonSchema);
  return jsonSchema;
}

function getOperation(routePath: string, method: string): Record<string, any> | undefined {
  return paths[toOpenApiPath(routePath)]?.[method.toLowerCase()];
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

describe("OpenAPI Drift vs Implementation", () => {
  it("validates swagger.json against the OpenAPI schema", () => {
    const validator = new OpenAPISchemaValidator({ version: 3 });
    expect(validator.validate(swaggerDocument).errors).toEqual([]);
  });

  it("serves the same generated spec at runtime", () => {
    expect(swaggerSpec).toEqual(swaggerDocument);
  });

  it("documents exactly the routes mounted by Express", () => {
    const expressRoutes = collectExpressRouteKeys();
    const documentedRoutes = new Set<string>();

    for (const [pathName, methods] of Object.entries(paths)) {
      for (const method of Object.keys(methods)) {
        if (!httpMethods.has(method)) continue;
        documentedRoutes.add(`${method.toUpperCase()} ${toExpressPath(pathName)}`);
      }
    }

    expect(sorted(documentedRoutes)).toEqual(sorted(expressRoutes));
  });

  it("keeps the route manifest aligned with Express and OpenAPI", () => {
    const manifestRoutes = openApiRoutes.map(getOpenApiRouteKey);
    const documentedRoutes = new Set<string>();

    for (const [pathName, methods] of Object.entries(paths)) {
      for (const method of Object.keys(methods)) {
        if (!httpMethods.has(method)) continue;
        documentedRoutes.add(`${method.toUpperCase()} ${toExpressPath(pathName)}`);
      }
    }

    expect(sorted(manifestRoutes)).toEqual(sorted(documentedRoutes));
  });

  it("uses only current /v1 paths and removes legacy auth route names", () => {
    expect(Object.keys(paths).every((routePath) => routePath.startsWith("/v1/"))).toBe(true);
    expect(swaggerDocument).not.toHaveProperty("paths./api/v1/auth/login-otp");
    expect(JSON.stringify(swaggerDocument)).not.toContain("login-otp");
    expect(swaggerDocument.servers?.[0]?.url).toBe("http://localhost:5000/api");
  });

  it("matches every documented path parameter to the mounted Express route", () => {
    const errors: string[] = [];

    for (const route of openApiRoutes) {
      const operation = getOperation(route.path, route.method);
      if (!operation) {
        errors.push(`[MISSING OPERATION] ${getOpenApiRouteKey(route)}`);
        continue;
      }

      const documentedPathParams = (operation.parameters ?? [])
        .filter((parameter: any) => parameter.in === "path")
        .map((parameter: any) => parameter.name);
      const expectedPathParams = pathParameterNames(route.path);

      if (
        JSON.stringify(sorted(documentedPathParams)) !== JSON.stringify(sorted(expectedPathParams))
      ) {
        errors.push(
          `[PATH PARAM DRIFT] ${getOpenApiRouteKey(route)}: Express ${JSON.stringify(expectedPathParams)}, OpenAPI ${JSON.stringify(documentedPathParams)}`,
        );
      }

      for (const parameter of operation.parameters ?? []) {
        if (parameter.in === "path" && parameter.required !== true) {
          errors.push(`[PATH PARAM REQUIRED] ${getOpenApiRouteKey(route)}: ${parameter.name}`);
        }
      }
    }

    expect(errors).toEqual([]);
  });

  it("matches OpenAPI query parameters to the registered Zod schemas", () => {
    const errors: string[] = [];

    for (const route of openApiRoutes) {
      if (route.method !== "get") continue;

      const schema = routeSchemas[getOpenApiRouteKey(route)];
      const operation = getOperation(route.path, route.method);
      if (!schema || !operation) continue;

      const jsonSchema = zodSchemaToOpenApi(schema);
      const zodProperties = (jsonSchema.properties ?? {}) as Record<string, any>;
      const zodRequired = new Set<string>((jsonSchema.required ?? []) as string[]);
      const documentedParams = (operation.parameters ?? []).filter(
        (parameter: any) => parameter.in === "query",
      );
      const documentedByName = new Map<string, any>(
        documentedParams.map((parameter: any) => [parameter.name, parameter]),
      );

      for (const [name, property] of Object.entries(zodProperties)) {
        const documented = documentedByName.get(name);
        if (!documented) {
          errors.push(`[MISSING QUERY PARAM] ${getOpenApiRouteKey(route)}: ${name}`);
          continue;
        }
        if (property.type && documented.schema?.type && property.type !== documented.schema.type) {
          errors.push(
            `[QUERY TYPE DRIFT] ${getOpenApiRouteKey(route)}: ${name} Zod=${property.type} OpenAPI=${documented.schema.type}`,
          );
        }
        if ((documented.required === true) !== zodRequired.has(name)) {
          errors.push(`[QUERY REQUIRED DRIFT] ${getOpenApiRouteKey(route)}: ${name}`);
        }
      }

      for (const parameter of documentedParams) {
        if (!zodProperties[parameter.name]) {
          errors.push(`[STALE QUERY PARAM] ${getOpenApiRouteKey(route)}: ${parameter.name}`);
        }
      }
    }

    expect(errors).toEqual([]);
  });

  it("matches OpenAPI request bodies to the registered Zod schemas", () => {
    const errors: string[] = [];

    for (const route of openApiRoutes) {
      if (!["post", "put", "patch"].includes(route.method)) continue;

      const schema = routeSchemas[getOpenApiRouteKey(route)];
      const operation = getOperation(route.path, route.method);
      if (!schema || !operation) continue;

      const jsonSchema = zodSchemaToOpenApi(schema);
      const zodProperties = (jsonSchema.properties ?? {}) as Record<string, any>;
      const zodRequired = new Set<string>((jsonSchema.required ?? []) as string[]);
      const swaggerSchema = operation.requestBody?.content?.["application/json"]?.schema;

      if (!swaggerSchema) {
        if (Object.keys(zodProperties).length > 0) {
          errors.push(`[MISSING BODY] ${getOpenApiRouteKey(route)}`);
        }
        continue;
      }

      const swaggerProperties = (swaggerSchema.properties ?? {}) as Record<string, any>;
      const swaggerRequired = new Set<string>((swaggerSchema.required ?? []) as string[]);

      for (const [name, property] of Object.entries(zodProperties)) {
        const documented = swaggerProperties[name];
        if (!documented) {
          errors.push(`[MISSING BODY FIELD] ${getOpenApiRouteKey(route)}: ${name}`);
          continue;
        }
        if (property.type && documented.type && property.type !== documented.type) {
          errors.push(
            `[BODY TYPE DRIFT] ${getOpenApiRouteKey(route)}: ${name} Zod=${property.type} OpenAPI=${documented.type}`,
          );
        }
        if (swaggerRequired.has(name) !== zodRequired.has(name)) {
          errors.push(`[BODY REQUIRED DRIFT] ${getOpenApiRouteKey(route)}: ${name}`);
        }
      }

      for (const name of Object.keys(swaggerProperties)) {
        if (!zodProperties[name]) {
          errors.push(`[STALE BODY FIELD] ${getOpenApiRouteKey(route)}: ${name}`);
        }
      }
    }

    expect(errors).toEqual([]);
  });

  it("ensures every documented route has responses and a summary", () => {
    const errors: string[] = [];

    for (const [pathName, methods] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        if (!httpMethods.has(method)) continue;
        const routeKey = `${method.toUpperCase()} ${pathName}`;
        if (!(operation as any).summary) {
          errors.push(`[MISSING SUMMARY] ${routeKey}`);
        }
        if (
          !(operation as any).responses ||
          Object.keys((operation as any).responses).length === 0
        ) {
          errors.push(`[MISSING RESPONSES] ${routeKey}`);
        }
      }
    }

    expect(errors).toEqual([]);
  });
});
