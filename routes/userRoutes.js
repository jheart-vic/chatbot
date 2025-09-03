import express from "express";
import { onboardUser, getLoyaltyBalance, updatePreferences } from "../controllers/userController.js";

const router = express.Router();

router.get("/loyalty/:phone", getLoyaltyBalance);
router.post("/onboard", onboardUser);
router.post("/preference",updatePreferences);

export default router;
