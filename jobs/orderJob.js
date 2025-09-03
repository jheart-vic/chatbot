// jobs/orderJob.js
import cron from "node-cron";
import Order from "../models/Order.js";
import User from "../models/User.js";
import Notification from "../models/Notification.js";
import StaffAlert from "../models/StaffAlert.js";
import { sendWhatsAppMessage } from "../helpers/whatsApp.js";

/**
 * Order Scheduler Job
 * Runs daily at 9 AM:
 *  1️⃣ Remind customers about overdue orders
 *  2️⃣ Notify staff about overdue orders
 *  3️⃣ Inform customers when orders are ready for pickup
 *  4️⃣ Request feedback for delivered orders with no feedback yet
 */
cron.schedule("0 9 * * *", async () => {
  console.log("🔔 Running daily order job...");

  try {
    const now = new Date();

    // 1️⃣ Overdue Orders
    const overdueOrders = await Order.find({
      dueDate: { $lt: now },
      status: { $ne: "Delivered" },
    }).populate("userId");

    for (let order of overdueOrders) {
      const user = order.userId;

      const message = `⚠️ Hi ${user.fullName || user.phone},
Your order of ₦${order.price} placed on ${order.createdAt.toDateString()} is *overdue*.
Reason: ${order.delayReason !== "none" ? order.delayReason : "processing delay"}.
We’re working to resolve this.`;

      await Notification.create({ userId: user._id, type: "overdue", message });
      await sendWhatsAppMessage(user.phone, message);

      // Staff alert
      await StaffAlert.create({
        orderId: order._id,
        type: "order-delay",
        message: `⚠️ Order #${order._id} for ${user.fullName} is overdue! Status: ${order.status}.`,
      });
    }

    // 2️⃣ Ready-for-Pickup Orders
    const readyOrders = await Order.find({ status: "Ready" }).populate("userId");
    for (let order of readyOrders) {
      const user = order.userId;
      const message = `✅ Hi ${user.fullName || user.phone},
Your laundry order of ₦${order.price} is *ready for pickup*.
📍 Please collect it at your convenience.`;

      await Notification.create({ userId: user._id, type: "ready", message });
      await sendWhatsAppMessage(user.phone, message);
    }

    // 3️⃣ Delivered Orders (feedback follow-up)
    const deliveredOrders = await Order.find({
      status: "Delivered",
      deliveredAt: { $lte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // delivered > 24h ago
    })
      .populate("userId")
      .lean();

    for (let order of deliveredOrders) {
      const existingFeedback = await Notification.findOne({
        userId: order.userId._id,
        type: "feedback",
        "meta.orderId": order._id,
      });

      if (!existingFeedback) {
        const message = `🙏 Hi ${order.userId.fullName || order.userId.phone},
We hope you enjoyed our service! Please rate your last order #${order._id} from 1-5 ⭐ and share any comments.`;

        await Notification.create({
          userId: order.userId._id,
          type: "feedback",
          message,
          meta: { orderId: order._id },
        });

        await sendWhatsAppMessage(order.userId.phone, message);
      }
    }

    console.log(
      `✅ Job complete: ${overdueOrders.length} overdue, ${readyOrders.length} ready, ${deliveredOrders.length} feedback reminders sent.`
    );
  } catch (err) {
    console.error("❌ Error in daily order job:", err);
  }
});
