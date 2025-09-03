import mongoose from "mongoose";

const feedbackSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
    rating: { type: Number, min: 1, max: 5, required: true },
    comment: { type: String },
    complaint: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Optional: index for faster queries
feedbackSchema.index({ orderId: 1 });
feedbackSchema.index({ userId: 1 });

export default mongoose.model("Feedback", feedbackSchema);
