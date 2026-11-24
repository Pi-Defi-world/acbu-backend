/**
 * Config routes.
 *
 * GET /config/assets uses optional API-key auth (W10-BE-013):
 *   - Unauthenticated: returns asset code/issuer + network passphrase only.
 *   - Authenticated:   additionally returns Horizon URL, Soroban RPC URL,
 *                      and contract addresses.
 */
import { Router, type IRouter } from "express";
import { getPublicAssetsConfig } from "../controllers/configController";
import { cacheSemiStatic } from "../middleware/cacheHeaders";
import { optionalApiKey } from "../middleware/optionalAuth";

const router: IRouter = Router();

router.get("/assets", optionalApiKey, cacheSemiStatic, getPublicAssetsConfig);

export default router;
