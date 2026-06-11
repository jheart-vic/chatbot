// helpers/whatsApp.js
// WhatsApp Cloud API senders: plain text, interactive reply buttons (max 3),
// CTA URL button (e.g. "Pay Now" → Paystack page), and list messages.
// Payload builders are exported separately so they can be unit-tested.

import axios from 'axios'

const WHATSAPP_API_URL = 'https://graph.facebook.com/v20.0'
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN

const clip = (s, n) => {
  const str = String(s ?? '').trim()
  return str.length <= n ? str : str.slice(0, n - 1).trimEnd() + '…'
}

async function post (payload) {
  try {
    const res = await axios.post(
      `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    )
    return res.data
  } catch (error) {
    console.error('❌ WhatsApp API Error:', JSON.stringify(error.response?.data || error.message))
    throw error
  }
}

/* ----------------------------- payload builders ----------------------------- */
// Cloud API limits: body ≤1024 chars; reply buttons: max 3, title ≤20 chars,
// id ≤256; list: button text ≤20, row title ≤24, row description ≤72,
// max 10 rows total; cta_url display_text ≤20.

export function buildTextPayload (to, message) {
  return {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: clip(message, 4096) }
  }
}

export function buildButtonsPayload (to, body, buttons = [], { footer } = {}) {
  if (!buttons.length) throw new Error('buttons required')
  return {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: clip(body, 1024) },
      ...(footer && { footer: { text: clip(footer, 60) } }),
      action: {
        buttons: buttons.slice(0, 3).map((b, i) => ({
          type: 'reply',
          reply: {
            id: clip(b.id || `btn_${i}`, 256),
            title: clip(b.title, 20)
          }
        }))
      }
    }
  }
}

export function buildCtaUrlPayload (to, body, displayText, url, { footer } = {}) {
  return {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'cta_url',
      body: { text: clip(body, 1024) },
      ...(footer && { footer: { text: clip(footer, 60) } }),
      action: {
        name: 'cta_url',
        parameters: {
          display_text: clip(displayText, 20),
          url
        }
      }
    }
  }
}

export function buildListPayload (to, body, buttonText, rows = [], { header, footer, sectionTitle } = {}) {
  if (!rows.length) throw new Error('rows required')
  return {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      ...(header && { header: { type: 'text', text: clip(header, 60) } }),
      body: { text: clip(body, 1024) },
      ...(footer && { footer: { text: clip(footer, 60) } }),
      action: {
        button: clip(buttonText, 20),
        sections: [
          {
            title: clip(sectionTitle || 'Options', 24),
            rows: rows.slice(0, 10).map((r, i) => ({
              id: clip(r.id || `row_${i}`, 200),
              title: clip(r.title, 24),
              ...(r.description && { description: clip(r.description, 72) })
            }))
          }
        ]
      }
    }
  }
}

/* --------------------------------- senders --------------------------------- */

/** Plain text message. */
export const sendWhatsAppMessage = (to, message) =>
  post(buildTextPayload(to, message))

/**
 * Quick-reply buttons (max 3). buttons: [{ id, title }]
 * When tapped, the webhook receives interactive.button_reply { id, title }.
 */
export const sendWhatsAppButtons = (to, body, buttons, opts) =>
  post(buildButtonsPayload(to, body, buttons, opts))

/** Single URL button — ideal for Paystack payment links ("Pay Now 💳"). */
export const sendWhatsAppCtaUrl = (to, body, displayText, url, opts) =>
  post(buildCtaUrlPayload(to, body, displayText, url, opts))

/** List picker (max 10 rows). rows: [{ id, title, description }] */
export const sendWhatsAppList = (to, body, buttonText, rows, opts) =>
  post(buildListPayload(to, body, buttonText, rows, opts))
