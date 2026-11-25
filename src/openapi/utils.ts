export function toOpenApiPath(expressPath: string): string {
  return expressPath.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

export function toExpressPath(openApiPath: string): string {
  return openApiPath.replace(/\{([A-Za-z0-9_]+)\}/g, ":$1");
}

export function pathParameterNames(expressPath: string): string[] {
  return [...expressPath.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]);
}

/**
 * Convert JSON Schema numeric exclusive bounds to the form accepted by the
 * OpenAPI validator used by this repository.
 */
export function normalizeSchemaConstraints(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(normalizeSchemaConstraints);
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }

  const schema = value as Record<string, any>;
  if (schema.exclusiveMinimum === true && typeof schema.minimum === "number") {
    schema.exclusiveMinimum = schema.minimum;
  }
  Object.values(schema).forEach(normalizeSchemaConstraints);
}
