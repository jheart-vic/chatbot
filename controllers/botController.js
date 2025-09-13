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

// // 🖊️ Send typing indicator using axios
// // ✅ Mark message as read
// async function markMessageAsRead(to, messageId) {
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
//           Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
//           'Content-Type': 'application/json'
//         }
//       }
//     )
//   } catch (err) {
//     console.error('❌ Failed to mark message as read:', err.response?.data || err.message)
//   }
// }

// // 🧩 Helper to send reply (shows typing first)
// const replyAndExit = async (to, message, res) => {
//   await markMessageAsRead(to, messageId)
//   await new Promise(r => setTimeout(r, 1500)) // ⏳ Wait 1.5s for realism
//   await sendWhatsAppMessage(to, message)
//   return
// }

// export const handleIncomingMessage = async (
//   { from, text, profile, messageId },
//   res
// ) => {
//   try {
//     // 1️⃣ Find or create user
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

//     const normalized = text.trim().toLowerCase()

//     // 2️⃣ If onboarded and they say "hi" or "hello", reply nicely
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
//         res
//       )
//     }

//     // 3️⃣ Handle onboarding first
//     if (!user.isOnboarded) {
//       const step = user.conversationState?.step

//       if (!step) {
//         user.conversationState = { step: 'awaiting_name' }
//         await user.save()
//         return replyAndExit(
//           from,
//           '👋 Welcome! Please tell me your *full name* to get started.',
//           res
//         )
//       }

//       if (step === 'awaiting_name') {
//         user.fullName = text.trim() || user.whatsappName
//         user.conversationState = { step: 'awaiting_address' }
//         await user.save()
//         return replyAndExit(
//           from,
//           `📍 Thanks ${user.fullName}! Now send me your *address*.`,
//           res
//         )
//       }

//       if (step === 'awaiting_address') {
//         user.address = text.trim()
//         user.conversationState = { step: 'awaiting_preferences' }
//         await user.save()
//         return replyAndExit(
//           from,
//           '💭 Great! Lastly, what are your laundry *preferences*? (fragrance, folding, ironing)\n\nExample: *Vanilla fragrance, neatly folded*',
//           res
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
//           res
//         )
//       }
//     }

//     // 4️⃣ Handle multi-step order state
//     if (user.conversationState?.step) {
//       const state = user.conversationState

//       if (state.step === 'awaiting_items') {
//         const parsedItems = await parseOrderIntent(text)
//         state.tempOrder.items = parsedItems.items
//         state.step = null
//         user.conversationState = state
//         await user.save()
//         return await handleIncomingMessage(
//           { from, text: 'continue order', profile, messageId },
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
//         return await handleIncomingMessage(
//           { from, text: 'continue order', profile, messageId },
//           res
//         )
//       }

//       if (state.step === 'awaiting_distance') {
//         const km = parseInt(text)
//         state.tempOrder.distanceKm = km
//         state.step = null
//         user.conversationState = state
//         await user.save()
//         return await handleIncomingMessage(
//           { from, text: 'continue order', profile, messageId },
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
//         return await handleIncomingMessage(
//           { from, text: 'continue order', profile, messageId },
//           res
//         )
//       }
//     }

//     // 5️⃣ Save user message
//     await Message.create({
//       userId: user._id,
//       from: 'user',
//       text,
//       externalId: messageId
//     })

//     // 6️⃣ Detect intent
//     const intent = detectIntent(text)
//     console.log('👉 Detected intent:', intent)

//     let botReply = ''

//     switch (intent) {
//       case 'create_order': {
//         let parsed =
//           user.conversationState?.tempOrder || (await parseOrderIntent(text))

//         // 1. Ensure items are provided
//         if (!parsed.items || parsed.items.length === 0) {
//           user.conversationState = { step: 'awaiting_items', tempOrder: parsed }
//           await user.save()
//           botReply =
//             "🧺 Please tell me what items you'd like me to wash. Example: *3 shirts, 2 trousers*."
//           break
//         }

