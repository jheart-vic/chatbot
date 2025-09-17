// import axios from 'axios'
// import {
//   detectIntent,
//   parseOrderIntent,
//   processUserMessage
// } from '../helpers/openAi.js'
// import { sendWhatsAppMessage } from '../helpers/whatsApp.js'
// import User from '../models/User.js'
// import Order from '../models/Order.js'
// import Message from '../models/Message.js'
// import dotenv from 'dotenv'
// import { DateTime } from 'luxon'
// import { calculatePrice } from '../helpers/pricing.js'
// import { assignEmployee } from '../helpers/employeeAssignment.js'

// dotenv.config()

// const STATUS_EMOJIS = {
//   Pending: '⏳',
//   'In Wash': '🧺',
//   Ironing: '👔',
//   Packaging: '🎁',
//   Ready: '✅',
//   Delivered: '🚚'
// }

// // --- Helper Functions ---
// async function markMessageAsRead (messageId) {
//   try {
//     await axios.post(
//       `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
//       {
//         messaging_product: 'whatsapp',
//         status: 'read',
//         message_id: messageId
//       },
//       {
//         headers: {
//           Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
//           'Content-Type': 'application/json'
//         }
//       }
//     )
//   } catch (err) {
//     console.error(
//       '❌ Failed to mark message as read:',
//       err.response?.data || err.message
//     )
//   }
// }

// async function sendTypingIndicator (messageId) {
//   try {
//     await axios.post(
//       `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
//       {
//         messaging_product: 'whatsapp',
//         status: 'read',
//         message_id: messageId,
//         typing_indicator: { type: 'text' }
//       },
//       {
//         headers: {
//           Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
//           'Content-Type': 'application/json'
//         }
//       }
//     )
//   } catch (err) {
//     console.error(
//       '❌ Typing indicator failed:',
//       err.response?.data || err.message
//     )
//   }
// }

// // --- Safe reply helper ---
// const replyAndExit = async (to, message, res, messageId) => {
//   try {
//     if (messageId) await markMessageAsRead(messageId)
//     await new Promise(r => setTimeout(r, 1500)) // small delay for natural feel
//     await sendWhatsAppMessage(to, message)
//   } catch (err) {
//     console.error('❌ replyAndExit failed:', err.message)
//   } finally {
//     if (res && typeof res.status === 'function') {
//       return res.status(200).end()
//     } else {
//       console.warn('⚠️ No res object provided to replyAndExit')
//     }
//   }
// }

// // --- Main Handler ---
// export const handleIncomingMessage = async (
//   { from, text, profile, messageId },
//   res
// ) => {
//   try {
//     // ✅ Deduplicate incoming messages
//     const exists = await Message.findOne({ externalId: messageId })
//     if (exists) {
//       console.log(`⚠️ Duplicate message ignored: ${messageId}`)
//       return res?.status(200).end()
//     }

//     await markMessageAsRead(messageId)
//     await sendTypingIndicator(messageId)

//     // --- Ensure User exists ---
//     let user = await User.findOne({ phone: from })

//     if (!user) {
//       user = await User.create({
//         phone: from,
//         whatsappName: profile?.name || 'WhatsApp User',
//         fullName: null,
//         address: null,
//         preferences: {},
//         loyaltyBalance: 0,
//         totalOrders: 0,
//         isOnboarded: false,
//         conversationState: {}
//       })
//     }

//     // Save message early to prevent reprocessing on retries
//     await Message.create({
//       userId: user._id,
//       from: 'user',
//       externalId: messageId,
//       text
//     })
//     console.log(`📩 Message from ${user.phone}: ${text}`)
//     const normalized = text.trim().toLowerCase()

//     // --- Greetings ---
//     if (
//       user.isOnboarded &&
//       [
//         'hi',
//         'hello',
//         'hey',
//         'good morning',
//         'good afternoon',
//         'good evening'
//       ].includes(normalized)
//     ) {
//       return replyAndExit(
//         from,
//         `👋 Hi ${
//           user.fullName || user.whatsappName
//         }! You can place an order anytime. Just tell me what you want washed 🙂`,
//         res,
//         messageId
//       )
//     }

