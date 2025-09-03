import express from "express";
import { getAllUsers, getUserById, updateUser } from "../controllers/adminController.js";
import { getAllOrders, updateOrderStatus } from "../controllers/adminController.js";
import { getInventory, updateInventory } from "../controllers/adminController.js";
import { getAllFeedback } from "../controllers/adminController.js";

const router = express.Router();

// Users
router.get("/users", getAllUsers);
router.get("/users/:id", getUserById);
router.put("/users/:id", updateUser);

// Orders
router.get("/orders", getAllOrders);
router.put("/orders/:id/status", updateOrderStatus);

// Inventory
router.get("/inventory", getInventory);
router.put("/inventory/:id", updateInventory);

// Feedback
router.get("/feedback", getAllFeedback);

export default router;
