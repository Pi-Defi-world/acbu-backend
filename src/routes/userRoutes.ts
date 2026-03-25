import { Router } from "express";
import {
  getMe,
  patchMe,
  deleteMe,
  getReceive,
  getReceiveQrcode,
  postWalletConfirm,
  postContacts,
  getContacts,
  deleteContact,
  postGuardians,
  getGuardians,
  deleteGuardian,
  getBalance,
} from "../controllers/userController";
import { validateApiKey } from "../middleware/auth";
import { apiKeyRateLimiter } from "../middleware/rateLimiter";

const router: ReturnType<typeof Router> = Router();

router.use(validateApiKey);
router.use(apiKeyRateLimiter);

router.get("/me", getMe);
router.get("/me/balance", getBalance);
router.patch("/me", patchMe);
router.delete("/me", deleteMe);
router.get("/me/receive", getReceive);
router.get("/me/receive/qrcode", getReceiveQrcode);
router.post("/me/wallet/confirm", postWalletConfirm);
router.post("/me/contacts", postContacts);
router.get("/me/contacts", getContacts);
router.delete("/me/contacts/:id", deleteContact);
router.post("/me/guardians", postGuardians);
router.get("/me/guardians", getGuardians);
router.delete("/me/guardians/:id", deleteGuardian);

export default router;
