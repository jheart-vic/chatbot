import express from "express";
import { createFeedback, getAverageRating } from "../controllers/feedbackController.js";

const router = express.Router();

router.post("/create-feedback", createFeedback);
router.get("/average", getAverageRating);

export default router;