//     // --- Onboarding Flow ---
//     if (!user.isOnboarded) {
//       const step = user.conversationState?.step
//       if (!step) {
//         user.conversationState = { step: 'awaiting_name' }
//         await user.save()
//         return replyAndExit(
//           from,
//           '👋 Welcome! Please tell me your *full name* to get started.',
//           res,
//           messageId
//         )
//       }
//       if (step === 'awaiting_name') {
//         user.fullName = text.trim() || user.whatsappName
//         user.conversationState = { step: 'awaiting_address' }
//         await user.save()
//         return replyAndExit(
//           from,
//           `📍 Thanks ${user.fullName}! Now send me your *address*.`,
//           res,
//           messageId
//         )
//       }
//       if (step === 'awaiting_address') {
//         user.address = text.trim()
//         user.conversationState = { step: 'awaiting_preferences' }
//         await user.save()
//         return replyAndExit(
//           from,
//           '💭 Great! Lastly, what are your laundry *preferences*? (fragrance, folding, ironing)\n\nExample: *Vanilla fragrance, neatly folded*',
//           res,
//           messageId
//         )
//       }
//       if (step === 'awaiting_preferences') {
//         user.preferences = { fragrance: text.trim() || '' }
//         user.isOnboarded = true
//         user.conversationState = {}
//         await user.save()
//         return replyAndExit(
//           from,
//           `✅ Thanks ${user.fullName}! Your details are saved.\n\nYou can now place orders like: *Wash 3 shirts and 2 trousers*.`,
//           res,
//           messageId
//         )
//       }
//     }

//     // --- Multi-step Order Flow ---
//     if (user.conversationState?.step) {
//       const state = user.conversationState
//       const fakeMessageId = `${messageId}-internal-${Date.now()}` // ✅ prevents duplicate detection

//       if (state.step === 'awaiting_items') {
//         const parsedItems = await parseOrderIntent(text)
//         state.tempOrder.items = parsedItems.items
//         state.step = null
//         user.conversationState = state
//         await user.save()
//         return handleIncomingMessage(
//           { from, text: 'continue order', profile, messageId: fakeMessageId },
//           res
//         )
//       }

//       if (state.step === 'awaiting_turnaround') {
//         state.tempOrder.turnaround = text.toLowerCase().includes('express')
//           ? 'express'
//           : text.toLowerCase().includes('same')
//           ? 'same-day'
//           : 'standard'
//         state.step = null
//         user.conversationState = state
//         await user.save()
//         return handleIncomingMessage(
//           { from, text: 'continue order', profile, messageId: fakeMessageId },
//           res
//         )
//       }

//       if (state.step === 'awaiting_distance') {
//         const km = parseInt(text)
//         state.tempOrder.distanceKm = km
//         state.step = null
//         user.conversationState = state
//         await user.save()
//         return handleIncomingMessage(
//           { from, text: 'continue order', profile, messageId: fakeMessageId },
//           res
//         )
//       }

//       if (state.step === 'awaiting_service') {
//         const chosen = text.toLowerCase()
//         let service
//         if (chosen.includes('iron')) service = 'ironOnly'
//         else if (chosen.includes('fold')) service = 'washFold'
//         else service = 'washIron'

//         state.tempOrder.items = state.tempOrder.items.map(i => {
//           if (!i.service) i.service = service
//           return i
//         })
//         state.step = null
//         user.conversationState = state
//         await user.save()
//         return handleIncomingMessage(
//           { from, text: 'continue order', profile, messageId: fakeMessageId },
//           res
//         )
//       }
//     }

//     // Detect intent
//     const intent = detectIntent(text)
//     console.log('👉 Detected intent:', intent)

//     let botReply = ''

//     switch (intent) {
//       case 'create_order': {
//         // STEP 1️⃣: Handle points confirmation step first
//         let parsed // ✅ Declare once

//         try {
//           parsed = await parseOrderIntent(text)
//           if (!parsed || !parsed.items || parsed.items.length === 0) {
//             console.warn('⚠️ AI returned empty result, using fallback parser')
//             parsed = fallbackParseOrderIntent(text)
//           }
//         } catch (err) {
//           console.error('❌ AI parsing failed, using fallback:', err.message)
//           parsed = fallbackParseOrderIntent(text)
//         }

//         console.log('🧺 Parsed order items:', parsed.items)

//         if (user.conversationState?.step === 'awaiting_points_confirm') {
//           parsed = user.conversationState.tempOrder // ✅ just reassign
//           const {
//             items: pricedItems,
//             subtotal,
//             deliveryFee,
//             total,
//             warnings
//           } = calculatePrice(parsed.items, parsed.turnaround, parsed.distanceKm)

