import cron from "node-cron";
import { DateTime } from "luxon";
import Employee from "../models/Employee.js";
import Notification from "../models/Notification.js";
import { sendWhatsAppMessage } from "../helpers/whatsApp.js";

// Daily reset at Lagos midnight
cron.schedule("0 0 * * *", async () => {
  console.log("🔄 Resetting daily employee orders...");
  const now = DateTime.now().setZone("Africa/Lagos");

  try {
    await Employee.updateMany({}, { $set: { dailyOrders: 0 } });

    const message = `✅ Daily employee orders reset at ${now.toFormat("yyyy-MM-dd HH:mm")}`;

    console.log(message);

    await Notification.create({
      type: "system",
      message,
      status: "sent",
      sentAt: now.toJSDate(),
    });

    if (process.env.OPERATIONS_NUMBER) {
      await sendWhatsAppMessage(process.env.OPERATIONS_NUMBER, message);
    }
  } catch (err) {
    const errorMsg = `❌ Failed to reset daily orders: ${err.message}`;
    console.error(errorMsg);

    await Notification.create({
      type: "system",
      message: errorMsg,
      status: "failed",
    });

    if (process.env.OPERATIONS_NUMBER) {
      await sendWhatsAppMessage(process.env.OPERATIONS_NUMBER, errorMsg);
    }
  }
});

// Weekly reset at Lagos Sunday midnight
cron.schedule("0 0 * * 0", async () => {
  console.log("🔄 Resetting weekly employee orders...");
  const now = DateTime.now().setZone("Africa/Lagos");

  try {
    await Employee.updateMany({}, { $set: { weeklyOrders: 0 } });

    const message = `✅ Weekly employee orders reset at ${now.toFormat("yyyy-MM-dd HH:mm")}`;

    console.log(message);

    await Notification.create({
      type: "system",
      message,
      status: "sent",
      sentAt: now.toJSDate(),
    });

    if (process.env.OPERATIONS_NUMBER) {
      await sendWhatsAppMessage(process.env.OPERATIONS_NUMBER, message);
    }
  } catch (err) {
    const errorMsg = `❌ Failed to reset weekly orders: ${err.message}`;
    console.error(errorMsg);

    await Notification.create({
      type: "system",
      message: errorMsg,
      status: "failed",
    });

    if (process.env.OPERATIONS_NUMBER) {
      await sendWhatsAppMessage(process.env.OPERATIONS_NUMBER, errorMsg);
    }
  }
});
