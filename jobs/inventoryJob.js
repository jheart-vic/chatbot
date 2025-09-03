// // jobs/inventoryJob.js
// import Inventory from "../models/Inventory.js";
// import { sendWhatsAppMessage } from "../helpers/whatsApp.js";
// export async function runInventoryAlerts() {
//   const lows = await Inventory.find({ $expr: { $lt: ["$quantity","$threshold"] }});
//   for (const item of lows) {
//     // notify ops/procurement
//     await sendWhatsAppMessage(process.env.OPERATIONS_NUMBER,
//       `⚠️ Low stock: ${item.itemName} (${item.quantity} < ${item.threshold})`);
//   }
// }


// jobs/inventoryJob.js
import cron from "node-cron";
import Inventory from "../models/Inventory.js";
import Notification from "../models/Notification.js";
import { sendWhatsAppMessage } from "../helpers/whatsApp.js";

/**
 * Inventory Job
 * - Runs every morning at 8 AM
 * - Sends alerts when stock is low
 */
cron.schedule("0 8 * * *", async () => {
  console.log("📦 Running inventory check...");

  try {
    const lowStockItems = await Inventory.find({
      $expr: { $lt: ["$quantity", "$lowStockThreshold"] },
    });

    for (let item of lowStockItems) {
      const message = `⚠️ Low stock alert: ${item.itemName} has only ${item.quantity} left (threshold: ${item.lowStockThreshold}). Please reorder!`;

      await Notification.create({
        type: "inventory",
        message,
      });

      // Notify operations/procurement via WhatsApp
      if (process.env.OPERATIONS_NUMBER) {
        await sendWhatsAppMessage(process.env.OPERATIONS_NUMBER, message);
      }
    }

    console.log(`✅ Processed ${lowStockItems.length} low-stock items.`);
  } catch (err) {
    console.error("❌ Error checking inventory:", err);
  }
});