//         // 2. Ensure turnaround chosen
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

//         // 3. Ensure distance known
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

//         // 4. Ensure service is chosen BEFORE pricing
//         if (parsed.items.some(i => !i.service)) {
//           user.conversationState = {
//             step: 'awaiting_service',
//             tempOrder: parsed
//           }
//           await user.save()
//           botReply = `🧺 Which service would you like for these items?
// - Wash & Iron
// - Wash & Fold
// - Iron Only`
//           break
//         }

//         // 5. Now safe to calculate price
//         const {
//           items: pricedItems,
//           subtotal,
//           deliveryFee,
//           total,
//           warnings
//         } = calculatePrice(parsed.items, parsed.turnaround, parsed.distanceKm)

//         // 6. Calculate due date
//         let now = DateTime.now().setZone('Africa/Lagos')
//         let dueDate =
//           parsed.turnaround === 'express'
//             ? now.plus({ hours: 24 })
//             : parsed.turnaround === 'same-day'
//             ? now.plus({ hours: 8 })
//             : now.plus({ hours: 48 })

//         // 7. Create order
//         const order = await Order.create({
//           userId: user._id,
//           items: pricedItems,
//           status: 'Pending',
//           price: total,
//           loyaltyEarned: total * 0.015,
//           dueDate: dueDate.toJSDate()
//         })

//         // 8. Assign employee by service
//         let dominantService = pricedItems[0]?.service
//         if (dominantService === 'washIron' || dominantService === 'washFold') {
//           await assignEmployee(order._id, 'washer')
//         } else if (dominantService === 'ironOnly') {
//           await assignEmployee(order._id, 'ironer')
//         }

//         // 9. Update user stats
//         user.loyaltyBalance += total * 0.015
//         user.totalOrders += 1
//         user.conversationState = {}
//         await user.save()

//         // 10. Build summary reply
//         const itemList = pricedItems
//           .map(
//             i =>
//               `- ${i.quantity} ${i.name} (${i.service}) @ ₦${i.unitPrice} = ₦${i.lineTotal}`
//           )
//           .join('\n')

//         const dueDateStr = dueDate
//           .setZone('Africa/Lagos')
//           .toFormat('EEE d MMM, h:mma')

//         botReply = `✅ Order placed!\n\n🧺 Items:\n${itemList}\n\n💵 Subtotal: ₦${subtotal.toLocaleString()}\n🚚 Delivery: ₦${deliveryFee.toLocaleString()}\n📦 Total: ₦${total.toLocaleString()}\n\n⏱ Turnaround: *${
//           parsed.turnaround
//         }*\n📅 Ready by: ${dueDateStr}\n🎁 Loyalty earned: ₦${(
//           total * 0.015
//         ).toFixed(2)}`

//         if (warnings.length > 0) {
//           botReply += `\n\n⚠️ Notes:\n${warnings.join('\n')}`
//         }
//         break
//       }

//       default:
//         try {
//           botReply = await processUserMessage(user._id, text)
//         } catch (err) {
//           console.warn('⚠️ OpenAI unavailable for fallback:', err.message)
//           botReply =
//             '🤖 I didn’t fully get that, but you can place an order, track it, or check your loyalty balance.'
//         }
//     }

//     // 7️⃣ Send reply (with typing effect)
//     await sendTypingIndicator(from)
//     await new Promise(r => setTimeout(r, 1500))
//     await sendWhatsAppMessage(from, botReply)

//     // 8️⃣ Log bot reply
//     await Message.create({
//       userId: user._id,
//       from: 'bot',
//       text: botReply,
//       externalId: `bot-${messageId}`
//     })

//     return res.status(200).end()
//   } catch (err) {
//     console.error('❌ Bot Error:', err)
//     return
//   }
// }

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
//           Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
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

// const replyAndExit = async (to, message, res, messageId) => {
//   await markMessageAsRead(messageId)
//   await new Promise(r => setTimeout(r, 1500))
//   await sendWhatsAppMessage(to, message)
//   return res.status(200).end()
// }

