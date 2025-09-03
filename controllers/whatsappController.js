// import User from "../models/User.js";
// import Order from "../models/Order.js";
// import Notification from "../models/Notification.js";
// import { sendWhatsAppMessage } from "../helpers/whatsApp.js";
// import { parseOrderIntent } from "../helpers/openAi.js";

// export const handleIncomingMessage = async (req, res) => {
//   try {
//     const entry = req.body.entry?.[0];
//     const changes = entry?.changes?.[0];
//     const value = changes?.value;
//     const message = value?.messages?.[0];
//     const contact = value?.contacts?.[0];

//     if (!message) {
//       return res.sendStatus(200); // nothing to process
//     }

//     const from = message.from;                     // sender’s WhatsApp number
//     const body = message.text?.body || "";         // message text
//     const profile = contact?.profile || {};        // user profile

//     console.log("📩 Incoming:", { from, body, profile });

//     let reply = "";

//     // 1️⃣ Find or create user
//     let user = await User.findOne({ phone: from });
//     if (!user) {
//       user = await User.create({
//         fullName: profile?.name || "WhatsApp User",
//         phone: from,
//         loyaltyBalance: 0,
//         totalOrders: 0,
//       });
//     }

//     // 2️⃣ Onboarding
//     if (!user.fullName || !user.address || !user.preferences?.fragrance) {
//       reply =
//         "👋 Welcome to CHUVI Laundry! Please send your *full name*, *address*, and *preferences* (e.g. fragrance, folding style, ironing).";
//       await sendWhatsAppMessage(from, reply);
//       return res.sendStatus(200);
//     }

//     const text = body.toLowerCase();

//     // 3️⃣ Handle order
//     if (text.includes("order") || text.includes("wash")) {
//       const parsed = await parseOrderIntent(body);

//       if (parsed.items.length > 0) {
//         const pricePerItem = 500;
//         const totalAmount = parsed.items.reduce(
//           (sum, i) => sum + i.quantity * pricePerItem,
//           0
//         );

//         const order = await Order.create({
//           userId: user._id,
//           items: parsed.items,
//           status: "Pending",
//           price: totalAmount,
//           dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
//         });

//         const earned = totalAmount * 0.015;
//         user.loyaltyBalance += earned;
//         user.totalOrders += 1;
//         await user.save();

//         reply = `✅ Hi ${user.fullName}, your order has been placed!\n\n🧺 Items:\n${parsed.items
//           .map((i) => `- ${i.quantity} ${i.name}`)
//           .join("\n")}\n💵 Total: ₦${totalAmount}\n📅 Ready by: ${order.dueDate.toDateString()}\n🎁 Loyalty earned: ₦${earned.toFixed(
//           2
//         )}`;
//       } else {
//         reply =
//           "🤖 I didn’t catch your order details. Try: 'Wash 3 shirts and 2 trousers'.";
//       }
//     }

//     // 4️⃣ Handle status
//     else if (text.includes("status")) {
//       const order = await Order.findOne({ userId: user._id }).sort({
//         createdAt: -1,
//       });

//       reply = order
//         ? `📦 Hi ${user.fullName}, your last order is currently: *${order.status}*`
//         : "❌ You don’t have any active orders.";
//     }

//     // 5️⃣ Handle loyalty
//     else if (text.includes("loyalty") || text.includes("points")) {
//       reply = `🎁 Hi ${user.fullName}, you have ₦${user.loyaltyBalance.toFixed(
//         2
//       )} in loyalty cashback.`;
//     }

//     // 6️⃣ Fallback
//     else {
//       reply =
//         "👋 Hi! I’m CHUVI, your laundry assistant.\n\nYou can say:\n- 'Order 3 shirts'\n- 'Check status'\n- 'Loyalty balance'";
//     }

//     await sendWhatsAppMessage(from, reply);

//     await Notification.create({
//       userId: user._id,
//       type: "chat",
//       message: reply,
//     });

