import mongoose from "mongoose";

const staffAlertSchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    type: {
      type: String,
      enum: ["order-delay", "inventory-low", "equipment-maintenance", "customer-complaint"],
      required: true,
    },
    message: { type: String, required: true },
    staffAssigned: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
    priority: { type: String, enum: ["low", "medium", "high"], default: "medium" }, // NEW
    resolved: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model("StaffAlert", staffAlertSchema);
