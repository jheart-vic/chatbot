// jobs/financialJob.js
import cron from "node-cron";
import Order from "../models/Order.js";
import Finance from "../models/Finance.js";
import Expense from "../models/Expense.js";

cron.schedule("5 0 * * *", async () => {
  console.log("💰 Running daily financial summary job...");

  try {
    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const endOfDay = new Date(today.setHours(23, 59, 59, 999));

    // 1️⃣ Get revenue
    const orders = await Order.find({
      createdAt: { $gte: startOfDay, $lte: endOfDay },
    });
    const revenue = orders.reduce((sum, order) => sum + order.price, 0);

    // 2️⃣ Get expenses
    const expensesDocs = await Expense.find({
      date: { $gte: startOfDay, $lte: endOfDay },
    });
    const expenses = expensesDocs.reduce((sum, e) => sum + e.amount, 0);

    // 3️⃣ Profit
    const profit = revenue - expenses;

    // 4️⃣ Breakdown by service type
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

    console.log(
      `✅ Financial snapshot saved: Revenue ₦${revenue}, Expenses ₦${expenses}, Profit ₦${profit}`
    );
  } catch (err) {
    console.error("❌ Error in financial job:", err);
  }
});
