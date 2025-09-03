import Notification from "../models/Notification.js";
import User from "../models/User.js";
import Order from "../models/Order.js";
import { sendWhatsAppMessage } from "../helpers/whatsApp.js";

export const sendNotification = async (req, res) => {
  try {
    const { userId, type, orderId, customMessage } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    let message = customMessage;

    // If it's overdue or ready, personalize
    if (orderId) {
      const order = await Order.findById(orderId);
      if (order) {
        if (type === "overdue") {
          message = `Hi ${user.fullName}, your order of ₦${order.price} placed on ${order.createdAt.toDateString()} is overdue. Reason: ${order.delayReason}.`;
        } else if (type === "ready") {
          message = `Hi ${user.fullName}, your laundry order is ready for pickup/delivery.`;
        }
      }
    }

    const notification = await Notification.create({ userId, type, message });

    // Actually send via WhatsApp
    await sendWhatsAppMessage(user.phone, message);

    res.json({ success: true, notification });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