// export const handleIncomingMessage = async (
//   { from, text, profile, messageId },
//   res
// ) => {
//   try {
//     await markMessageAsRead(messageId)

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

//     const normalized = text.trim().toLowerCase()

//     // Greetings
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

//     // Onboarding flow
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

//     // Handle any active conversation steps (multi-step orders)
//     if (user.conversationState?.step) {
//       const state = user.conversationState

//       if (state.step === 'awaiting_items') {
//         const parsedItems = await parseOrderIntent(text)
//         state.tempOrder.items = parsedItems.items
//         state.step = null
//         user.conversationState = state
//         await user.save()
//         return await handleIncomingMessage(
//           { from, text: 'continue order', profile, messageId },
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
//         return await handleIncomingMessage(
//           { from, text: 'continue order', profile, messageId },
//           res
//         )
//       }

//       if (state.step === 'awaiting_distance') {
//         const km = parseInt(text)
//         state.tempOrder.distanceKm = km
//         state.step = null
//         user.conversationState = state
//         await user.save()
//         return await handleIncomingMessage(
//           { from, text: 'continue order', profile, messageId },
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
//         return await handleIncomingMessage(
//           { from, text: 'continue order', profile, messageId },
//           res
//         )
//       }
//     }

//     // Save user message
//     await Message.create({
//       userId: user._id,
//       from: 'user',
//       text,
//       externalId: messageId
//     })

//     // Detect intent
//     const intent = detectIntent(text)
//     console.log('👉 Detected intent:', intent)

//     let botReply = ''

//     switch (intent) {
//       case 'create_order': {
//         let parsed =
//           user.conversationState?.tempOrder || (await parseOrderIntent(text))

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

//         const {
//           items: pricedItems,
//           subtotal,
//           deliveryFee,
//           total,
//           warnings
//         } = calculatePrice(parsed.items, parsed.turnaround, parsed.distanceKm)

//         let now = DateTime.now().setZone('Africa/Lagos')
//         let dueDate =
//           parsed.turnaround === 'express'
//             ? now.plus({ hours: 24 })
//             : parsed.turnaround === 'same-day'
//             ? now.plus({ hours: 8 })
//             : now.plus({ days: 2 })

//         const order = await Order.create({
//           userId: user._id,
//           items: pricedItems,
//           turnaround: parsed.turnaround,
//           distanceKm: parsed.distanceKm,
//           delivery: parsed.delivery,
//           payment: parsed.payment,
//           status: 'Pending',
//           total,
//           assignedTo: await assignEmployee()
//         })

//         user.totalOrders += 1
//         await user.save()

//         botReply = `✅ Your order has been placed!\n\n🧺 Items: ${pricedItems
//           .map(i => `${i.quantity} ${i.name} (${i.service})`)
//           .join(', ')}\n💰 Total: ₦${total}\n📅 Ready by: ${dueDate.toFormat(
//           'dd LLL, h:mma'
//         )}\n\nWe'll keep you updated on the progress.`
//         break
//       }

//       case 'track_order': {
//         const lastOrder = await Order.findOne({ userId: user._id }).sort({
//           createdAt: -1
//         })
//         if (!lastOrder) {
//           botReply = "📦 You don't have any orders yet."
//         } else {
//           botReply = `📦 Your last order is currently: ${
//             STATUS_EMOJIS[lastOrder.status]
//           } ${lastOrder.status}`
//         }
//         break
//       }

//       case 'check_loyalty': {
//         botReply = `🌟 You currently have *${user.loyaltyBalance} loyalty points*. Earn points with every order!`
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
//           .map(
//             (o, i) =>
//               `${i + 1}. ${STATUS_EMOJIS[o.status] || '📦'} *${o._id
//                 .toString()
//                 .slice(-6)
//                 .toUpperCase()}*\n   • ${DateTime.fromJSDate(
//                 o.createdAt
//               ).toFormat('dd LLL yyyy')}\n   • ₦${o.total} — ${o.status}`
//           )
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
//     console.error('❌ handleIncomingMessage error:', err)
//     res.sendStatus(500)
//   }
// }


