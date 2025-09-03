// controllers/botController.js
import { detectIntent, parseOrderIntent, processUserMessage } from "../helpers/openAi.js";
import { sendWhatsAppMessage } from "../helpers/whatsApp.js";
import Order from "../models/Order.js";
import User from "../models/User.js";
import Message from "../models/Message.js";
import Feedback from "../models/Feedback.js";
import StaffAlert from "../models/StaffAlert.js";

export const handleIncomingMessage = async (req, res) => {
  const { from, text, profile } = req.body; // phone number, message, WhatsApp profile
  console.log(`📩 New message from ${from}: ${text}`);

  try {
    // 1️⃣ Ensure user exists or create new
    let user = await User.findOne({ phone: from });
    if (!user) {
      user = await User.create({
        phone: from,
        fullName: profile?.name || "WhatsApp User",
        loyaltyBalance: 0,
        isOnboarded: false,
      });
      console.log(`👤 New user created: ${user.fullName} (${from})`);
    }

    // 2️⃣ Check onboarding
    if (!user.fullName || !user.address) {
      await sendWhatsAppMessage(
        from,
        "👋 Welcome to CHUVI! Please reply with your *full name* and *address* to complete onboarding."
      );
      return res.json({ success: true });
    }

    // 3️⃣ Save user message
    await Message.create({ userId: user._id, from: "user", text });

    // 4️⃣ Detect intent
    const intent = detectIntent(text);
    console.log("👉 Detected intent:", intent);

    let botReply = "";

    switch (intent) {
      case "create_order": {
        const parsed = parseOrderIntent(text);
        if (parsed.items.length > 0) {
          const pricePerItem = 500; // Example pricing
          const totalAmount = parsed.items.reduce(
            (sum, i) => sum + i.quantity * pricePerItem,
            0
          );

          const order = await Order.create({
            userId: user._id,
            items: parsed.items,
            status: "Pending",
            price: totalAmount,
            dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days
          });

          // Loyalty cashback 1.5%
          user.loyaltyBalance += totalAmount * 0.015;
          user.totalOrders += 1;
          await user.save();

          botReply = `✅ Order placed!\n\nItems:\n${parsed.items
            .map((i) => `- ${i.quantity} ${i.name}`)
            .join("\n")}\n💵 Total: ₦${totalAmount}\n📅 Ready by: ${order.dueDate.toDateString()}`;
        } else {
          botReply =
            "🤔 I didn’t catch your order details. Try: 'Wash 3 shirts and 2 trousers'.";
        }
        break;
      }

      case "track_order": {
        const lastOrder = await Order.findOne({ userId: user._id }).sort({ createdAt: -1 });
        if (!lastOrder) {
          botReply = "❌ You have no active orders.";
        } else {
          botReply = `📦 Your last order is currently: *${lastOrder.status}*`;
          if (lastOrder.status === "Delivered") {
            botReply +=
              "\n🙏 We’d love your feedback! Reply with a rating from 1–5 (and comments if any).";
          }
        }
        break;
      }

      case "check_loyalty":
        botReply = `🎁 You have ₦${user.loyaltyBalance.toFixed(
          2
        )} in loyalty cashback (1.5% of past orders).`;
        break;

      case "greeting":
        botReply = `👋 Hi ${user.fullName}! I’m CHUVI, your laundry assistant. You can place an order, track it, or check your loyalty balance.`;
        if (user.preferences?.fragrance) {
          botReply += `\n✨ I remember you like ${user.preferences.fragrance}.`;
        }
        break;

      default:
        // 5️⃣ Free chat → AI fallback
        botReply = await processUserMessage(user._id, text);
    }

    // 6️⃣ Send and log bot reply
    await sendWhatsAppMessage(from, botReply);
    await Message.create({ userId: user._id, from: "bot", text: botReply });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Bot Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// 🚨 Helper: Trigger staff alert
export const triggerOrderDelayAlert = async (order, reason = "order-delay") => {
  try {
    await StaffAlert.create({
      orderId: order._id,
      type: reason,
      message: `⚠️ Order ${order._id} for customer ${order.userId} is overdue. Reason: ${order.delayReason}`,
      priority: "high",
    });
    console.log("🚨 Staff alert created for overdue order:", order._id);
  } catch (err) {
    console.error("❌ Error creating staff alert:", err);
  }
};
