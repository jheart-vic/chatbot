import axios from 'axios'
import {
  detectIntent,
  parseOrderIntent,
  processUserMessage
} from '../helpers/openAi.js'
import { sendWhatsAppMessage } from '../helpers/whatsApp.js'
import User from '../models/User.js'
import Order from '../models/Order.js'
import Message from '../models/Message.js'
import dotenv from 'dotenv'
import { DateTime } from 'luxon'
import { calculatePrice } from '../helpers/pricing.js'
import { assignEmployee } from '../helpers/employeeAssignment.js'

dotenv.config()

const STATUS_EMOJIS = {
  Pending: '⏳',
  'In Wash': '🧺',
  Ironing: '👔',
  Packaging: '🎁',
  Ready: '✅',
  Delivered: '🚚'
}

// --- Helper Functions ---
async function markMessageAsRead (messageId) {
  try {
    await axios.post(
      `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    )
  } catch (err) {
    console.error(
      '❌ Failed to mark message as read:',
      err.response?.data || err.message
    )
  }
}

async function sendTypingIndicator (messageId) {
  try {
    await axios.post(
      `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
        typing_indicator: { type: 'text' }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    )
  } catch (err) {
    console.error(
      '❌ Typing indicator failed:',
      err.response?.data || err.message
    )
  }
}

// --- Safe reply helper ---
const replyAndExit = async (to, message, res, messageId) => {
  try {
    if (messageId) await markMessageAsRead(messageId)
    await new Promise(r => setTimeout(r, 1500)) // small delay for natural feel
    await sendWhatsAppMessage(to, message)
  } catch (err) {
    console.error('❌ replyAndExit failed:', err.message)
  } finally {
    if (res && typeof res.status === 'function') {
      return res.status(200).end()
    } else {
      console.warn('⚠️ No res object provided to replyAndExit')
    }
  }
}

