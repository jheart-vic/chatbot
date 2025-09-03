import cron from "node-cron";
import Order from "../models/Order.js";
import User from "../models/User.js";
import { sendWhatsAppMessage } from "../helpers/whatsApp.js";
import Notification from "../models/Notification.js";

// Runs every day at 9am
cron.schedule("0 9 * * *", async () => {
  console.log("🔔 Running reminder job...");

  const now = new Date();

  // 1️⃣ Find overdue orders
  const overdueOrders = await Order.find({
    status: { $ne: "Delivered" },
    dueDate: { $lt: now }
  });

  for (let order of overdueOrders) {
    const user = await User.findById(order.userId);

    const msg = `⚠️ Hi ${user.name || user.phone},
Your order of ₦${order.price} placed on ${order.createdAt.toDateString()}
is *overdue* because it's still in stage: ${order.status}.
We apologize for the delay.`;

    await sendWhatsAppMessage(user.phone, msg);
    await Notification.create({
      userId: user._id,
      type: "reminder",
      message: personalizedMessage,
    });
  }
  // 2️⃣ Find orders ready for pickup
  const readyOrders = await Order.find({
    status: "Ready"
  });

  for (let order of readyOrders) {
    const user = await User.findById(order.userId);

    const msg = `✅ Hi ${user.name || user.phone},
Your laundry order of ₦${order.price} is *ready for pickup*.`;

    await sendWhatsAppMessage(user.phone, msg);
await Notification.create({
  userId: user._id,
  type: "reminder",
  message: personalizedMessage,
});
  }
});
