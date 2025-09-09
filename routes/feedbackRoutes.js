import express from "express";
import { createFeedback, getAverageRating,staffPerformance } from "../controllers/feedbackController.js";
import { requireAdmin } from '../middleware/auth.js'

const router = express.Router();

router.post("/create-feedback", createFeedback);
router.get("/average", getAverageRating);
router.get("/staff-performance",requireAdmin, staffPerformance);

export default router;
