import { Router } from "express";
import {
  getMe,
  patchMe,
  deleteMe,
  getReceive,
  getReceiveQrcode,
  postContacts,
  getContacts,
  deleteContact,
  postGuardians,
  getGuardians,
  deleteGuardian,
} from "../controllers/userController";
import {
  getWallet,
  getMeBalance,
  postWalletEnroll,
  postWalletActivate,
  putWalletAddress,
  deleteWallet,
} from "../controllers/walletController";
import { validateApiKey } from "../middleware/auth";
import { apiKeyRateLimiter } from "../middleware/rateLimiter";

const router: ReturnType<typeof Router> = Router();

router.use(validateApiKey);
router.use(apiKeyRateLimiter);

/**
 * @swagger
 * tags:
 *   - name: Users
 *     description: User profile, wallet, and contact management
 */

/**
 * @swagger
 * /v1/users/me:
 *   get:
 *     tags:
 *       - Users
 *     summary: Get current user profile
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: User profile retrieved successfully
 *   patch:
 *     tags:
 *       - Users
 *     summary: Update user profile
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "user@example.com"
 *               phone_e164:
 *                 type: string
 *                 example: "+15551234567"
 *               privacy_hide_from_search:
 *                 type: boolean
 *               passcode:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *   delete:
 *     tags:
 *       - Users
 *     summary: Delete user account
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       204:
 *         description: Account deleted successfully
 */
router.get("/me", getMe);
router.patch("/me", patchMe);
router.delete("/me", deleteMe);

/**
 * @swagger
 * /v1/users/me/receive:
 *   get:
 *     tags:
 *       - Users
 *     summary: Get receive alias and pay URI
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Receive info retrieved successfully
 */
router.get("/me/receive", getReceive);

/**
 * @swagger
 * /v1/users/me/receive/qrcode:
 *   get:
 *     tags:
 *       - Users
 *     summary: Get receive QR code
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: QR code retrieved successfully
 */
router.get("/me/receive/qrcode", getReceiveQrcode);

/**
 * @swagger
 * /v1/users/me/balance:
 *   get:
 *     tags:
 *       - Users
 *     summary: Get user balances
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Balances retrieved successfully
 */
router.get("/me/balance", getMeBalance);

/**
 * @swagger
 * /v1/users/me/wallet:
 *   get:
 *     tags:
 *       - Users
 *     summary: Get wallet state with ETag
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Wallet state retrieved successfully
 */
router.get("/me/wallet", getWallet);

/**
 * @swagger
 * /v1/users/me/wallet/enroll:
 *   post:
 *     tags:
 *       - Users
 *     summary: Enroll a client-generated wallet
 *     description: Binds a keypair generated in the client. The backend never generates, receives or stores a usable private key.
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: header
 *         name: If-Match
 *         required: true
 *         schema:
 *           type: string
 *         description: Current wallet ETag
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - stellar_address
 *             properties:
 *               stellar_address:
 *                 type: string
 *               wrapped_key:
 *                 type: string
 *               wrap_algorithm:
 *                 type: string
 *               wrap_kdf:
 *                 type: string
 *     responses:
 *       200:
 *         description: Wallet enrolled successfully
 *       400:
 *         description: Invalid address or unencrypted key material
 *       409:
 *         description: A different wallet is already enrolled
 */
router.post("/me/wallet/enroll", postWalletEnroll);

/**
 * @swagger
 * /v1/users/me/wallet/activate:
 *   post:
 *     tags:
 *       - Users
 *     summary: Activate wallet on-chain
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Wallet activated successfully
 */
router.post("/me/wallet/activate", postWalletActivate);

/**
 * @swagger
 * /v1/users/me/wallet:
 *   put:
 *     tags:
 *       - Users
 *     summary: Update wallet address
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - stellar_address
 *             properties:
 *               stellar_address:
 *                 type: string
 *     responses:
 *       200:
 *         description: Wallet address updated
 *   delete:
 *     tags:
 *       - Users
 *     summary: Detach wallet
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Wallet detached
 */
router.put("/me/wallet", putWalletAddress);
router.delete("/me/wallet", deleteWallet);

/**
 * @swagger
 * /v1/users/me/contacts:
 *   get:
 *     tags:
 *       - Users
 *     summary: List contacts
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Contacts retrieved successfully
 *   post:
 *     tags:
 *       - Users
 *     summary: Add contact
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - contact_user_id
 *             properties:
 *               contact_user_id:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       201:
 *         description: Contact added successfully
 */
router.post("/me/contacts", postContacts);
router.get("/me/contacts", getContacts);

/**
 * @swagger
 * /v1/users/me/contacts/{id}:
 *   delete:
 *     tags:
 *       - Users
 *     summary: Remove contact
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Contact removed
 */
router.delete("/me/contacts/:id", deleteContact);

/**
 * @swagger
 * /v1/users/me/guardians:
 *   get:
 *     tags:
 *       - Users
 *     summary: List guardians
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Guardians retrieved successfully
 *   post:
 *     tags:
 *       - Users
 *     summary: Add guardian
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               guardian_user_id:
 *                 type: string
 *                 format: uuid
 *               guardian_email:
 *                 type: string
 *                 format: email
 *                 example: "guardian@example.com"
 *               guardian_phone:
 *                 type: string
 *                 example: "+15551234567"
 *     responses:
 *       201:
 *         description: Guardian added successfully
 */
router.post("/me/guardians", postGuardians);
router.get("/me/guardians", getGuardians);

/**
 * @swagger
 * /v1/users/me/guardians/{id}:
 *   delete:
 *     tags:
 *       - Users
 *     summary: Remove guardian
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Guardian removed
 */
router.delete("/me/guardians/:id", deleteGuardian);

export default router;
