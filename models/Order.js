import mongoose from "mongoose";

const orderSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
     items: [
      {
        name: { type: String, required: true },
        quantity: { type: Number, required: true },
      },
    ],
    status: {
      type: String,
      enum: ["Pending", "In Wash", "Ironing", "Packaging", "Ready", "Delivered"],
      default: "Pending",
    },
    price: { type: Number, required: true },
    services: [{ service: String, amount: Number }], // optional: for breakdown
    loyaltyEarned: { type: Number, default: 0 },
    loyaltyRedeemed: { type: Number, default: 0 },
    discountApplied: { type: Number, default: 0 },
    delayReason: {
      type: String,
      enum: ["none", "machine_breakdown", "heavy_load", "quality_rework", "logistics", "other"],
      default: "none",
    },
    dueDate: { type: Date },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
  },
  { timestamps: true }
);

// Auto-update employee stats when saving an order
orderSchema.post("save", async function (doc, next) {
  try {
    if (doc.assignedTo) {
      const Employee = mongoose.model("Employee");
      await Employee.findByIdAndUpdate(doc.assignedTo, {
        $inc: { dailyOrders: 1, weeklyOrders: 1 },
      });
    }
    next();
  } catch (err) {
    console.error("Error updating employee stats:", err);
    next(err);
  }
});

export default mongoose.model("Order", orderSchema);
