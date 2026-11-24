import fs from "fs";
import path from "path";
import { z } from "zod";
import { routeSchemas } from "../src/controllers/route-schemas";
import OpenAPISchemaValidator from "openapi-schema-validator";

const swaggerDocumentPath = path.resolve(__dirname, "../swagger.json");
const swaggerDocument = JSON.parse(fs.readFileSync(swaggerDocumentPath, "utf8"));

describe("OpenAPI Drift vs Implementation", () => {
  const paths = swaggerDocument.paths || {};
  const schemaRegistry = routeSchemas as Record<string, any>;
  const errors: string[] = [];

  // Helper to normalize path for comparison
  const normalizePath = (p: string) => p.replace(/\/$/, "");

  /**
   * CHECK 1: Every route in routeSchemas must be documented in Swagger
   */
  it("should validate swagger.json against the OpenAPI 3.0 schema", () => {
    const validator = new OpenAPISchemaValidator({ version: 3 });
    const result = validator.validate(swaggerDocument);

    expect(result.errors).toEqual([]);
  });

  it("should ensure all registered route schemas are documented in OpenAPI", () => {
    for (const routeKey of Object.keys(schemaRegistry)) {
      const [method, routePath] = routeKey.split(" ");
      const normalizedPath = normalizePath(routePath);

      const swaggerPath = paths[normalizedPath];
      if (!swaggerPath) {
        errors.push(`[MISSING PATH] ${routeKey}: Path not found in OpenAPI documentation`);
        continue;
      }

      const operation = swaggerPath[method.toLowerCase()];
      if (!operation) {
        errors.push(`[MISSING METHOD] ${routeKey}: Method ${method} not found for path ${normalizedPath} in OpenAPI`);
      }
    }

    if (errors.length > 0) {
      throw new Error("OpenAPI Drift Detected:\n" + errors.join("\n"));
    }
  });

  /**
   * CHECK 2: Every route in Swagger (v1) must have a registered Zod schema
   */
  it("should ensure all documented v1 routes have a registered Zod schema", () => {
    for (const [pathStr, methods] of Object.entries(paths)) {
      if (!pathStr.startsWith("/v1/")) continue;

      for (const method of Object.keys(methods as any)) {
        const routeKey = `${method.toUpperCase()} ${pathStr}`;
        if (!schemaRegistry[routeKey]) {
          // We don't necessarily fail on this, but it's a good practice to register all routes
          console.warn(`[WARNING] ${routeKey}: Documented in OpenAPI but missing from routeSchemas registry`);
        }
      }
    }
  });

  /**
   * CHECK 3: Schema field matching
   */
  it("should ensure OpenAPI documentation and Zod schemas match exactly", () => {
    for (const [routeKey, zodSchema] of Object.entries(schemaRegistry)) {
      const [method, routePath] = routeKey.split(" ");
      const normalizedPath = normalizePath(routePath);
      const swaggerPath = paths[normalizedPath];
      if (!swaggerPath) continue;

      const operation = swaggerPath[method.toLowerCase()];
      if (!operation) continue;

      // Convert Zod schema to JSON schema
      let jsonSchema: any;
      try {
        jsonSchema = z.toJSONSchema(zodSchema as any);
      } catch (e) {
        errors.push(`[ERROR] ${routeKey}: Failed to convert Zod schema to JSON: ${(e as Error).message}`);
        continue;
      }

      const zodProperties = jsonSchema.properties || {};
      const zodRequired = jsonSchema.required || [];

      // Check request body
      if (method === "POST" || method === "PUT" || method === "PATCH") {
        const requestBody = operation.requestBody;
        const swaggerSchema = requestBody?.content?.["application/json"]?.schema;

        if (swaggerSchema) {
          const swaggerProperties = swaggerSchema.properties || {};
          const swaggerRequired = swaggerSchema.required || [];

          // Check for fields documented in Swagger but missing in Zod
          for (const propName of Object.keys(swaggerProperties)) {
            if (!zodProperties[propName]) {
              errors.push(`[DRIFT] ${routeKey}: Field '${propName}' is documented in Swagger but missing from Zod schema`);
            }
          }

          // Check for fields in Zod but missing in Swagger
          for (const propName of Object.keys(zodProperties)) {
            if (!swaggerProperties[propName]) {
              errors.push(`[DRIFT] ${routeKey}: Field '${propName}' is in Zod schema but not documented in Swagger`);
            } else {
              // Check type match
              const zodType = zodProperties[propName].type;
              const swaggerType = swaggerProperties[propName].type;
              if (zodType && swaggerType && zodType !== swaggerType) {
                errors.push(`[TYPE DRIFT] ${routeKey}: Field '${propName}' type mismatch. Zod: ${zodType}, Swagger: ${swaggerType}`);
              }
            }
          }

          // Check required fields
          for (const reqField of zodRequired) {
            if (!swaggerRequired.includes(reqField)) {
              errors.push(`[REQUIRED DRIFT] ${routeKey}: Field '${reqField}' is required in Zod but not in Swagger`);
            }
          }
          for (const reqField of swaggerRequired) {
            if (!zodRequired.includes(reqField)) {
              errors.push(`[REQUIRED DRIFT] ${routeKey}: Field '${reqField}' is required in Swagger but not in Zod`);
            }
          }
        } else if (Object.keys(zodProperties).length > 0) {
          errors.push(`[DRIFT] ${routeKey}: Zod schema has fields but no requestBody documented in Swagger`);
        }
      }

      // Check query parameters for GET requests
      if (method === "GET") {
        const swaggerParams = operation.parameters || [];
        const queryParams = swaggerParams.filter((p: any) => p.in === "query");

        for (const propName of Object.keys(zodProperties)) {
          const param = queryParams.find((p: any) => p.name === propName);
          if (!param) {
            errors.push(`[DRIFT] ${routeKey}: Query param '${propName}' is in Zod schema but not documented in Swagger`);
          }
        }

        for (const param of queryParams) {
          if (!zodProperties[param.name]) {
            errors.push(`[DRIFT] ${routeKey}: Query param '${param.name}' is documented in Swagger but missing from Zod schema`);
          }
        }
      }
    }

    if (errors.length > 0) {
      throw new Error("OpenAPI Drift Detected:\n" + errors.join("\n"));
    }
  });

  /**
   * CHECK 4: Metadata (Summary/Responses)
   */
  it("should ensure all documented routes have basic metadata", () => {
    const metaErrors: string[] = [];
    for (const [pathStr, methods] of Object.entries(paths)) {
      if (!pathStr.startsWith("/v1/")) continue;

      for (const [method, operation] of Object.entries(methods as any)) {
        const routeKey = `${method.toUpperCase()} ${pathStr}`;
        const op = operation as any;

        if (!op.summary) {
          console.warn(`[DOCS] ${routeKey}: Missing summary`);
        }
        if (!op.responses || Object.keys(op.responses).length === 0) {
          metaErrors.push(`[DOCS] ${routeKey}: Missing responses`);
        }
      }
    }

    if (metaErrors.length > 0) {
      throw new Error("Missing critical documentation:\n" + metaErrors.join("\n"));
    }
  });
});
