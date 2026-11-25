/**
 * Backwards-compatible re-export of the standalone route schema registry.
 *
 * Keeping one registry avoids the previous situation where this file and
 * route-schemas.ts could drift from each other and from the Express routes.
 */

export { routeSchemas, getRouteSchema, getAllRouteSchemas } from "./route-schemas";

export { default } from "./route-schemas";
