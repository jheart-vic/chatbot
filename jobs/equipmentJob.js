// // jobs/equipmentJob.js
// import Equipment from "../models/Equipment.js";
// import { sendWhatsAppMessage } from "../helpers/whatsApp.js";
// export async function runMaintenanceReminders() {
//   const now = new Date();
//   const due = await Equipment.find({ nextServiceDue: { $lte: now }});
//   for (const m of due) {
//     await sendWhatsAppMessage(process.env.OPERATIONS_NUMBER,
//       `🛠️ Maintenance due: ${m.name} (due ${m.nextServiceDue.toDateString()})`);
//   }
// }


// jobs/equipmentJob.js
import cron from "node-cron";
import Equipment from "../models/Equipment.js";
import Notification from "../models/Notification.js";
import { sendWhatsAppMessage } from "../helpers/whatsApp.js";

/**
 * Equipment Job
 * - Runs every Monday at 9 AM
 * - Reminds staff about upcoming/overdue maintenance
 */
cron.schedule("0 9 * * 1", async () => {
  console.log("🛠️ Running equipment maintenance check...");

  try {
    const now = new Date();
    const dueEquipments = await Equipment.find({
      lastServiced: { $exists: true },
    });

    for (let eq of dueEquipments) {
      const nextDue = new Date(eq.lastServiced);
      nextDue.setDate(nextDue.getDate() + (eq.serviceIntervalDays || 30));

      if (nextDue <= now) {
        const message = `🛠️ Maintenance due for ${eq.name}. Last serviced on ${eq.lastServiced.toDateString()}. Please schedule servicing!`;

        await Notification.create({
          type: "maintenance",
          message,
        });

        if (process.env.OPERATIONS_NUMBER) {
          await sendWhatsAppMessage(process.env.OPERATIONS_NUMBER, message);
        }
      }
    }

    console.log("✅ Equipment maintenance reminders sent.");
  } catch (err) {
    console.error("❌ Error checking equipment:", err);
  }
});
