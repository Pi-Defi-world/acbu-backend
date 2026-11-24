import swaggerJsdoc from "swagger-jsdoc";
import { config } from "./env";

/**
 * Swagger / OpenAPI spec configuration.
 *
 * Security (#274): The spec is generated at startup but the /api-docs UI is
 * only mounted when NODE_ENV !== "production" (enforced in src/index.ts).
 * This prevents internal endpoint structure from being exposed to attackers
 * in production deployments.
 *
 * If you need to share the spec with internal tooling in production, serve
 * the raw JSON behind an authenticated admin endpoint instead of the public
 * swagger-ui-express mount.
 */

const options: swaggerJsdoc.Options = {
  definition: {
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
        url: `http://localhost:${config.port}`,
        description: "Development server",
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
        ErrorResponse: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                code: {
                  type: "string",
                  description: "A machine-readable error code",
                  example: "VALIDATION_ERROR",
                },
                message: {
                  type: "string",
                  description: "A human-readable error message",
                  example: "Validation error",
                },
                details: {
                  type: "object",
                  description: "Additional structured information about the error",
                  nullable: true,
                },
              },
              required: ["code", "message"],
            },
          },
          required: ["error"],
        },
      },
    },
    security: [
      {
        ApiKeyAuth: [],
      },
    ],
  },
  apis: ["./src/routes/**/*.ts", "./src/controllers/**/*.ts"],
};

export const swaggerSpec = swaggerJsdoc(options);
