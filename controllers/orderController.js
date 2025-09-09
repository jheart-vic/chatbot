// controllers/orderController.js
import Order from "../models/Order.js";
import User from "../models/User.js";
import Notification from "../models/Notification.js";
import { sendWhatsAppMessage } from "../helpers/whatsApp.js";
import { calculatePrice } from "../helpers/pricing.js";
import { assignEmployee } from "../helpers/employeeAssignment.js";


/**
 * 🔹 Create Order (bot handles notifications)
 */
// export const createOrder = async (req, res) => {
//   try {
//     const { phone, items, turnaround = "standard", distanceKm = 0, dueDate } = req.body;

//     const user = await User.findOne({ phone });
//     if (!user) return res.status(404).json({ success: false, message: "User not found" });

//     // ✅ Calculate price & enforce schema structure
//     const { subtotal, deliveryFee, total, warnings, missingServices } = calculatePrice(
//       items,
//       turnaround,
//       distanceKm
//     );

//     if (missingServices.length > 0) {
//       return res.status(400).json({
//         success: false,
//         message: `Missing service type for: ${missingServices.join(", ")}`
//       });
//     }

//     // Build items with unitPrice & lineTotal
//     const enrichedItems = items.map(i => ({
//       name: i.name,
//       quantity: i.quantity,
//       service: i.service,
//       unitPrice: i.unitPrice || (i.lineTotal ? i.lineTotal / i.quantity : subtotal / i.quantity),
//       lineTotal: i.lineTotal || (i.unitPrice || subtotal / i.quantity) * i.quantity
//     }));

//     const order = await Order.create({
//       userId: user._id,
//       items: enrichedItems,
//       price: total,
//       dueDate,
//       status: "Pending"
//     });

//     // Loyalty cashback (1.5%)
//     const loyalty = total * 0.015;
//     user.loyaltyBalance += loyalty;
//     user.totalOrders += 1;
//     await user.save();

//     // 🚫 No WhatsApp message here — handled by the bot
//     res.json({ success: true, order, warnings });
//   } catch (err) {
//     res.status(500).json({ success: false, message: err.message });
//   }
// };




export const createOrder = async (req, res) => {
  try {
    const { phone, items, turnaround = "standard", distanceKm = 0, dueDate } = req.body;
    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const { subtotal, deliveryFee, total, warnings, missingServices } = calculatePrice(
      items,
      turnaround,
      distanceKm
    );

    if (missingServices.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing service type for: ${missingServices.join(", ")}`
      });
    }

    // Build items with unitPrice & lineTotal
    const enrichedItems = items.map(i => ({
      name: i.name,
      quantity: i.quantity,
      service: i.service,
      unitPrice: i.unitPrice || 0,
      lineTotal: (i.unitPrice || 0) * i.quantity
    }));

    // Decide role for assignment
    let role = null;
    if (enrichedItems.some(i => i.service === "washIron" || i.service === "washFold")) {
      role = "washer";
    } else if (enrichedItems.some(i => i.service === "ironOnly")) {
      role = "ironer";
    }

    const employee = role ? await assignEmployee(role) : null;

    const order = await Order.create({
      userId: user._id,
      items: enrichedItems,
      price: total,
      dueDate,
      status: "Pending",
      assignedTo: employee?._id || null
    });

    // Loyalty update
    const loyalty = total * 0.015;
    user.loyaltyBalance += loyalty;
    user.totalOrders += 1;
    await user.save();

    res.json({ success: true, order, warnings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * 🔹 Update Order Status (admins trigger notifications here)
 */
export const updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, delayReason } = req.body;

    // ✅ Load order normally (not findByIdAndUpdate) so we can modify safely
    const order = await Order.findById(id).populate("userId");
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    const prevStatus = order.status;

    order.status = status || order.status;
    if (delayReason) order.delayReason = delayReason;

    // 🚚 Auto-assign delivery staff if order is ready
    if (status === "Ready" && !order.assignedTo) {
      const deliveryStaff = await assignEmployee("delivery");
      if (deliveryStaff) order.assignedTo = deliveryStaff._id;
    }

    await order.save(); // 🔥 ensures hooks & assignment persist

    // 🔔 Notify only if status changed
    if (status === "Ready" && prevStatus !== "Ready") {
      const msg = `Hi ${order.userId.fullName}, your laundry order is ready for pickup/delivery.`;
      await Notification.create({ userId: order.userId._id, type: "ready", message: msg });
      await sendWhatsAppMessage(order.userId.phone, msg);
    }

    if (status === "Delivered" && prevStatus !== "Delivered") {
      const msg = `Hi ${order.userId.fullName}, your order has been delivered. 🙏 Please rate our service (1–5).`;
      await Notification.create({ userId: order.userId._id, type: "delivered", message: msg });
      await sendWhatsAppMessage(order.userId.phone, msg);
    }

    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

