import { handleIncomingMessage as botHandler } from "./botController.js";
import Message from "../models/Message.js";

/**
 * Extract usable input from any supported inbound message type.
 * Button taps and list selections arrive as `interactive` messages — we surface
 * both the human-readable title (as text) and the machine id (buttonId).
 */
export function parseInbound(message) {
  if (!message) return null;
  switch (message.type) {
    case "text":
      return { text: message.text?.body?.trim() || "", buttonId: null };
    case "interactive": {
      const reply =
        message.interactive?.button_reply || message.interactive?.list_reply;
      if (!reply) return null;
      return { text: (reply.title || "").trim(), buttonId: reply.id || null };
    }
    case "button": // template button replies
      return { text: message.button?.text?.trim() || "", buttonId: message.button?.payload || null };
    default:
      return null; // media, location, etc. — ignored for now
  }
}

export const handleIncomingMessage = async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const message = entry?.changes?.[0]?.value?.messages?.[0];
    const contact = entry?.changes?.[0]?.value?.contacts?.[0];

    if (!message) return res.sendStatus(200);

    const parsed = parseInbound(message);
    if (!parsed || (!parsed.text && !parsed.buttonId)) return res.sendStatus(200);

    const from = message.from;
    const profile = contact?.profile || {};
    const messageId = message.id;

    console.log("📩 Incoming webhook:", { from, messageId, type: message.type, buttonId: parsed.buttonId });

    // 🚫 Deduplicate
    const already = await Message.findOne({ externalId: messageId });
    if (already) {
      console.log("⏭️ Skipping duplicate message:", messageId);
      return res.sendStatus(200);
    }

    await botHandler({ from, text: parsed.text, buttonId: parsed.buttonId, profile, messageId });

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ WhatsApp Webhook Error:", err);
    if (!res.headersSent) res.sendStatus(500);
  }
};
