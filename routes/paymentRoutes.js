// routes/paymentRoutes.js
import express from "express";
import { initPayment, paymentWebhook } from "../controllers/paymentController.js";
const router = express.Router();
router.post("/init", initPayment);
router.post("/webhook", paymentWebhook); // verify signature here
export default router;
