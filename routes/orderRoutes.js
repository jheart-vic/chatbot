import express from "express";
import { createOrder, updateStatus, getOrderStatus } from "../controllers/orderController.js";

const router = express.Router();

router.post("/create", createOrder);
router.put("/status/:id", updateStatus);
router.get("/status/:id", getOrderStatus);

export default router;
