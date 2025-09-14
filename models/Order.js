// models/Order.js
import mongoose from "mongoose";

const orderSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    items: [
      {
        name: { type: String, required: true },
        quantity: { type: Number, required: true },
        service: {
          type: String,
          enum: ["washIron", "washFold", "ironOnly"],
          required: true,
        },
        unitPrice: { type: Number, required: true },
        lineTotal: { type: Number, required: true },
      },
    ],

   // 🆕 Order meta
    turnaround: {
      type: String,
      enum: ["standard", "express", "same-day"],
      default: "standard",
    },
    distanceKm: { type: Number, default: 0 },
    delivery: { type: String }, // e.g. "pickup" or "doorstep"
    payment: { type: String },  // e.g. "cash", "card", "transfer"
    status: {
      type: String,
      enum: ["Pending", "In Wash", "Ironing", "Packaging", "Ready", "Delivered"],
      default: "Pending",
    },

    price: { type: Number, required: true },

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
    assignedRoleRequested: { type: String }, // e.g. "washer"
    assignedRoleActual: { type: String }, // e.g. "delivery"

    orderCode: { type: String, unique: true }, // 👈 short reference
  },
  { timestamps: true }
);

// Auto-generate orderCode from ObjectId
orderSchema.pre("save", function (next) {
  if (!this.orderCode) {
    this.orderCode = "ORD-" + this._id.toString().slice(-6).toUpperCase();
  }
  next();
});

// Employee stats
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
