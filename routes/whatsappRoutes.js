import express from "express";
import { handleIncomingMessage } from "../controllers/whatsappController.js";

const router = express.Router();

// WhatsApp webhook endpoint
router.post("/webhook", handleIncomingMessage);

export default router;
