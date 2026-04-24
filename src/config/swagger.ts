import swaggerJsdoc from "swagger-jsdoc";
import { config } from "./env";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "ACBU API",
      version: "1.0.0",
      description:
        "API documentation for ACBU (African Currency Basket Unit) platform",
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
