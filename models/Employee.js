import mongoose from "mongoose";

const employeeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    role: {
      type: String,
      enum: ["washer", "ironer", "delivery", "admin"],
      default: "washer"
    },
    dailyOrders: { type: Number, default: 0 },
    weeklyOrders: { type: Number, default: 0 },
    qualityScore: { type: Number, default: 5 }, // avg rating
    mistakes: { type: Number, default: 0 },
    feedbacks: [{ type: mongoose.Schema.Types.ObjectId, ref: "Feedback" }], // link to feedback
  },
  { timestamps: true }
);

export default mongoose.model("Employee", employeeSchema);
