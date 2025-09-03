import express from "express";
import { createAlert, getUnresolvedAlerts, resolveAlert } from "../controllers/staffAlertController.js";

const router = express.Router();

router.post("/", createAlert);
router.get("/", getUnresolvedAlerts);
router.patch("/:id/resolve", resolveAlert);

export default router;
