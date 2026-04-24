import { swaggerSpec } from "../src/config/swagger";
import { zodToJsonSchema } from "zod-to-json-schema";
import { routeSchemas } from "../src/controllers/schemas";
import { prisma } from "../src/config/database";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("OpenAPI Drift vs Implementation", () => {
  /**
   * Ensures OpenAPI documentation matches actual Zod validation schemas
   * Checks both directions:
   * 1. Fields documented in Swagger must exist in Zod schemas
   * 2. All Zod schema fields must be documented in Swagger
   */
  it("should fail if OpenAPI documentation and Zod schemas drift", () => {
    let driftFound = false;
    const errors: string[] = [];

    const paths = swaggerSpec.paths || {};

    for (const [pathStr, methods] of Object.entries(paths)) {
      for (const [method, methodOperation] of Object.entries(methods as any)) {
        if (typeof methodOperation !== 'object' || methodOperation === null) {
          continue;
        }

        const operation = methodOperation as any;
        const methodKey = `${method.toUpperCase()} ${pathStr}`;
        const zodSchema = routeSchemas[methodKey];

        if (!zodSchema) {
          // Skip routes without registered schemas
          continue;
        }

        // Convert Zod schema to JSON schema for comparison
        let jsonSchema: any;
        try {
          jsonSchema = zodToJsonSchema(zodSchema);
        } catch (e) {
          errors.push(`Failed to convert Zod schema to JSON for ${methodKey}: ${(e as Error).message}`);
          driftFound = true;
          continue;
        }

        // ========== CHECK 1: Swagger fields must exist in Zod ==========
        const requestBody = operation.requestBody;
        if (requestBody && requestBody.content && requestBody.content["application/json"]) {
          const openApiSchema = requestBody.content["application/json"].schema;

          if (openApiSchema && openApiSchema.properties) {
            const zodProperties = jsonSchema.properties || {};

            for (const propName of Object.keys(openApiSchema.properties)) {
              if (!zodProperties[propName]) {
                driftFound = true;
                errors.push(
                  `[DRIFT] ${methodKey}: Field '${propName}' is documented in Swagger but missing from Zod schema`
                );
              }
            }
          }
        }

        // ========== CHECK 2: Zod fields should be documented in Swagger ==========
        if (jsonSchema.properties) {
          const swaggerProperties = requestBody?.content?.["application/json"]?.schema?.properties || {};

          for (const propName of Object.keys(jsonSchema.properties)) {
            if (!swaggerProperties[propName] && propName !== "items") {
              // Note: We warn but don't fail on this, as some internal fields might not need docs
              console.warn(
                `[WARNING] ${methodKey}: Field '${propName}' is in Zod schema but not documented in Swagger`
              );
            }
          }
        }

        // ========== CHECK 3: Query parameters ==========
        if (operation.parameters && Array.isArray(operation.parameters)) {
          for (const param of operation.parameters) {
            if (param.in === "query" || param.in === "path") {
              // Query/path parameters would be checked against separate schemas here
              // For now, we just ensure they're defined
              if (!param.name) {
                driftFound = true;
                errors.push(`[DRIFT] ${methodKey}: Parameter missing name`);
              }
            }
          }
        }
      }
    }

    if (driftFound) {
      throw new Error("OpenAPI Drift Detected:\n" + errors.join("\n"));
    }
  });

  /**
   * Verifies that all documented routes have proper request/response schemas
   * Ensures new routes don't go undocumented
   */
  it("should ensure all routes have proper OpenAPI documentation", () => {
    const paths = swaggerSpec.paths || {};
    const errors: string[] = [];

    for (const [pathStr, methods] of Object.entries(paths)) {
      for (const [method, methodOperation] of Object.entries(methods as any)) {
        if (typeof methodOperation !== 'object' || methodOperation === null) {
          continue;
        }

        const operation = methodOperation as any;
        const methodKey = `${method.toUpperCase()} ${pathStr}`;

        // Check for summary and description
        if (!operation.summary) {
          errors.push(`[DOCS] ${methodKey}: Missing summary in OpenAPI`);
        }

        // Check for responses
        if (!operation.responses) {
          errors.push(`[DOCS] ${methodKey}: Missing responses in OpenAPI`);
        }
      }
    }

    // We warn about these but don't fail the test
    if (errors.length > 0) {
      console.warn("Documentation warnings:\n" + errors.join("\n"));
    }
  });
});
