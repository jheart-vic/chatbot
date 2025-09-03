import User from "../models/User.js";
import Order from "../models/Order.js";
import Notification from "../models/Notification.js";
import { sendWhatsAppMessage } from "../helpers/whatsApp.js";
import { parseOrderIntent } from "../helpers/openAi.js";

export const handleIncomingMessage = async (req, res) => {
  try {
    const { from, body, profile } = req.body; // profile may contain WhatsApp name
    const text = body.toLowerCase();
    let reply = "";

    // 1️⃣ Find or create user
    let user = await User.findOne({ phone: from });
    if (!user) {
      user = await User.create({
        fullName: profile?.name || "WhatsApp User",
        phone: from,
        loyaltyBalance: 0,
        totalOrders: 0,
      });
    }

    // Check onboarding completeness
    if (!user.fullName || !user.address || !user.preferences?.fragrance) {
      reply =
        "👋 Welcome to CHUVI Laundry! Please send your *full name*, *address*, and *preferences* (e.g. fragrance, folding style, ironing).";
      await sendWhatsAppMessage(from, reply);
      return res.json({ status: "ok" });
    }

    // 2️⃣ Handle order intent
    if (text.includes("order") || text.includes("wash")) {
      const parsed = await parseOrderIntent(body);

      if (parsed.items.length > 0) {
        // TODO: Replace with real pricing logic
        const pricePerItem = 500;
        const totalAmount = parsed.items.reduce(
          (sum, i) => sum + i.quantity * pricePerItem,
          0
        );

        const order = await Order.create({
          userId: user._id,
          items: parsed.items,
          status: "Pending",
          price: totalAmount,
          dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days later
        });

        // Loyalty cashback (1.5%)
        const earned = totalAmount * 0.015;
        user.loyaltyBalance += earned;
        user.totalOrders += 1;
        await user.save();

        reply = `✅ Hi ${user.fullName}, your order has been placed!\n\n🧺 Items:\n${parsed.items
          .map((i) => `- ${i.quantity} ${i.name}`)
          .join("\n")}\n💵 Total: ₦${totalAmount}\n📅 Ready by: ${order.dueDate.toDateString()}\n🎁 Loyalty earned: ₦${earned.toFixed(
          2
        )}`;
      } else {
        reply =
          "🤖 I didn’t catch your order details. Try: 'Wash 3 shirts and 2 trousers'.";
      }
    }

    // 3️⃣ Handle status requests
    else if (text.includes("status")) {
      const order = await Order.findOne({ userId: user._id }).sort({
        createdAt: -1,
      });

      if (order) {
        reply = `📦 Hi ${user.fullName}, your last order is currently: *${order.status}*`;
        if (order.status === "Ready") {
          await Notification.create({
            userId: user._id,
            type: "ready",
            message: reply,
          });
        }
      } else {
        reply = "❌ You don’t have any active orders.";
      }
    }

    // 4️⃣ Handle loyalty requests
    else if (text.includes("loyalty") || text.includes("points")) {
      reply = `🎁 Hi ${user.fullName}, you have ₦${user.loyaltyBalance.toFixed(
        2
      )} in loyalty cashback.`;
    }

    // 5️⃣ Fallback
    else {
      reply =
        "👋 Hi! I’m CHUVI, your laundry assistant.\n\nYou can say:\n- 'Order 3 shirts'\n- 'Check status'\n- 'Loyalty balance'";
    }

    // Send reply
    await sendWhatsAppMessage(from, reply);

    // Log notification
    await Notification.create({
      userId: user._id,
      type: "chat",
      message: reply,
    });

    res.json({ status: "ok" });
  } catch (error) {
    console.error("❌ Error handling WhatsApp message:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
