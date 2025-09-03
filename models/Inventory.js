import mongoose from "mongoose";

const inventorySchema = new mongoose.Schema(
  {
    itemName: { type: String, required: true },
    quantity: { type: Number, default: 0 },
    lowStockThreshold: { type: Number, default: 10 },
    unit: { type: String, default: "pcs" }, // e.g., kg, pcs, litres
    supplier: { type: String },
    usageHistory: [
      {
        date: { type: Date, default: Date.now },
        change: { type: Number }, // negative = used, positive = restocked
        note: { type: String },
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.model("Inventory", inventorySchema);