// controllers/botController.js
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

// --------- Helpers: mark read, typing, reply & log ---------
async function markMessageAsRead(messageId) {
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
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    )
  } catch (err) {
    console.error('❌ Failed to mark message as read:', err.response?.data || err.message)
  }
}

/**
 * Correct typing indicator call — do NOT set `status` here.
 * WhatsApp Cloud API expects the "typing_on" action via the messages call, not the "status" param.
 */
async function sendTypingIndicator(to) {
  try {
    await axios.post(
      `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'typing_on'
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    )
  } catch (err) {
    // If unsupported in your API version this will fail — we log and continue
    console.error('❌ Typing indicator failed:', err.response?.data || err.message)
  }
}

/**
 * replyAndExit: mark read (done at top of handler), optionally show typing,
 * create bot Message log, send WhatsApp response and end express response.
 *
 * userId param is optional (if provided we'll record the bot message against the user)
 */
const replyAndExit = async (to, message, res, messageId, userId = null) => {
  // show typing briefly for realism (best-effort — will log if unsupported)
  await sendTypingIndicator(to)
  await new Promise(r => setTimeout(r, 1000))

  // log bot message into Message collection if we have userId
  try {
    if (userId) {
      await Message.create({
        userId,
        from: 'bot',
        text: message,
        externalId: `bot-${messageId}`
      })
    }
  } catch (e) {
    console.warn('⚠️ Failed to log bot message:', e.message)
  }

  await sendWhatsAppMessage(to, message)
  return res.status(200).end()
}

// --------- Main handler ---------
export const handleIncomingMessage = async (
  { from, text, profile, messageId },
  res
) => {
  try {
    // mark incoming message read so user sees blue ticks quickly
    await markMessageAsRead(messageId)

    // 1️⃣ Find or create user
    let user = await User.findOne({ phone: from })
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

    const rawText = (text || '').trim()
    const normalized = rawText.toLowerCase()

    // 2️⃣ Quick local checks: greetings, farewell, "my orders" (list)
    const GREETINGS = ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening']
    const FAREWELLS = ['bye', 'goodbye', 'see you', 'later', 'thanks', 'thank you']

    // If user is onboarded and sends a greeting -> quick friendly reply
    if (user.isOnboarded && GREETINGS.includes(normalized)) {
      const reply = `👋 Hi ${user.fullName || user.whatsappName}! You can place an order anytime — just tell me what you want washed.`
      return await replyAndExit(from, reply, res, messageId, user._id)
    }

    // Farewell / thanks
    if (FAREWELLS.some(w => normalized === w || normalized.startsWith(w))) {
      const reply = `👋 You're welcome${user.fullName ? ' ' + user.fullName : ''}! If you need anything else, just message me.`
      return await replyAndExit(from, reply, res, messageId, user._id)
    }

    // Explicit "my orders" / "orders" listing (handle before intent parsing)
    if (normalized === 'my orders' || normalized === 'orders' || normalized.includes('my orders')) {
      const orders = await Order.find({ userId: user._id }).sort({ createdAt: -1 }).limit(10)
      if (!orders || orders.length === 0) {
        const reply = "📦 You don't have any orders yet. Send me what you'd like washed to place your first order."
        return await replyAndExit(from, reply, res, messageId, user._id)
      }

      const list = orders
        .map(o => {
          const code = o.orderCode || (o._id.toString().slice(-6).toUpperCase())
          const emoji = STATUS_EMOJIS[o.status] || ''
          const due = o.dueDate ? ` • due ${DateTime.fromJSDate(o.dueDate).setZone('Africa/Lagos').toFormat('dd LLL')}` : ''
          return `${code} — ${emoji} ${o.status}${due}`
        })
        .join('\n')

      const reply = `📦 Here are your recent orders:\n\n${list}\n\nReply with an order code (e.g. ORD-123ABC) to get full details.`
      return await replyAndExit(from, reply, res, messageId, user._id)
    }

    // 3️⃣ Onboarding flow: keep user inside this flow until completed
    if (!user.isOnboarded) {
      const step = user.conversationState?.step

      if (!step) {
        user.conversationState = { step: 'awaiting_name' }
        await user.save()
        return await replyAndExit(from, '👋 Welcome! Please tell me your *full name* to get started.', res, messageId, user._id)
      }

      if (step === 'awaiting_name') {
        user.fullName = rawText || user.whatsappName
        user.conversationState = { step: 'awaiting_address' }
        await user.save()
        return await replyAndExit(from, `📍 Thanks ${user.fullName}! Now send me your *address*.`, res, messageId, user._id)
      }

      if (step === 'awaiting_address') {
        user.address = rawText
        user.conversationState = { step: 'awaiting_preferences' }
        await user.save()
        return await replyAndExit(
          from,
          '💭 Great! Lastly, what are your laundry *preferences*? (fragrance, folding, ironing)\n\nExample: *Vanilla fragrance, neatly folded*',
          res,
          messageId,
          user._id
        )
      }

      if (step === 'awaiting_preferences') {
        user.preferences = { fragrance: rawText || '' }
        user.isOnboarded = true
        user.conversationState = {}
        await user.save()
        return await replyAndExit(
          from,
          `✅ Thanks ${user.fullName}! Your details are saved.\n\nYou can now place orders like: *Wash 3 shirts and 2 trousers*.`,
          res,
          messageId,
          user._id
        )
      }
    }

    // 4️⃣ If there's an active multi-step order state, resume it (items/turnaround/distance/service)
    if (user.conversationState?.step) {
      const state = user.conversationState

      if (state.step === 'awaiting_items') {
        const parsedItems = await parseOrderIntent(rawText)
        state.tempOrder = state.tempOrder || {}
        state.tempOrder.items = parsedItems.items
        state.step = null
        user.conversationState = state
        await user.save()
        // continue the flow by telling the handler to process the 'continue order' shortcut
        return await handleIncomingMessage({ from, text: 'continue order', profile, messageId }, res)
      }

      if (state.step === 'awaiting_turnaround') {
        state.tempOrder = state.tempOrder || {}
        state.tempOrder.turnaround = rawText.toLowerCase().includes('express')
          ? 'express'
          : rawText.toLowerCase().includes('same')
          ? 'same-day'
          : 'standard'
        state.step = null
        user.conversationState = state
        await user.save()
        return await handleIncomingMessage({ from, text: 'continue order', profile, messageId }, res)
      }

      if (state.step === 'awaiting_distance') {
        state.tempOrder = state.tempOrder || {}
        const km = parseInt(rawText)
        state.tempOrder.distanceKm = isNaN(km) ? 0 : km
        state.step = null
        user.conversationState = state
        await user.save()
        return await handleIncomingMessage({ from, text: 'continue order', profile, messageId }, res)
      }

      if (state.step === 'awaiting_service') {
        const chosen = rawText.toLowerCase()
        let service
        if (chosen.includes('iron')) service = 'ironOnly'
        else if (chosen.includes('fold')) service = 'washFold'
        else service = 'washIron'

        state.tempOrder.items = (state.tempOrder.items || []).map(i => {
          if (!i.service) i.service = service
          return i
        })
        state.step = null
        user.conversationState = state
        await user.save()
        return await handleIncomingMessage({ from, text: 'continue order', profile, messageId }, res)
      }
    }

    // 5️⃣ Save the incoming user message
    try {
      await Message.create({
        userId: user._id,
        from: 'user',
        text: rawText,
        externalId: messageId
      })
    } catch (e) {
      console.warn('⚠️ Could not log incoming message:', e.message)
    }

    // 6️⃣ Detect intent (fallback to conversational AI otherwise)
    let intent = detectIntent(rawText)
    // If user typed a specific order code: treat as a tracking request
    const codeMatch = rawText.match(/(ORD-?[A-Za-z0-9]+)/i)
    if (codeMatch) intent = 'track_order' // prefer explicit tracking

    let botReply = ''

    switch (intent) {
      case 'create_order': {
        // parse order (either from tempOrder or from message)
        let parsed = user.conversationState?.tempOrder || (await parseOrderIntent(rawText))

        // ensure items
        if (!parsed.items || parsed.items.length === 0) {
          user.conversationState = { step: 'awaiting_items', tempOrder: parsed }
          await user.save()
          botReply = "🧺 Please tell me what items you'd like me to wash. Example: *3 shirts, 2 trousers*."
          break
        }

        // ensure turnaround
        if (!parsed.turnaround) {
          user.conversationState = { step: 'awaiting_turnaround', tempOrder: parsed }
          await user.save()
          botReply = '⏱ How fast do you need it?\n- Standard (48h)\n- Express (24h, +40%)\n- Same-day (6–8h, +80%, ≤15 items)'
          break
        }

        // ensure distance
        if (parsed.distanceKm == null) {
          user.conversationState = { step: 'awaiting_distance', tempOrder: parsed }
          await user.save()
          botReply = '🚚 Do you need pickup/delivery? If yes, how far are you from us (in km)?\nExample: *2 km*'
          break
        }

        // ensure service chosen for every item
        if (parsed.items.some(i => !i.service)) {
          user.conversationState = { step: 'awaiting_service', tempOrder: parsed }
          await user.save()
          botReply = `🧺 Which service would you like for these items?\n- Wash & Iron\n- Wash & Fold\n- Iron Only`
          break
        }

        // calculate price & create order
        const { items: pricedItems, subtotal, deliveryFee, total } =
          calculatePrice(parsed.items, parsed.turnaround, parsed.distanceKm)

        const now = DateTime.now().setZone('Africa/Lagos')
        const dueDate =
          parsed.turnaround === 'express'
            ? now.plus({ hours: 24 })
            : parsed.turnaround === 'same-day'
            ? now.plus({ hours: 8 })
            : now.plus({ days: 2 })

        const order = await Order.create({
          userId: user._id,
          items: pricedItems,
          status: 'Pending',
          price: total,
          loyaltyEarned: total * 0.015,
          dueDate: dueDate.toJSDate(),
          // store meta so admin/frontend can use it
          turnaround: parsed.turnaround,
          distanceKm: parsed.distanceKm,
          delivery: parsed.delivery || 'none',
          payment: parsed.payment || 'unspecified'
        })

        // assign employee according to dominant service
        const dominantService = pricedItems[0]?.service
        if (dominantService === 'washIron' || dominantService === 'washFold') {
          await assignEmployee(order._id, 'washer')
        } else if (dominantService === 'ironOnly') {
          await assignEmployee(order._id, 'ironer')
        }

        // update user stats
        user.loyaltyBalance += total * 0.015
        user.totalOrders += 1
        user.conversationState = {}
        await user.save()

        // build confirmation message (note: user asked to remove notes — we don't include warnings)
        const itemList = pricedItems
          .map(i => `${i.quantity} ${i.name} (${i.service})`)
          .join('\n')

        const dueDateStr = dueDate.setZone('Africa/Lagos').toFormat('EEE d MMM, h:mma')

        botReply = `✅ Order placed!\n\n🧾 Order Code: *${order.orderCode}*\n🧺 Items:\n${itemList}\n\n💵 Subtotal: ₦${subtotal.toLocaleString()}\n🚚 Delivery: ₦${deliveryFee.toLocaleString()}\n📦 Total: ₦${total.toLocaleString()}\n📏 Distance: ${parsed.distanceKm} km\n\n⏱ Turnaround: *${parsed.turnaround}*\n📅 Ready by: ${dueDateStr}\n🎁 Loyalty earned: ₦${(total * 0.015).toFixed(2)}`
        break
      }

      case 'track_order': {
        // if user sent an order code, use it
        let order = null
        const explicitCode = (rawText.match(/(ORD-?[A-Za-z0-9]+)/i) || [])[0]
        if (explicitCode) {
          const normalizedCode = explicitCode.replace(/-/g, '').toUpperCase()
          // attempt match by orderCode (keep both normalized formats)
          order = await Order.findOne({
            $or: [{ orderCode: explicitCode.toUpperCase() }, { orderCode: new RegExp(explicitCode, 'i') }]
          }).populate('userId')
        }

        if (!order) {
          // fallback: deliver user's latest order
          order = await Order.findOne({ userId: user._id }).sort({ createdAt: -1 })
        }

        if (!order) {
          botReply = "📦 I couldn't find any order for you. You can place a new order anytime."
          break
        }

        const code = order.orderCode || order._id.toString().slice(-6).toUpperCase()
        const emoji = STATUS_EMOJIS[order.status] || ''
        const due = order.dueDate ? `\n📅 Due: ${DateTime.fromJSDate(order.dueDate).setZone('Africa/Lagos').toFormat('EEE d MMM, h:mma')}` : ''
        botReply = `📦 Order *${code}* — ${emoji} ${order.status}${due}\n\nReply "my orders" to see recent orders or send the order code to get details.`
        break
      }

      case 'check_loyalty': {
        botReply = `🌟 You currently have *₦${(user.loyaltyBalance || 0).toFixed(2)}* in loyalty balance. You've placed *${user.totalOrders || 0}* orders.`
        break
      }

      case 'update_preferences': {
        // naive parser: look for fragrance, fold, iron keywords and update accordingly
        const newPrefs = { ...(user.preferences || {}) }
        // fragrance
        const fragMatch = rawText.match(/fragrance\s*(?:to|is|:)?\s*([a-zA-Z\s]+)/i)
        if (fragMatch && fragMatch[1]) newPrefs.fragrance = fragMatch[1].trim()
        // folding
        if (rawText.includes('neatly') || rawText.includes('folded') || rawText.includes('neat')) {
          newPrefs.foldingStyle = 'neatly folded'
        } else if (rawText.includes('no fold') || rawText.includes("don't fold")) {
          newPrefs.foldingStyle = 'no folding'
        }
        // ironing
        if (rawText.includes('iron only') || rawText.includes('iron') && !rawText.includes('no iron')) {
          newPrefs.ironingInstructions = 'iron as requested'
        } else if (rawText.includes('no iron') || rawText.includes("don't iron")) {
          newPrefs.ironingInstructions = 'no ironing'
        }

        user.preferences = newPrefs
        await user.save()

        botReply = `✅ Preferences updated!\n\n📝 Current preferences:\n${Object.entries(newPrefs)
          .map(([k, v]) => `• ${k}: ${v || '-'}`)
          .join('\n')}`
        break
      }

      default: {
        // fallback to conversational AI (OpenAI)
        try {
          botReply = await processUserMessage(user._id, rawText)
        } catch (err) {
          console.warn('⚠️ OpenAI unavailable for fallback:', err.message)
          botReply = '🤖 I didn’t fully get that, but you can place an order, track it, or check your loyalty balance.'
        }
      }
    }

    // 7️⃣ Send reply (simulate typing then send)
    await sendTypingIndicator(from)
    await new Promise(r => setTimeout(r, 1200))
    // log bot reply
    try {
      await Message.create({
        userId: user._id,
        from: 'bot',
        text: botReply,
        externalId: `bot-${messageId}`
      })
    } catch (e) {
      console.warn('⚠️ Failed to log bot reply:', e.message)
    }

    await sendWhatsAppMessage(from, botReply)
    return res.status(200).end()
  } catch (err) {
    console.error('❌ Bot Error:', err)
    return res.status(500).end()
  }
}
