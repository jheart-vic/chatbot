import cron from "node-cron";
import { DateTime } from "luxon";
import Employee from "../models/Employee.js";

// Daily reset at Lagos midnight
cron.schedule("0 0 * * *", async () => {
  console.log("🔄 Resetting daily employee orders...");
  try {
    await Employee.updateMany({}, { $set: { dailyOrders: 0 } });
    console.log("✅ Daily orders reset at", DateTime.now().setZone("Africa/Lagos").toISO());
  } catch (err) {
    console.error("❌ Error resetting daily orders:", err);
  }
});

// Weekly reset at Lagos Sunday midnight
cron.schedule("0 0 * * 0", async () => {
  console.log("🔄 Resetting weekly employee orders...");
  try {
    await Employee.updateMany({}, { $set: { weeklyOrders: 0 } });
    console.log("✅ Weekly orders reset at", DateTime.now().setZone("Africa/Lagos").toISO());
  } catch (err) {
    console.error("❌ Error resetting weekly orders:", err);
  }
});
