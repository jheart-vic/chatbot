import express from "express";
import { sendNotification } from "../controllers/notificationController.js";

const router = express.Router();

router.post("/send", sendNotification);
// router.get("/user/:userId", getUserNotifications);

export default router;
