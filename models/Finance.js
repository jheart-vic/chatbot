import mongoose from "mongoose";

const financeSchema = new mongoose.Schema(
  {
    date: { type: Date, default: Date.now },
    period: { type: String, enum: ["daily", "weekly", "monthly"], default: "daily" },
    revenue: { type: Number, default: 0 },
    expenses: { type: Number, default: 0 },
    breakdown: [{ service: String, amount: Number }],
  },
  { timestamps: true }
);

// Virtual for profit (auto-calculated)
financeSchema.virtual("profit").get(function () {
  return this.revenue - this.expenses;
});

export default mongoose.model("Finance", financeSchema);
