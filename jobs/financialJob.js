// jobs/financeJob.js
import cron from "node-cron";
import { DateTime } from "luxon";
import Order from "../models/Order.js";
import Expense from "../models/Expense.js";
import Finance from "../models/Finance.js";
import MonthlyFinance from "../models/MonthlyFinance.js";
import Notification from "../models/Notification.js";
import { sendWhatsAppMessage } from "../helpers/whatsApp.js"; // assuming you have this


/**
 * 🕒 Daily Finance Job
 * Runs every day at 00:05 Lagos time
 */
cron.schedule("5 0 * * *", async () => {
  const now = DateTime.now().setZone("Africa/Lagos");
  console.log("💰 Running daily finance job at", now.toISO());

  try {
    const startOfDay = now.startOf("day").toJSDate();
    const endOfDay = now.endOf("day").toJSDate();

    // 1️⃣ Revenue
    const orders = await Order.find({ createdAt: { $gte: startOfDay, $lte: endOfDay } });
    const revenue = orders.reduce((sum, o) => sum + o.price, 0);

    // 2️⃣ Expenses
    const expenseDocs = await Expense.find({ date: { $gte: startOfDay, $lte: endOfDay } });
    const expenses = expenseDocs.reduce((sum, e) => sum + e.amount, 0);

    // 3️⃣ Profit
    const profit = revenue - expenses;

    // 4️⃣ Breakdown
    const breakdown = {};
    for (let order of orders) {
      for (let item of order.items) {
        breakdown[item] = (breakdown[item] || 0) + order.price;
      }
    }

    // 5️⃣ Save snapshot
    await Finance.create({
      date: startOfDay,
      revenue,
      expenses,
      profit,
      breakdown: Object.entries(breakdown).map(([service, amount]) => ({
        service,
        amount,
      })),
    });

    const message = `📅 Daily Finance Report (${now.toFormat("yyyy-MM-dd")})\n` +
      `Revenue: ₦${revenue}\n` +
      `Expenses: ₦${expenses}\n` +
      `Profit: ₦${profit}`;

    console.log(`✅ Daily finance saved: ${message}`);

    // 🔔 Save notification
    await Notification.create({
      type: "daily_finance",
      message,
      status: "sent",
      sentAt: now.toJSDate(),
    });

    // 🔔 Optionally send to WhatsApp
    if (process.env.OPERATIONS_NUMBER) {
      await sendWhatsAppMessage(process.env.OPERATIONS_NUMBER, message);
    }
  } catch (err) {
    console.error("❌ Error in daily finance job:", err);
  }
});


/**
 * 📊 Monthly Finance Job
 * Runs on the 1st of each month at 00:10 Lagos time
 */
cron.schedule("10 0 1 * *", async () => {
  const now = DateTime.now().setZone("Africa/Lagos");
  const lastMonth = now.minus({ months: 1 });

  console.log("📊 Running monthly finance job for", lastMonth.toFormat("yyyy-MM"));

  try {
    const monthKey = lastMonth.toFormat("yyyy-MM");
    const start = lastMonth.startOf("month").toJSDate();
    const end = lastMonth.endOf("month").toJSDate();

    // 1️⃣ Get daily snapshots
    const dailySnapshots = await Finance.find({ date: { $gte: start, $lte: end } });

    // 2️⃣ Totals
    const revenue = dailySnapshots.reduce((s, d) => s + d.revenue, 0);
    const expenses = dailySnapshots.reduce((s, d) => s + d.expenses, 0);
    const profit = revenue - expenses;

    // 3️⃣ Breakdown
    const breakdown = {};
    for (let snap of dailySnapshots) {
      for (let item of snap.breakdown) {
        breakdown[item.service] = (breakdown[item.service] || 0) + item.amount;
      }
    }

    // 4️⃣ Save monthly snapshot
    await MonthlyFinance.findOneAndUpdate(
      { month: monthKey },
      {
        revenue,
        expenses,
        profit,
        breakdown: Object.entries(breakdown).map(([service, amount]) => ({
          service,
          amount,
        })),
      },
      { upsert: true, new: true }
    );

    const message = `📊 Monthly Finance Report (${monthKey})\n` +
      `Revenue: ₦${revenue}\n` +
      `Expenses: ₦${expenses}\n` +
      `Profit: ₦${profit}`;

    console.log(`✅ Monthly snapshot saved for ${monthKey}`);

    // 🔔 Save notification
    await Notification.create({
      type: "monthly_finance",
      message,
      status: "sent",
      sentAt: now.toJSDate(),
    });

    // 🔔 Optionally send to WhatsApp
    if (process.env.OPERATIONS_NUMBER) {
      await sendWhatsAppMessage(process.env.OPERATIONS_NUMBER, message);
    }
  } catch (err) {
    console.error("❌ Error in monthly finance job:", err);
  }
});
