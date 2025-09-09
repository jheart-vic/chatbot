import cron from "node-cron";
import { DateTime } from "luxon";
import Inventory from "../models/Inventory.js";
import Equipment from "../models/Equipment.js";
import Notification from "../models/Notification.js";
import { sendWhatsAppMessage } from "../helpers/whatsApp.js";

/**
 * Ops Job
 * Runs daily at 8 AM Lagos time:
 *  1️⃣ Check low inventory and alert procurement
 *  2️⃣ Check maintenance schedules and alert operations
 */
cron.schedule("0 8 * * *", async () => {
  const now = DateTime.now().setZone("Africa/Lagos");
  console.log("📦🛠️ Running ops check (inventory + equipment)...");

  try {
    // 1️⃣ Low Stock Check
    const lowStockItems = await Inventory.find({
      $expr: { $lt: ["$quantity", "$lowStockThreshold"] },
    });

    for (let item of lowStockItems) {
      const message = `⚠️ Low stock alert: ${item.itemName} has only ${item.quantity} left (threshold: ${item.lowStockThreshold}). Please reorder!`;

      await Notification.create({
        type: "inventory",
        message,
        createdAt: now.toJSDate(),
      });

      if (process.env.OPERATIONS_NUMBER) {
        await sendWhatsAppMessage(process.env.OPERATIONS_NUMBER, message);
      }
    }

    // 2️⃣ Maintenance Check
    const equipments = await Equipment.find({ lastServiced: { $exists: true } });

    for (let eq of equipments) {
      const nextDue = DateTime.fromJSDate(eq.lastServiced)
        .plus({ days: eq.serviceIntervalDays || 30 })
        .setZone("Africa/Lagos");

      if (nextDue <= now) {
        const message = `🛠️ Maintenance due for ${eq.name}. Last serviced on ${DateTime.fromJSDate(eq.lastServiced)
          .setZone("Africa/Lagos")
          .toFormat("dd LLL yyyy")}. Please schedule servicing!`;

        await Notification.create({
          type: "maintenance",
          message,
          createdAt: now.toJSDate(),
        });

        if (process.env.OPERATIONS_NUMBER) {
          await sendWhatsAppMessage(process.env.OPERATIONS_NUMBER, message);
        }
      }
    }

    console.log(
      `✅ Ops check complete: ${lowStockItems.length} low-stock alerts, ${equipments.length} equipment checked.`
    );
  } catch (err) {
    console.error("❌ Error in ops job:", err);
  }
});
