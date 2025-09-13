import { handleIncomingMessage as botHandler } from "./botController.js";
import Message from "../models/Message.js";

export const handleIncomingMessage = async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const message = entry?.changes?.[0]?.value?.messages?.[0];
    const contact = entry?.changes?.[0]?.value?.contacts?.[0];

    if (!message) return res.sendStatus(200);

    const from = message.from;
    const text = message.text?.body?.trim() || "";
    const profile = contact?.profile || {};
    const messageId = message.id;

    console.log("📩 Incoming webhook:", { from, text, profile, messageId });

    // 🚫 Deduplicate
    const already = await Message.findOne({ externalId: messageId });
    if (already) {
      console.log("⏭️ Skipping duplicate message:", messageId);
      return res.sendStatus(200);
    }

    // ❌ REMOVE res.sendStatus(200) HERE
    await botHandler({ from, text, profile, messageId });

    // ✅ Send single response after bot logic finishes
    res.sendStatus(200);
  } catch (err) {
    console.error("❌ WhatsApp Webhook Error:", err);
    if (!res.headersSent) res.sendStatus(500);
  }
};
