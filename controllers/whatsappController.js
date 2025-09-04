// controllers/whatsappController.js
import { handleIncomingMessage as botHandler } from "./botController.js";
import Message from "../models/Message.js"; // ✅ import your Message model

export const handleIncomingMessage = async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const message = entry?.changes?.[0]?.value?.messages?.[0];
    const contact = entry?.changes?.[0]?.value?.contacts?.[0];

    if (!message) return res.sendStatus(200);

    const from = message.from;
    const text = message.text?.body?.trim() || "";
    const profile = contact?.profile || {};
    const messageId = message.id; // ✅ WhatsApp unique ID

    console.log("📩 Incoming webhook:", { from, text, profile, messageId });

    // 🚫 Deduplicate: skip if message already processed
    const already = await Message.findOne({ externalId: messageId });
    if (already) {
      console.log("⏭️ Skipping duplicate message:", messageId);
      return res.sendStatus(200);
    }

    // ✅ Save raw message with externalId
    await Message.create({
      userId: null, // will be filled in botController
      from: "user",
      text,
      externalId: messageId,
    });

    // Pass clean data to bot logic
    await botHandler({ from, text, profile, messageId }, res);
  } catch (err) {
    console.error("❌ WhatsApp Webhook Error:", err);
    res.sendStatus(500);
  }
};
