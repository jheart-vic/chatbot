import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    from: { type: String, enum: ["user", "bot"], required: true },
    text: { type: String, required: true },
    intent: { type: String }, // e.g., "create_order", "track_order"
    conversationId: { type: String }, // optional for session grouping
    timestamp: { type: Date, default: Date.now },
    externalId: { type: String, unique: true, sparse: true },

  },
  { timestamps: true }
);

export default mongoose.model("Message", messageSchema);
