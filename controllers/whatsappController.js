import { handleIncomingMessage as botHandler } from "./botController.js";

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

    // ⚡ ACK IMMEDIATELY — Meta times out slow webhooks (~10s) and starts
    // throttling/retrying. All real work (OpenAI, backend calls) happens after
    // the 200. Duplicate retries are absorbed atomically in botController via
    // the unique externalId index.
    res.sendStatus(200);

    botHandler({ from, text: parsed.text, buttonId: parsed.buttonId, profile, messageId })
      .catch((err) => console.error("❌ Background processing failed:", err));
  } catch (err) {
    console.error("❌ WhatsApp Webhook Error:", err);
    if (!res.headersSent) res.sendStatus(500);
  }
};