//     res.sendStatus(200);
//   } catch (error) {
//     console.error("❌ Error handling WhatsApp message:", error);
//     res.sendStatus(500);
//   }
// };


import { detectIntent, parseOrderIntent, processUserMessage } from "../helpers/openAi.js";
import { sendWhatsAppMessage } from "../helpers/whatsApp.js";
import User from "../models/User.js";
import Order from "../models/Order.js";
import Notification from "../models/Notification.js";


export const handleIncomingMessage = async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const message = entry?.changes?.[0]?.value?.messages?.[0];
    const contact = entry?.changes?.[0]?.value?.contacts?.[0];

    if (!message) return res.sendStatus(200);

    const from = message.from;
    const body = message.text?.body?.trim() || "";
    const profile = contact?.profile || {};

    let user = await User.findOne({ phone: from });
    if (!user) {
      user = await User.create({
        phone: from,
        fullName: profile?.name || "",
        loyaltyBalance: 0,
        totalOrders: 0,
      });
    }

    let reply;

    // 🔹 Smart onboarding
    if (!user.fullName || !user.address) {
      const lines = body.split("\n").map((l) => l.trim());
      if (lines.length >= 2) {
        user.fullName = user.fullName || lines[0];
        user.address = user.address || lines[1];
        user.preferences = user.preferences || { fragrance: lines[2] || "" };
        await user.save();

        reply = `✅ Thanks ${user.fullName}! Your details are saved.\n\nYou can now place orders like: *Wash 3 shirts and 2 trousers*.`;
      } else {
        reply =
          "👋 Please send your *full name*, *address*, and *preferences* (fragrance, folding, ironing).\n\nFormat:\nJohn Doe\n123 Main Street\nVanilla fragrance";
      }
      await sendWhatsAppMessage(from, reply);
      return res.sendStatus(200);
    }

    // 🔹 Step 1: Handle confirmation flow
    if (body.toLowerCase() === "confirm" && user.pendingOrder) {
      const { items, subtotal, delivery, payment, instructions } = user.pendingOrder;

      const order = await Order.create({
        userId: user._id,
        items,
        status: "Pending",
        price: subtotal,
        dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        delivery,
        payment,
        instructions,
      });

      user.loyaltyBalance += subtotal * 0.015;
      user.totalOrders += 1;
      user.pendingOrder = null; // clear pending
      await user.save();

      reply = `✅ Order confirmed!\n\n🧺 Items:\n${items
        .map((i) => `- ${i.quantity} ${i.name}`)
        .join("\n")}\n💵 Total: ₦${subtotal}\n📅 Ready by: ${order.dueDate.toDateString()}\n🎁 Loyalty earned: ₦${(subtotal * 0.015).toFixed(
        2
      )}`;
    } else if (body.toLowerCase() === "cancel" && user.pendingOrder) {
      user.pendingOrder = null;
      await user.save();
      reply = "❌ Your pending order has been cancelled. You can start a new one anytime.";
    } else {
      // 🔹 Step 2: Detect intent
      const intent = detectIntent(body);

      if (intent === "create_order") {
        const parsed = await parseOrderIntent(body);

        if (parsed.items.length > 0) {
          const pricePerItem = 500;
          const subtotal = parsed.items.reduce(
            (sum, i) => sum + i.quantity * pricePerItem,
            0
          );

          // Save pending order in user
          user.pendingOrder = {
            items: parsed.items,
            subtotal,
            delivery: parsed.delivery,
            payment: parsed.payment,
            instructions: parsed.instructions,
          };
          await user.save();

          reply = `🧾 *Order Summary*\n\nItems:\n${parsed.items
            .map((i) => `- ${i.quantity} ${i.name}`)
            .join("\n")}\n💵 Subtotal: ₦${subtotal}\n🚚 Delivery: ${parsed.delivery || "Not specified"}\n💳 Payment: ${parsed.payment || "Not specified"}\n📝 Notes: ${parsed.instructions || "None"}\n\n✅ Reply *Confirm* to place order or *Cancel* to discard.`;
        } else {
          reply =
            "🤔 I couldn’t detect your order. Try: *Wash 3 shirts and 2 trousers*.";
        }
      } else if (intent === "track_order") {
        const order = await Order.findOne({ userId: user._id }).sort({ createdAt: -1 });
        reply = order
          ? `📦 Your last order is currently: *${order.status}*`
          : "❌ You don’t have any active orders.";
      } else if (intent === "check_loyalty") {
        reply = `🎁 You have ₦${user.loyaltyBalance.toFixed(2)} in loyalty cashback.`;
      } else {
        reply = await processUserMessage(user._id, body); // AI fallback
      }
    }

    await sendWhatsAppMessage(from, reply);

    await Notification.create({
      userId: user._id,
      type: "chat",
      message: reply,
    });

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Bot Error:", err);
    res.sendStatus(500);
  }
};
// export const handleIncomingMessage = async (req, res) => {
//   try {
//     const entry = req.body.entry?.[0];
//     const message = entry?.changes?.[0]?.value?.messages?.[0];
//     const contact = entry?.changes?.[0]?.value?.contacts?.[0];

