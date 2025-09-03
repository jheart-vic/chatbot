// models/Expense.js
import mongoose from "mongoose";

const expenseSchema = new mongoose.Schema(
  {
    description: { type: String, required: true },
    amount: { type: Number, required: true },
    category: {
      type: String,
      enum: ["supplies", "maintenance", "salary", "utilities", "other"],
      default: "other",
    },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" }, // optional
    date: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export default mongoose.model("Expense", expenseSchema);
