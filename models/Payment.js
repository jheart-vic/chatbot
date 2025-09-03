import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    amount: { type: Number, required: true },
    currency: { type: String, default: "NGN" }, // NEW
    type: { type: String, enum: ["income", "expense"], default: "income" }, // NEW
    provider: { type: String, enum: ["paystack","flutterwave","bank_transfer"], required: true },
    reference: { type: String, unique: true, required: true },
    status: { type: String, enum: ["pending","successful","failed"], default: "pending" },
  },
  { timestamps: true }
);

export default mongoose.model("Payment", paymentSchema);
