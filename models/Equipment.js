import mongoose from "mongoose";

const equipmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    type: { type: String, enum: ["washer", "dryer", "iron", "other"], default: "other" },
    lastServiced: { type: Date },
    serviceIntervalDays: { type: Number, default: 30 },
    usageHours: { type: Number, default: 0 }, // track machine runtime
    nextServiceDue: { type: Date }, // optional convenience
    repairHistory: [
      {
        date: { type: Date },
        cost: { type: Number },
        notes: { type: String },
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.model("Equipment", equipmentSchema);
