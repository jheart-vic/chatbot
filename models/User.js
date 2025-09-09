const userSchema = new mongoose.Schema(
  {
    fullName: { type: String }, // not required anymore
    whatsappName: { type: String },
    phone: { type: String, required: true, unique: true },
    address: { type: String },
    preferences: {
      fragrance: String,
      foldingStyle: String,
      ironingInstructions: String,
    },
    loyaltyBalance: { type: Number, default: 0 },
    totalOrders: { type: Number, default: 0 },
    isOnboarded: { type: Boolean, default: false },
    isStaff: { type: Boolean, default: false },
  },
  { timestamps: true }
)

export default mongoose.model("User", userSchema);