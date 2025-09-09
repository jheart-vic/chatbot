import express from "express";
import { createOrder, updateStatus } from "../controllers/orderController.js";
import { requireAdmin } from '../middleware/auth.js'

const router = express.Router();


router.post("/create", requireAdmin, createOrder);
router.put("/status/:id", requireAdmin, updateStatus);
// router.get("/status/:id", requireAdmin, getOrderStatus);

export default router;