//           let pointsUsed = 0
//           if (/^(yes|y|use|sure|ok)$/i.test(text)) {
//             pointsUsed = Math.min(user.loyaltyBalance, total)
//           }

//           // Move to order confirmation step, storing pointsUsed for next step
//           user.conversationState = {
//             step: 'awaiting_order_confirm',
//             tempOrder: parsed,
//             pointsUsed
//           }
//           await user.save()

//           botReply = `🧾 Here's your updated order summary:

// 🧺 Items: ${pricedItems
//             .map(i => `${i.quantity} ${i.name} (${i.service})`)
//             .join(', ')}
// 💵 Subtotal: ₦${subtotal}
// 🚚 Delivery fee: ₦${deliveryFee}
// 🎁 Points used: ₦${pointsUsed}
// 💰 Total: ₦${total - pointsUsed}

// ✅ Confirm order? (yes/no)`

//           if (warnings.length) botReply += `\n\n⚠️ Note: ${warnings.join(' ')}`
//           break
//         }

//         // STEP 2️⃣: Handle order confirmation step
//         if (user.conversationState?.step === 'awaiting_order_confirm') {
//           parsed = user.conversationState.tempOrder // ✅ reassign
//           const pointsUsed = user.conversationState.pointsUsed || 0
//           const {
//             items: pricedItems,
//             subtotal,
//             deliveryFee,
//             total,
//             warnings
//           } = calculatePrice(parsed.items, parsed.turnaround, parsed.distanceKm)

//           if (/^yes$/i.test(text)) {
//             const finalTotal = Math.max(total - pointsUsed, 0)
//             let now = DateTime.now().setZone('Africa/Lagos')
//             let dueDate =
//               parsed.turnaround === 'express'
//                 ? now.plus({ hours: 24 })
//                 : parsed.turnaround === 'same-day'
//                 ? now.plus({ hours: 8 })
//                 : now.plus({ days: 2 })

//             const order = await Order.create({
//               userId: user._id,
//               items: pricedItems,
//               turnaround: parsed.turnaround,
//               distanceKm: parsed.distanceKm,
//               delivery: parsed.delivery,
//               payment: parsed.payment,
//               status: 'Pending',
//               price: finalTotal,
//               loyaltyRedeemed: pointsUsed,
//               loyaltyEarned: Math.floor(finalTotal / 1000) * 10,
//               assignedTo: await assignEmployee()
//             })

//             user.loyaltyBalance =
//               user.loyaltyBalance - pointsUsed + order.loyaltyEarned
//             user.totalOrders += 1
//             user.conversationState = {}
//             await user.save()

//             botReply = `✅ Your order has been placed!

// 🧺 Items: ${pricedItems
//               .map(i => `${i.quantity} ${i.name} (${i.service})`)
//               .join(', ')}

// 💵 Subtotal: ₦${subtotal}
// 🚚 Delivery fee: ₦${deliveryFee}
// 🎁 Points used: ₦${pointsUsed}
// 💰 Total: ₦${finalTotal}

// 📅 Ready by: ${dueDate.toFormat('dd LLL, h:mma')}`

//             if (warnings.length)
//               botReply += `\n\n⚠️ Note: ${warnings.join(' ')}`
//             break
//           }
//         }

//         // STEP 3️⃣: Normal parsing flow
//         parsed = user.conversationState?.tempOrder || parsed

//         if (!parsed.items || parsed.items.length === 0) {
//           user.conversationState = { step: 'awaiting_items', tempOrder: parsed }
//           await user.save()
//           botReply =
//             "🧺 Please tell me what items you'd like me to wash. Example: *3 shirts, 2 trousers*."
//           break
//         }

//         if (!parsed.turnaround) {
//           user.conversationState = {
//             step: 'awaiting_turnaround',
//             tempOrder: parsed
//           }
//           await user.save()
//           botReply =
//             '⏱ How fast do you need it?\n- Standard (48h)\n- Express (24h, +40%)\n- Same-day (6–8h, +80%, ≤15 items)'
//           break
//         }

//         if (parsed.distanceKm == null) {
//           user.conversationState = {
//             step: 'awaiting_distance',
//             tempOrder: parsed
//           }
//           await user.save()
//           botReply =
//             '🚚 Do you need pickup/delivery? If yes, how far are you from us (in km)?\nExample: *2 km*'
//           break
//         }

