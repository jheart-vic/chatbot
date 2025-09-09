// jobs/orderJob.js
import cron from "node-cron";
import { DateTime } from "luxon";
import Order from "../models/Order.js";
import User from "../models/User.js";
import Notification from "../models/Notification.js";
import StaffAlert from "../models/StaffAlert.js";
import { sendWhatsAppMessage } from "../helpers/whatsApp.js";

/**
 * Daily Order Job
 * Runs every day at 9 AM Africa/Lagos
 *  1️⃣ Remind customers about overdue orders
 *  2️⃣ Notify staff about overdue orders
 *  3️⃣ Inform customers when orders are ready for pickup
 *  4️⃣ Request feedback for delivered orders with no feedback yet
 */
cron.schedule("0 9 * * *", async () => {
  console.log("🔔 Running daily order job...");

  try {
    const now = DateTime.now().setZone("Africa/Lagos");

    /**
     * 1️⃣ Overdue Orders
     * - Customer gets WhatsApp + Notification
     * - Staff gets StaffAlert
     */
    const overdueOrders = await Order.find({
      dueDate: { $lt: now.toJSDate() },
      status: { $ne: "Delivered" },
    }).populate("userId");

    for (let order of overdueOrders) {
      const user = order.userId;

      // Customer message
      const customerMsg = `⚠️ Hi ${user.fullName || user.phone},
Your order of ₦${order.price} placed on ${DateTime.fromJSDate(order.createdAt)
        .setZone("Africa/Lagos")
        .toFormat("dd LLL yyyy")} is *overdue*.
Reason: ${order.delayReason !== "none" ? order.delayReason : "processing delay"}.
We’re working to resolve this.`.trim();

      await Notification.create({
        userId: user._id,
        type: "overdue",
        message: customerMsg,
        createdAt: now.toJSDate(),
      });

      await sendWhatsAppMessage(user.phone, customerMsg);

      // Staff alert
      const staffMsg = `⚠️ Order #${order._id} for ${user.fullName || user.phone} is overdue! Status: ${order.status}.`;

      await StaffAlert.create({
        orderId: order._id,
        type: "order-delay",
        message: staffMsg,
        createdAt: now.toJSDate(),
      });

      // Optional: also WhatsApp staff group
      if (process.env.STAFF_GROUP_NUMBER) {
        await sendWhatsAppMessage(process.env.STAFF_GROUP_NUMBER, staffMsg);
      }
    }

    /**
     * 2️⃣ Ready-for-Pickup Orders
     * - Only customer gets notified
     */
    const readyOrders = await Order.find({ status: "Ready" }).populate("userId");
    for (let order of readyOrders) {
      const user = order.userId;
      const readyMsg = `✅ Hi ${user.fullName || user.phone},
Your laundry order of ₦${order.price} is *ready for pickup*.
📍 Please collect it at your convenience.`.trim();

      await Notification.create({
        userId: user._id,
        type: "ready",
        message: readyMsg,
        createdAt: now.toJSDate(),
      });

      await sendWhatsAppMessage(user.phone, readyMsg);
    }

    /**
     * 3️⃣ Delivered Orders (Feedback follow-up)
     * - Customer gets request if no feedback exists after 24h
     */
    const deliveredOrders = await Order.find({
      status: "Delivered",
      deliveredAt: { $lte: now.minus({ hours: 24 }).toJSDate() }, // delivered > 24h ago
    }).populate("userId");

    for (let order of deliveredOrders) {
      const existingFeedback = await Notification.findOne({
        userId: order.userId._id,
        type: "feedback",
        "meta.orderId": order._id,
      });

      if (!existingFeedback) {
        const feedbackMsg = `🙏 Hi ${order.userId.fullName || order.userId.phone},
We hope you enjoyed our service! Please rate your last order #${order._id} from 1-5 ⭐ and share any comments.`.trim();

        await Notification.create({
          userId: order.userId._id,
          type: "feedback",
          message: feedbackMsg,
          meta: { orderId: order._id },
          createdAt: now.toJSDate(),
        });

        await sendWhatsAppMessage(order.userId.phone, feedbackMsg);
      }
    }

    console.log(
      `✅ Job complete: ${overdueOrders.length} overdue, ${readyOrders.length} ready, ${deliveredOrders.length} feedback reminders sent.`
    );
  } catch (err) {
    console.error("❌ Error in daily order job:", err);
  }
});
