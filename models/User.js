import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true },
    whatsappName: { type: String }, // fallback if onboarding incomplete
    phone: { type: String, required: true, unique: true },
    address: { type: String },
    preferences: {
      fragrance: String,
      foldingStyle: String,
      ironingInstructions: String,
    },
    loyaltyBalance: { type: Number, default: 0 }, // cashback/points
    totalOrders: { type: Number, default: 0 },
    isOnboarded: { type: Boolean, default: false }, // NEW
    isStaff: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);