//         if (parsed.items.some(i => !i.service)) {
//           user.conversationState = {
//             step: 'awaiting_service',
//             tempOrder: parsed
//           }
//           await user.save()
//           botReply = `🧺 Which service would you like for these items?\n- Wash & Iron\n- Wash & Fold\n- Iron Only`
//           break
//         }

//         // STEP 4️⃣: Price calculation before asking for points
//         const {
//           items: pricedItems,
//           subtotal,
//           deliveryFee,
//           total,
//           warnings
//         } = calculatePrice(parsed.items, parsed.turnaround, parsed.distanceKm)

//         if (user.loyaltyBalance > 0) {
//           user.conversationState = {
//             step: 'awaiting_points_confirm',
//             tempOrder: parsed
//           }
//           await user.save()

//           botReply = `🎁 You have ${user.loyaltyBalance} loyalty points.\nWould you like to use them for this order? (yes/no)`
//           break
//         }

//         user.conversationState = {
//           step: 'awaiting_order_confirm',
//           tempOrder: parsed,
//           pointsUsed: 0
//         }
//         await user.save()

//         botReply = `🧾 Here's your order summary:

// 🧺 Items: ${pricedItems
//           .map(i => `${i.quantity} ${i.name} (${i.service})`)
//           .join(', ')}
// 💵 Subtotal: ₦${subtotal}
// 🚚 Delivery fee: ₦${deliveryFee}
// 💰 Total: ₦${total}

// ✅ Confirm order? (yes/no)`

//         if (warnings.length) botReply += `\n\n⚠️ Note: ${warnings.join(' ')}`
//         break
//       }

//       case 'track_order': {
//         const lastOrder = await Order.findOne({ userId: user._id }).sort({
//           createdAt: -1
//         })
//         if (!lastOrder || !lastOrder.status) {
//           botReply = "📦 You don't have any orders yet."
//         } else {
//           const status = lastOrder.status || 'Pending'
//           const emoji = STATUS_EMOJIS[status] || '📦'
//           botReply = `📦 Your last order is currently: ${emoji} ${status}`
//         }
//         break
//       }

//       case 'check_loyalty': {
//         botReply = `🌟 You currently have *${user.loyaltyBalance} loyalty points*.
// You can type *"use points"* during your next order to get a discount.`
//         break
//       }

//       case 'update_preferences': {
//         const lower = text.toLowerCase()
//         const newPrefs = { ...user.preferences }

//         if (lower.includes('fragrance')) {
//           const match = lower.match(/fragrance\s*(?:to|=)?\s*([a-z]+)/)
//           if (match) newPrefs.fragrance = match[1]
//         }
//         if (lower.includes('fold')) newPrefs.folding = 'neatly folded'
//         if (lower.includes('iron')) newPrefs.ironing = 'well ironed'

//         user.preferences = newPrefs
//         await user.save()

//         botReply = `✅ Preferences updated!\n\n📝 Current preferences:\n${Object.entries(
//           newPrefs
//         )
//           .map(([k, v]) => `• ${k}: ${v}`)
//           .join('\n')}`
//         break
//       }

//       case 'my_orders': {
//         const orders = await Order.find({ userId: user._id })
//           .sort({ createdAt: -1 })
//           .limit(5)

//         if (!orders.length) {
//           botReply = "📦 You haven't placed any orders yet."
//           break
//         }

//         botReply = `🧾 Your Recent Orders:\n\n${orders
//           .map((o, i) => {
//             const redeemed =
//               o.loyaltyRedeemed > 0 ? `🎁 Redeemed: ₦${o.loyaltyRedeemed}` : ''
//             const earned =
//               o.loyaltyEarned > 0 ? `⭐ Earned: ${o.loyaltyEarned} pts` : ''
//             const extras = [redeemed, earned].filter(Boolean).join(' | ') // join with separator if both exist

//             return `${i + 1}. ${STATUS_EMOJIS[o.status] || '📦'} *${o._id
//               .toString()
//               .slice(-6)
//               .toUpperCase()}*\n   • ${DateTime.fromJSDate(
//               o.createdAt
//             ).toFormat('dd LLL yyyy')}\n   • ₦${o.price} — ${o.status}${
//               extras ? `\n   • ${extras}` : ''
//             }`
//           })
//           .join('\n\n')}`
//         break
//       }

