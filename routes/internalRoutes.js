// routes/internalRoutes.js
// Internal endpoint the chuvibackend calls (from its Paystack webhook handler)
// to push payment confirmations into the user's WhatsApp chat.
// Secured with a shared secret header: x-bot-secret.

import express from 'express'
import User from '../models/User.js'
import Message from '../models/Message.js'
import { sendWhatsAppMessage, sendWhatsAppButtons } from '../helpers/whatsApp.js'
import { onOrderDelivered } from '../helpers/journeys.js'

const router = express.Router()

const naira = n => `₦${Number(n || 0).toLocaleString('en-NG')}`

function buildButtons (event, p) {
  switch (event) {
    case 'wallet-top-up':
      return [
        { id: 'cmd:book', title: '🧺 Book Order' },
        { id: 'cmd:balance', title: '👛 Balance' }
      ]
    case 'order-paid':
      return [
        { id: `cmd:track:${p.orderId}`, title: '🚚 Track Order' },
        { id: 'cmd:my_orders', title: '🧾 My Orders' }
      ]
    case 'subscription-active':
      return [
        { id: 'cmd:book', title: '🧺 Book Order' },
        { id: 'cmd:plans', title: '⭐ My Plan' }
      ]
    case 'payment-failed':
      return [
        ...(p.orderId ? [{ id: `cmd:pay_link:${p.orderId}`, title: '💳 New Link' }] : []),
        { id: 'cmd:agent', title: '🆘 Talk to Agent' }
      ]
    default:
      return []
  }
}

function buildText (event, p) {
  switch (event) {
    case 'wallet-top-up':
      return `✅ *Wallet top-up successful!*\n\n💳 Amount: *${naira(p.amount)}*${p.balance != null ? `\n👛 New balance: *${naira(p.balance)}*` : ''}\n🧾 Ref: ${p.reference || '-'}\n\nYou can now pay for orders straight from your wallet. 🧺`
    case 'order-paid':
      return `✅ *Payment received!*\n\n📦 Order: *${p.oscNumber || p.orderId}*\n💳 Amount: *${naira(p.amount)}*\n🧾 Ref: ${p.reference || '-'}\n\nYour laundry is now being processed. I'll keep you posted — you can also ask me to *track* it anytime. 🚚`
    case 'subscription-active':
      return `✅ *Subscription active!*\n\n⭐ Plan: *${p.planName || 'your plan'}*${p.amount ? `\n💳 Amount: *${naira(p.amount)}*` : ''}\n\nYou can now book orders with *pay-from-subscription*. 🧺`
    case 'payment-failed':
      return `⚠️ *Payment didn't go through.*\n\n${p.reason ? `Reason: ${p.reason}\n` : ''}No money was taken${p.reference ? ` (ref ${p.reference})` : ''}. You can ask me for a new payment link, or reply *agent* if you'd like help from our team.`
    default:
      return null
  }
}

router.post('/payment-event', async (req, res) => {
  try {
    const secret = req.headers['x-bot-secret']
    if (!process.env.BOT_INTERNAL_SECRET || secret !== process.env.BOT_INTERNAL_SECRET) {
      return res.status(401).json({ success: false, error: 'unauthorized' })
    }

    const { event, chuviUserId, email, ...payload } = req.body || {}
    if (!event || (!chuviUserId && !email)) {
      return res.status(400).json({ success: false, error: 'event and chuviUserId or email required' })
    }

    // Find the WhatsApp user linked to this backend account
    const query = []
    if (chuviUserId) query.push({ 'chuvi.userId': String(chuviUserId) })
    if (email) query.push({ 'chuvi.email': String(email).toLowerCase() })
    const botUser = await User.findOne({ $or: query })

    if (!botUser) {
      // Not an error — the customer may simply not use WhatsApp
      return res.status(200).json({ success: true, delivered: false, reason: 'no linked WhatsApp user' })
    }

    // Delivery event → T1 + journey reset (handled by the journey engine)
    if (event === 'order-delivered') {
      await onOrderDelivered(botUser, payload)
      return res.status(200).json({ success: true, delivered: true })
    }

    const text = buildText(event, payload)
    if (!text) return res.status(400).json({ success: false, error: `unknown event "${event}"` })

    const buttons = buildButtons(event, payload)
    if (buttons.length) {
      await sendWhatsAppButtons(botUser.phone, text, buttons)
      await Message.create({ userId: botUser._id, from: 'bot', text: `${text} [Buttons: ${buttons.map(b => b.title).join(' | ')}]` })
    } else {
      await sendWhatsAppMessage(botUser.phone, text)
      await Message.create({ userId: botUser._id, from: 'bot', text })
    }

    return res.status(200).json({ success: true, delivered: true })
  } catch (err) {
    console.error('❌ /internal/payment-event error:', err.message)
    return res.status(500).json({ success: false, error: 'internal error' })
  }
})

export default router
