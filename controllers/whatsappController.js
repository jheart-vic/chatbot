import User from "../models/User.js";
import Order from "../models/Order.js";
import Notification from "../models/Notification.js";
import { sendWhatsAppMessage } from "../helpers/whatsApp.js";
import { parseOrderIntent } from "../helpers/openAi.js";

export const handleIncomingMessage = async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];
    const contact = value?.contacts?.[0];

    if (!message) {
      return res.sendStatus(200); // nothing to process
    }

    const from = message.from;                     // sender’s WhatsApp number
    const body = message.text?.body || "";         // message text
    const profile = contact?.profile || {};        // user profile

    console.log("📩 Incoming:", { from, body, profile });

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

    // 2️⃣ Onboarding
    if (!user.fullName || !user.address || !user.preferences?.fragrance) {
      reply =
        "👋 Welcome to CHUVI Laundry! Please send your *full name*, *address*, and *preferences* (e.g. fragrance, folding style, ironing).";
      await sendWhatsAppMessage(from, reply);
      return res.sendStatus(200);
    }

    const text = body.toLowerCase();

    // 3️⃣ Handle order
    if (text.includes("order") || text.includes("wash")) {
      const parsed = await parseOrderIntent(body);

      if (parsed.items.length > 0) {
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
          dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        });

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

    // 4️⃣ Handle status
    else if (text.includes("status")) {
      const order = await Order.findOne({ userId: user._id }).sort({
        createdAt: -1,
      });

      reply = order
        ? `📦 Hi ${user.fullName}, your last order is currently: *${order.status}*`
        : "❌ You don’t have any active orders.";
    }

    // 5️⃣ Handle loyalty
    else if (text.includes("loyalty") || text.includes("points")) {
      reply = `🎁 Hi ${user.fullName}, you have ₦${user.loyaltyBalance.toFixed(
        2
      )} in loyalty cashback.`;
    }

    // 6️⃣ Fallback
    else {
      reply =
        "👋 Hi! I’m CHUVI, your laundry assistant.\n\nYou can say:\n- 'Order 3 shirts'\n- 'Check status'\n- 'Loyalty balance'";
    }

    await sendWhatsAppMessage(from, reply);

    await Notification.create({
      userId: user._id,
      type: "chat",
      message: reply,
    });

    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Error handling WhatsApp message:", error);
    res.sendStatus(500);
  }
};

