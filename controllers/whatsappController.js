// controllers/whatsappController.js
import { handleIncomingMessage as botHandler } from "./botController.js";

export const handleIncomingMessage = async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const message = entry?.changes?.[0]?.value?.messages?.[0];
    const contact = entry?.changes?.[0]?.value?.contacts?.[0];

    if (!message) return res.sendStatus(200);

    const from = message.from;                       // WhatsApp number
    const text = message.text?.body?.trim() || "";   // Message body
    const profile = contact?.profile || {};          // User profile

    console.log("📩 Incoming webhook:", { from, text, profile });

    // ✅ Forward to bot logic (only once!)
    await botHandler({ from, text, profile }, res);
  } catch (err) {
    console.error("❌ WhatsApp Webhook Error:", err);
    res.sendStatus(500);
  }
};