//     if (!message) return res.sendStatus(200);

//     const from = message.from;
//     const body = message.text?.body || "";
//     const profile = contact?.profile || {};

//     let user = await User.findOne({ phone: from });
//     if (!user) {
//       user = await User.create({
//         fullName: profile?.name || "",
//         phone: from,
//         loyaltyBalance: 0,
//         totalOrders: 0,
//       });
//     }

//     // 🔹 Smart Onboarding
//     if (!user.fullName || !user.address) {
//       const details = extractUserDetails(body);
//       if (details.fullName || details.address || details.landmark) {
//         Object.assign(user, details);
//         await user.save();
//         await sendWhatsAppMessage(from, `✅ Thanks ${user.fullName || "friend"}! Your profile is updated.\nNow you can place an order.`);
//       } else {
//         await sendWhatsAppMessage(from, "👋 Please send your *full name*, *address*, and *landmark*.\nExample:\nVictor Adebowale\nAwka North Mgbakwu\nNear Market Square");
//       }
//       return res.sendStatus(200);
//     }

//     // 🔹 Intent detection
//     const intent = detectIntent(body);
//     let reply;

//     if (intent === "create_order") {
//       const parsed = await parseOrderIntent(body);

//       if (parsed.items.length > 0) {
//         const pricePerItem = 500;
//         const subtotal = parsed.items.reduce((sum, i) => sum + i.quantity * pricePerItem, 0);

//         reply = `🧾 Summary:\n${parsed.items.map(i => `- ${i.quantity} ${i.name}`).join("\n")}\n💵 Subtotal: ₦${subtotal}\n\nConfirm order?`;
//       } else {
//         reply = "🤔 I couldn’t detect your order. Try: *Wash 3 shirts and 2 trousers*.";
//       }
//     }
//     else if (intent === "track_order") {
//       const order = await Order.findOne({ userId: user._id }).sort({ createdAt: -1 });
//       reply = order
//         ? `📦 Latest status: *${order.status}*`
//         : "❌ No active orders found.";
//     }
//     else if (intent === "check_loyalty") {
//       reply = `🎁 Your cashback balance is ₦${user.loyaltyBalance.toFixed(2)}.`;
//     }
//     else {
//       // 🔹 Smart fallback (GPT free chat + summary)
//       reply = await processUserMessage(user._id, body);
//     }

//     await sendWhatsAppMessage(from, reply);

//     await Notification.create({
//       userId: user._id,
//       type: "chat",
//       message: reply,
//     });

//     res.sendStatus(200);
//   } catch (err) {
//     console.error("❌ Bot Error:", err);
//     res.sendStatus(500);
//   }
// };

// // Helper: Extract name/address/preferences
// function extractUserDetails(message) {
//   const lines = message.split("\n").map(l => l.trim());
//   return {
//     fullName: lines[0],
//     address: lines[1],
//     preferences: { fragrance: lines[2] || "" },
//   };
// }