// --- Main Handler ---
export const handleIncomingMessage = async (
  { from, text, profile, messageId },
  res
) => {
  try {
    // ✅ Deduplicate incoming messages
    const exists = await Message.findOne({ externalId: messageId })
    if (exists) {
      console.log(`⚠️ Duplicate message ignored: ${messageId}`)
      return res?.status(200).end()
    }

    let user = await User.findOne({ phone: from })
    // Save message early to prevent reprocessing on retries
    await Message.create({
      userId: user._id,
      from: 'user',
      externalId: messageId,
      text
    })

    await markMessageAsRead(messageId)
    await sendTypingIndicator(messageId)

    // --- Ensure User exists ---
    if (!user) {
      user = await User.create({
        phone: from,
        whatsappName: profile?.name || 'WhatsApp User',
        fullName: null,
        address: null,
        preferences: {},
        loyaltyBalance: 0,
        totalOrders: 0,
        isOnboarded: false,
        conversationState: {}
      })
    }

    const normalized = text.trim().toLowerCase()

    // --- Greetings ---
    if (
      user.isOnboarded &&
      [
        'hi',
        'hello',
        'hey',
        'good morning',
        'good afternoon',
        'good evening'
      ].includes(normalized)
    ) {
      return replyAndExit(
        from,
        `👋 Hi ${
          user.fullName || user.whatsappName
        }! You can place an order anytime. Just tell me what you want washed 🙂`,
        res,
        messageId
      )
    }

    // --- Onboarding Flow ---
    if (!user.isOnboarded) {
      const step = user.conversationState?.step
      if (!step) {
        user.conversationState = { step: 'awaiting_name' }
        await user.save()
        return replyAndExit(
          from,
          '👋 Welcome! Please tell me your *full name* to get started.',
          res,
          messageId
        )
      }
      if (step === 'awaiting_name') {
        user.fullName = text.trim() || user.whatsappName
        user.conversationState = { step: 'awaiting_address' }
        await user.save()
        return replyAndExit(
          from,
          `📍 Thanks ${user.fullName}! Now send me your *address*.`,
          res,
          messageId
        )
      }
      if (step === 'awaiting_address') {
        user.address = text.trim()
        user.conversationState = { step: 'awaiting_preferences' }
        await user.save()
        return replyAndExit(
          from,
          '💭 Great! Lastly, what are your laundry *preferences*? (fragrance, folding, ironing)\n\nExample: *Vanilla fragrance, neatly folded*',
          res,
          messageId
        )
      }
      if (step === 'awaiting_preferences') {
        user.preferences = { fragrance: text.trim() || '' }
        user.isOnboarded = true
        user.conversationState = {}
        await user.save()
        return replyAndExit(
          from,
          `✅ Thanks ${user.fullName}! Your details are saved.\n\nYou can now place orders like: *Wash 3 shirts and 2 trousers*.`,
          res,
          messageId
        )
      }
    }

    // --- Multi-step Order Flow ---
    if (user.conversationState?.step) {
      const state = user.conversationState
      const fakeMessageId = `${messageId}-internal-${Date.now()}` // ✅ prevents duplicate detection

      if (state.step === 'awaiting_items') {
        const parsedItems = await parseOrderIntent(text)
        state.tempOrder.items = parsedItems.items
        state.step = null
        user.conversationState = state
        await user.save()
        return handleIncomingMessage(
          { from, text: 'continue order', profile, messageId: fakeMessageId },
          res
        )
      }

      if (state.step === 'awaiting_turnaround') {
        state.tempOrder.turnaround = text.toLowerCase().includes('express')
          ? 'express'
          : text.toLowerCase().includes('same')
          ? 'same-day'
          : 'standard'
        state.step = null
        user.conversationState = state
        await user.save()
        return handleIncomingMessage(
          { from, text: 'continue order', profile, messageId: fakeMessageId },
          res
        )
      }

      if (state.step === 'awaiting_distance') {
        const km = parseInt(text)
        state.tempOrder.distanceKm = km
        state.step = null
        user.conversationState = state
        await user.save()
        return handleIncomingMessage(
          { from, text: 'continue order', profile, messageId: fakeMessageId },
          res
        )
      }

      if (state.step === 'awaiting_service') {
        const chosen = text.toLowerCase()
        let service
        if (chosen.includes('iron')) service = 'ironOnly'
        else if (chosen.includes('fold')) service = 'washFold'
        else service = 'washIron'

        state.tempOrder.items = state.tempOrder.items.map(i => {
          if (!i.service) i.service = service
          return i
        })
        state.step = null
        user.conversationState = state
        await user.save()
        return handleIncomingMessage(
          { from, text: 'continue order', profile, messageId: fakeMessageId },
          res
        )
      }
    }

    // Detect intent
    const intent = detectIntent(text)
    console.log('👉 Detected intent:', intent)

    let botReply = ''

    switch (intent) {
      case 'create_order': {
        let parsed =
          user.conversationState?.tempOrder || (await parseOrderIntent(text))

        if (!parsed.items || parsed.items.length === 0) {
          user.conversationState = { step: 'awaiting_items', tempOrder: parsed }
          await user.save()
          botReply =
            "🧺 Please tell me what items you'd like me to wash. Example: *3 shirts, 2 trousers*."
          break
        }

        if (!parsed.turnaround) {
          user.conversationState = {
            step: 'awaiting_turnaround',
            tempOrder: parsed
          }
          await user.save()
          botReply =
            '⏱ How fast do you need it?\n- Standard (48h)\n- Express (24h, +40%)\n- Same-day (6–8h, +80%, ≤15 items)'
          break
        }

        if (parsed.distanceKm == null) {
          user.conversationState = {
            step: 'awaiting_distance',
            tempOrder: parsed
          }
          await user.save()
          botReply =
            '🚚 Do you need pickup/delivery? If yes, how far are you from us (in km)?\nExample: *2 km*'
          break
        }

        if (parsed.items.some(i => !i.service)) {
          user.conversationState = {
            step: 'awaiting_service',
            tempOrder: parsed
          }
          await user.save()
          botReply = `🧺 Which service would you like for these items?\n- Wash & Iron\n- Wash & Fold\n- Iron Only`
          break
        }

        const {
          items: pricedItems,
          subtotal,
          deliveryFee,
          total,
          warnings
        } = calculatePrice(parsed.items, parsed.turnaround, parsed.distanceKm)

        let now = DateTime.now().setZone('Africa/Lagos')
        let dueDate =
          parsed.turnaround === 'express'
            ? now.plus({ hours: 24 })
            : parsed.turnaround === 'same-day'
            ? now.plus({ hours: 8 })
            : now.plus({ days: 2 })

        const order = await Order.create({
          userId: user._id,
          items: pricedItems,
          turnaround: parsed.turnaround,
          distanceKm: parsed.distanceKm,
          delivery: parsed.delivery,
          payment: parsed.payment,
          status: 'Pending',
          total,
          assignedTo: await assignEmployee()
        })

        user.totalOrders += 1
        await user.save()

        botReply = `✅ Your order has been placed!

🧺 Items: ${pricedItems
          .map(i => `${i.quantity} ${i.name} (${i.service})`)
          .join(', ')}

💵 Subtotal: ₦${subtotal}
🚚 Delivery fee: ₦${deliveryFee}
💰 Total: ₦${total}

📅 Ready by: ${dueDate.toFormat('dd LLL, h:mma')}

We'll keep you updated on the progress.`

        if (warnings.length) {
          botReply += `\n\n⚠️ Note: ${warnings.join(' ')}`
        }
        break
      }

      case 'track_order': {
        const lastOrder = await Order.findOne({ userId: user._id }).sort({
          createdAt: -1
        })
        if (!lastOrder) {
          botReply = "📦 You don't have any orders yet."
        } else {
          botReply = `📦 Your last order is currently: ${
            STATUS_EMOJIS[lastOrder.status]
          } ${lastOrder.status}`
        }
        break
      }

      case 'check_loyalty': {
        botReply = `🌟 You currently have *${user.loyaltyBalance} loyalty points*. Earn points with every order!`
        break
      }

      case 'update_preferences': {
        const lower = text.toLowerCase()
        const newPrefs = { ...user.preferences }

        if (lower.includes('fragrance')) {
          const match = lower.match(/fragrance\s*(?:to|=)?\s*([a-z]+)/)
          if (match) newPrefs.fragrance = match[1]
        }
        if (lower.includes('fold')) newPrefs.folding = 'neatly folded'
        if (lower.includes('iron')) newPrefs.ironing = 'well ironed'

        user.preferences = newPrefs
        await user.save()

        botReply = `✅ Preferences updated!\n\n📝 Current preferences:\n${Object.entries(
          newPrefs
        )
          .map(([k, v]) => `• ${k}: ${v}`)
          .join('\n')}`
        break
      }
      case 'my_orders': {
        const orders = await Order.find({ userId: user._id })
          .sort({ createdAt: -1 })
          .limit(5)

        if (!orders.length) {
          botReply = "📦 You haven't placed any orders yet."
          break
        }

        botReply = `🧾 Your Recent Orders:\n\n${orders
          .map(
            (o, i) =>
              `${i + 1}. ${STATUS_EMOJIS[o.status] || '📦'} *${o._id
                .toString()
                .slice(-6)
                .toUpperCase()}*\n   • ${DateTime.fromJSDate(
                o.createdAt
              ).toFormat('dd LLL yyyy')}\n   • ₦${o.total} — ${o.status}`
          )
          .join('\n\n')}`
        break
      }

      case 'farewell': {
        const farewellReplies = [
          '👋 Bye! Talk to you soon.',
          '😊 Thanks for chatting with us. Have a great day!',
          '🙌 See you later!',
          "💙 Thank you! We'll be here when you need us again."
        ]
        botReply =
          farewellReplies[Math.floor(Math.random() * farewellReplies.length)]
        break
      }

      default: {
        botReply = await processUserMessage(user._id, text)
      }
    }

    await Message.create({ userId: user._id, from: 'bot', text: botReply })
    await sendWhatsAppMessage(from, botReply)
    res.status(200).end()
  } catch (err) {
    console.error('❌ handleIncomingMessage error:', err)
    if (res && typeof res.sendStatus === 'function') {
      return res.sendStatus(500)
    }
    return // prevent crash if res is missing
  }
}
