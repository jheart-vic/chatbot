// models/MonthlyFinance.js
import mongoose from "mongoose";

const monthlyFinanceSchema = new mongoose.Schema(
  {
    month: { type: String, required: true }, // e.g. "2025-09"
    revenue: { type: Number, default: 0 },
    expenses: { type: Number, default: 0 },
    profit: { type: Number, default: 0 },
    breakdown: [{ service: String, amount: Number }],
  },
  { timestamps: true }
);

export default mongoose.model("MonthlyFinance", monthlyFinanceSchema);