//       case 'farewell': {
//         const farewellReplies = [
//           '👋 Bye! Talk to you soon.',
//           '😊 Thanks for chatting with us. Have a great day!',
//           '🙌 See you later!',
//           "💙 Thank you! We'll be here when you need us again."
//         ]
//         botReply =
//           farewellReplies[Math.floor(Math.random() * farewellReplies.length)]
//         break
//       }

//       default: {
//         botReply = await processUserMessage(user._id, text)
//       }
//     }

//     await Message.create({ userId: user._id, from: 'bot', text: botReply })
//     await sendWhatsAppMessage(from, botReply)
//     res.status(200).end()
//   } catch (err) {
//     if (res && typeof res.status === 'function') {
//       res.status(200).end()
//     } else {
//       console.warn('⚠️ No res object provided at end of handleIncomingMessage')
//     }
//     return // prevent crash if res is missing
//   }
// }

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

// --- Helpers ---
async function markMessageAsRead (messageId) {
  try {
    await axios.post(
      `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      { messaging_product: 'whatsapp', status: 'read', message_id: messageId },
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

const replyAndExit = async (to, message, res, messageId) => {
  try {
    if (messageId) await markMessageAsRead(messageId)
    await new Promise(r => setTimeout(r, 1200))
    await sendWhatsAppMessage(to, message)
    await Message.create({ from: 'bot', to, text: message })
  } catch (err) {
    console.error('❌ replyAndExit failed:', err.message)
  } finally {
    return res?.status(200).end()
  }
}

// --- MAIN HANDLER ---
export const handleIncomingMessage = async (
  { from, text, profile, messageId },
  res
) => {
  try {
    const exists = await Message.findOne({ externalId: messageId })
    if (exists) {
      console.log(`⚠️ Duplicate message ignored: ${messageId}`)
      return res?.status(200).end()
    }

    await markMessageAsRead(messageId)
    await sendTypingIndicator(messageId)

    let user = await User.findOne({ phone: from })
    if (!user) {
      user = await User.create({
        phone: from,
        whatsappName: profile?.name || 'WhatsApp User',
        loyaltyBalance: 0,
        totalOrders: 0,
        isOnboarded: false,
        conversationState: {}
      })
    }

    await Message.create({
      userId: user._id,
      from: 'user',
      externalId: messageId,
      text
    })

    console.log(`📩 Message from ${user.phone}: ${text}`)
    const normalized = text.trim().toLowerCase()

    // --- Handle awaiting order confirmation ---
    if (user.conversationState?.step === 'awaiting_order_confirm') {
      if (/^(yes|y|confirm)$/i.test(normalized)) {
        const orderData = user.conversationState.tempOrder
        const {
          items: pricedItems,
          subtotal,
          deliveryFee,
          total
        } = calculatePrice(
          orderData.items,
          orderData.turnaround,
          orderData.distanceKm
        )

        const now = DateTime.now().setZone('Africa/Lagos')
        const dueDate =
          orderData.turnaround === 'express'
            ? now.plus({ hours: 24 })
            : orderData.turnaround === 'same-day'
            ? now.plus({ hours: 8 })
            : now.plus({ days: 2 })

        const employee = await assignEmployee()

        const order = await Order.create({
          userId: user._id,
          items: pricedItems,
          turnaround: orderData.turnaround,
          distanceKm: orderData.distanceKm,
          delivery: orderData.delivery || 'pickup',
          payment: orderData.payment || 'cash',
          status: 'Pending',
          price: total,
          loyaltyRedeemed: 0,
          loyaltyEarned: Math.floor(total / 1000) * 10,
          assignedTo: employee
        })

        user.loyaltyBalance += order.loyaltyEarned
        user.totalOrders += 1
        user.conversationState = {}
        await user.save()

        return replyAndExit(
          from,
          `✅ Order placed!\n\n🧺 Items: ${pricedItems
            .map(i => `${i.quantity} ${i.name} (${i.service})`)
            .join(', ')}\n💵 Total: ₦${total}\n📅 Ready by: ${dueDate.toFormat(
            'dd LLL, h:mma'
          )}\n👤 Assigned to: ${employee?.name || 'Unassigned'}`,
          res,
          messageId
        )
      }

      if (/^(no|n|cancel)$/i.test(normalized)) {
        user.conversationState = {}
        await user.save()
        return replyAndExit(
          from,
          '❌ Order cancelled. You can start a new order anytime.',
          res,
          messageId
        )
      }
    }

    // --- Onboarding flow (unchanged) ---
    if (!user.isOnboarded) {
      const step = user.conversationState?.step
      if (!step) {
        user.conversationState = { step: 'awaiting_name' }
        await user.save()
        return replyAndExit(
          from,
          '👋 Welcome! Please tell me your *full name*.',
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
          `📍 Thanks ${user.fullName}! Please send me your *address*.`,
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
          '💭 Great! What are your laundry preferences? (e.g. *Vanilla fragrance, neatly folded*)',
          res,
          messageId
        )
      }
      if (step === 'awaiting_preferences') {
        user.preferences = { notes: text.trim() }
        user.isOnboarded = true
        user.conversationState = {}
        await user.save()
        return replyAndExit(
          from,
          `✅ Setup complete! You can now place an order: *Wash 3 shirts and 2 trousers*.`,
          res,
          messageId
        )
      }
    }

    // --- Intent detection ---
    const intent = detectIntent(text)
    console.log('👉 Detected intent:', intent)

    let botReply = ''

    switch (intent) {
      case 'create_order': {
        let parsed = parseOrderIntent(text)

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
            '⏱ How fast do you need it?\n- Standard (48h)\n- Express (24h, +40%)\n- Same-day (6–8h, +80%)'
          break
        }

        if (parsed.distanceKm == null) {
          user.conversationState = {
            step: 'awaiting_distance',
            tempOrder: parsed
          }
          await user.save()
          botReply = '🚚 How far are you from us (in km)? Example: *2 km*'
          break
        }

        if (parsed.items.some(i => !i.service)) {
          user.conversationState = {
            step: 'awaiting_service',
            tempOrder: parsed
          }
          await user.save()
          botReply = `🧺 Which service would you like?\n- Wash & Iron\n- Wash & Fold\n- Iron Only`
          break
        }

        const {
          items: pricedItems,
          subtotal,
          deliveryFee,
          total,
          warnings
        } = calculatePrice(parsed.items, parsed.turnaround, parsed.distanceKm)

        user.conversationState = {
          step: 'awaiting_order_confirm',
          tempOrder: parsed,
          pointsUsed: 0
        }
        await user.save()

        botReply = `🧾 Here's your order summary:\n\n🧺 Items: ${pricedItems
          .map(i => `${i.quantity} ${i.name} (${i.service})`)
          .join(
            ', '
          )}\n💵 Subtotal: ₦${subtotal}\n🚚 Delivery fee: ₦${deliveryFee}\n💰 Total: ₦${total}\n\n✅ Confirm order? (yes/no)`
        if (warnings.length) botReply += `\n\n⚠️ Note: ${warnings.join(' ')}`
        break
      }

      case 'my_orders': {
        const orders = await Order.find({ userId: user._id })
          .sort({ createdAt: -1 })
          .limit(3)
        if (!orders.length) {
          botReply = '📦 You have no orders yet.'
          break
        }
        botReply = `📝 Your recent orders:\n\n${orders
          .map(
            o =>
              `• ${STATUS_EMOJIS[o.status] || ''} *${o.status}* – ₦${
                o.price
              } (${DateTime.fromJSDate(o.createdAt).toFormat('dd LLL')})`
          )
          .join('\n')}`
        break
      }

      case 'update_preferences': {
        user.preferences = { notes: text }
        await user.save()
        botReply = `✅ Your preferences have been updated to: *${text}*`
        break
      }

      case 'track_order': {
        const lastOrder = await Order.findOne({ userId: user._id }).sort({
          createdAt: -1
        })
        botReply = lastOrder
          ? `📦 Your last order is currently: ${
              STATUS_EMOJIS[lastOrder.status] || ''
            } *${lastOrder.status}*`
          : '📦 You have no active orders right now.'
        break
      }

      case 'check_loyalty': {
        botReply = `🎁 You have ${user.loyaltyBalance} loyalty points available.`
        break
      }

      case 'greeting': {
        botReply = `👋 Hi ${
          user.fullName || user.whatsappName
        }! How can I help you today?`
        break
      }

      default: {
        botReply = await processUserMessage(user._id, text)
        break
      }
    }

    await Message.create({ userId: user._id, from: 'bot', text: botReply })
    await sendWhatsAppMessage(from, botReply)
    return res?.status(200).end()
  } catch (err) {
    console.error('❌ handleIncomingMessage error:', err)
    return res?.status(500).json({ error: 'Internal server error' })
  }
}
