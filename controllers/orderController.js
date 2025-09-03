import Order from "../models/Order.js";
import User from "../models/User.js";
import Notification from "../models/Notification.js";
import { sendWhatsAppMessage } from "../helpers/whatsApp.js";

export const createOrder = async (req, res) => {
  try {
    const { phone, items, price, dueDate } = req.body;
    const user = await User.findOne({ phone });

    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const order = await Order.create({
      userId: user._id,
      items,
      price,
      dueDate,
      status: "Pending",
    });

    // Loyalty cashback (1.5%)
    user.loyaltyBalance += price * 0.015;
    user.totalOrders += 1;
    await user.save();

    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, delayReason } = req.body;

    const order = await Order.findByIdAndUpdate(
      id,
      { status, delayReason },
      { new: true }
    ).populate("userId");

    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    // 🔔 Notify user when Ready or Delivered
    if (status === "Ready") {
      const msg = `Hi ${order.userId.fullName}, your laundry order is ready for pickup/delivery.`;
      await Notification.create({ userId: order.userId._id, type: "ready", message: msg });
      await sendWhatsAppMessage(order.userId.phone, msg);
    }

    if (status === "Delivered") {
      const msg = `Hi ${order.userId.fullName}, your order has been delivered. 🙏 Please rate our service (1–5).`;
      await Notification.create({ userId: order.userId._id, type: "delivered", message: msg });
      await sendWhatsAppMessage(order.userId.phone, msg);
    }

    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const order = await Order.findById(id).populate("userId");
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    res.json({ success: true, status: order.status, order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
