// // jobs/employeeJob.js
// import Employee from "../models/Employee.js";

// // Reset daily orders every midnight
// export async function resetDailyOrders() {
//   await Employee.updateMany({}, { dailyOrders: 0 });
// }

// // Reset weekly orders every Sunday midnight
// export async function resetWeeklyOrders() {
//   await Employee.updateMany({}, { weeklyOrders: 0 });
// }

// jobs/employeeJob.js
import cron from "node-cron";
import Employee from "../models/Employee.js";

/**
 * Employee Job
 * - Reset daily orders count every midnight
 * - Reset weekly orders every Sunday at midnight
 */

// Daily reset
cron.schedule("0 0 * * *", async () => {
  console.log("🔄 Resetting daily employee orders...");
  try {
    await Employee.updateMany({}, { $set: { dailyOrders: 0 } });
    console.log("✅ Daily orders reset.");
  } catch (err) {
    console.error("❌ Error resetting daily orders:", err);
  }
});

// Weekly reset (Sunday 00:00)
cron.schedule("0 0 * * 0", async () => {
  console.log("🔄 Resetting weekly employee orders...");
  try {
    await Employee.updateMany({}, { $set: { weeklyOrders: 0 } });
    console.log("✅ Weekly orders reset.");
  } catch (err) {
    console.error("❌ Error resetting weekly orders:", err);
  }
});
