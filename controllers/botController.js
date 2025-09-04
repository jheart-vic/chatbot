// controllers/botController.js
import { detectIntent, parseOrderIntent, processUserMessage } from "../helpers/openAi.js";
import { sendWhatsAppMessage } from "../helpers/whatsApp.js";
import User from "../models/User.js";
import Order from "../models/Order.js";
import Message from "../models/Message.js";

export const handleIncomingMessage = async ({ from, text, profile }, res) => {
  try {
    // 1️⃣ Ensure user exists
    let user = await User.findOne({ phone: from });
    if (!user) {
      user = await User.create({
        phone: from,
        fullName: profile?.name || "WhatsApp User",
        loyaltyBalance: 0,
        totalOrders: 0,
      });
      console.log(`👤 New user created: ${user.fullName} (${from})`);
    }

    // 2️⃣ Smart onboarding
    if (!user.fullName || !user.address) {
      const lines = text.split("\n").map((l) => l.trim());
      if (lines.length >= 2) {
        user.fullName = user.fullName || lines[0];
        user.address = user.address || lines[1];
        user.preferences = user.preferences || { fragrance: lines[2] || "" };
        await user.save();

        await sendWhatsAppMessage(
          from,
          `✅ Thanks ${user.fullName}! Your details are saved.\n\nYou can now place orders like: *Wash 3 shirts and 2 trousers*.`
        );
      } else {
        await sendWhatsAppMessage(
          from,
          "👋 Please send your *full name*, *address*, and *preferences* (fragrance, folding, ironing).\n\nFormat:\nJohn Doe\n123 Main Street\nVanilla fragrance"
        );
      }
      return res.sendStatus(200);
    }

    // 3️⃣ Save user message
    await Message.create({ userId: user._id, from: "user", text });

    // 4️⃣ Detect intent
    const intent = detectIntent(text);
    console.log("👉 Detected intent:", intent);

    let botReply = "";

    switch (intent) {
      case "create_order": {
        // ✅ Regex parser first (handles 40, twenty, etc.)
        let parsed = parseOrderIntent(text);

        // ⚠️ AI fallback only if regex fails
        if (!parsed.items || parsed.items.length === 0) {
          try {
            let response = await processUserMessage(
              user._id,
              `Extract items and quantities from this laundry order: "${text}". Reply in JSON format like {"items":[{"name":"shirts","quantity":3}]}`
            );
            parsed = JSON.parse(response);
          } catch (err) {
            if (err.message.includes("429")) {
              console.warn("⚠️ OpenAI quota exceeded — skipping AI fallback.");
            } else {
              console.error("❌ parseOrderIntent fallback failed:", err.message);
            }
            parsed = { items: [] }; // fail safe
          }
        }

        if (parsed.items && parsed.items.length > 0) {
          const pricePerItem = 500;
          const subtotal = parsed.items.reduce(
            (sum, i) => sum + i.quantity * pricePerItem,
            0
          );

          const order = await Order.create({
            userId: user._id,
            items: parsed.items,
            status: "Pending",
            price: subtotal,
            dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
          });

          user.loyaltyBalance += subtotal * 0.015;
          user.totalOrders += 1;
          await user.save();

          botReply = `✅ Order placed!\n\n🧺 Items:\n${parsed.items
            .map((i) => `- ${i.quantity} ${i.name}`)
            .join("\n")}\n💵 Total: ₦${subtotal}\n📅 Ready by: ${order.dueDate.toDateString()}\n🎁 Loyalty earned: ₦${(
            subtotal * 0.015
          ).toFixed(2)}`;
        } else {
          botReply =
            "🤔 I couldn’t detect your order. Please try again with details like: *Wash 3 shirts and 2 trousers*.";
        }
        break;
      }

      case "track_order": {
        const lastOrder = await Order.findOne({ userId: user._id }).sort({
          createdAt: -1,
        });
        botReply = lastOrder
          ? `📦 Your last order is currently: *${lastOrder.status}*`
          : "❌ You have no active orders.";
        break;
      }

      case "check_loyalty":
        botReply = `🎁 You have ₦${user.loyaltyBalance.toFixed(
          2
        )} in loyalty cashback.`;
        break;

      case "greeting":
        botReply = `👋 Hi ${user.fullName}! I’m CHUVI, your laundry assistant. You can place an order, track it, or check your loyalty balance.`;
        if (user.preferences?.fragrance) {
          botReply += `\n✨ I remember you like ${user.preferences.fragrance}.`;
        }
        break;

      default:
        botReply = await processUserMessage(user._id, text); // AI fallback
    }

    // 5️⃣ Send reply
    await sendWhatsAppMessage(from, botReply);

    // 6️⃣ Log bot reply
    await Message.create({ userId: user._id, from: "bot", text: botReply });

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Bot Error:", err);
    res.sendStatus(500);
  }
};
