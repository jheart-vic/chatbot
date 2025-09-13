// import {
//   detectIntent,
//   parseOrderIntent,
//   processUserMessage
// } from '../helpers/openAi.js'
// import { sendWhatsAppMessage } from '../helpers/whatsApp.js'
// import User from '../models/User.js'
// import Order from '../models/Order.js'
// import Message from '../models/Message.js'
// import { DateTime } from 'luxon'
// import { calculatePrice } from '../helpers/pricing.js'
// import { assignEmployee } from '../helpers/employeeAssignment.js'

// const STATUS_EMOJIS = {
//   Pending: '⏳',
//   'In Wash': '🧺',
//   Ironing: '👔',
//   Packaging: '🎁',
//   Ready: '✅',
//   Delivered: '🚚'
// }

// export const handleIncomingMessage = async (
//   { from, text, profile, messageId },
//   res
// ) => {
//   try {
//     // 1️⃣ Ensure user exists
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

//     // 2️⃣ MULTI-STEP ONBOARDING
//     if (!user.isOnboarded) {
//       if (!user.conversationState) user.conversationState = {}

//       switch (user.conversationState.step) {
//         case undefined:
//         case null:
//           user.conversationState = { step: 'awaiting_name' }
//           await user.save()
//           await sendWhatsAppMessage(
//             from,
//             '👋 Welcome! Please tell me your *full name* to get started.'
//           )
//           return res.sendStatus(200)

//         case 'awaiting_name':
//           user.fullName = text.trim() || user.whatsappName
//           user.conversationState = { step: 'awaiting_address' }
//           await user.save()
//           await sendWhatsAppMessage(
//             from,
//             `📍 Thanks ${user.fullName}! Now send me your *address*.`
//           )
//           return res.sendStatus(200)

//         case 'awaiting_address':
//           user.address = text.trim()
//           user.conversationState = { step: 'awaiting_preferences' }
//           await user.save()
//           await sendWhatsAppMessage(
//             from,
//             '💭 Great! Lastly, what are your laundry *preferences*? (fragrance, folding, ironing)\n\nExample: *Vanilla fragrance, neatly folded*'
//           )
//           return res.sendStatus(200)

//         case 'awaiting_preferences':
//           user.preferences = { fragrance: text.trim() || '' }
//           user.isOnboarded = true
//           user.conversationState = {}
//           await user.save()
//           await sendWhatsAppMessage(
//             from,
//             `✅ Thanks ${user.fullName}! Your details are saved.\n\nYou can now place orders like: *Wash 3 shirts and 2 trousers*.`
//           )
//           return res.sendStatus(200)
//       }
//     }

//     // 3️⃣ Handle ongoing conversation state (multi-step order creation)
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

//     // 4️⃣ Save user message
//     await Message.create({
//       userId: user._id,
//       from: 'user',
//       text,
//       externalId: messageId
//     })

//     // 5️⃣ Detect intent
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

//         const {
//           items: pricedItems,
//           subtotal,
//           deliveryFee,
//           total,
//           warnings,
//           missingServices
//         } = calculatePrice(parsed.items, parsed.turnaround, parsed.distanceKm)

//         if (missingServices.length > 0) {
//           user.conversationState = {
//             step: 'awaiting_service',
//             tempOrder: parsed
//           }
//           await user.save()

//           botReply = `🧺 I see some items without a selected service.\nHow should I handle them?\n- Wash & Iron\n- Wash & Fold\n- Iron Only`
//           break
//         }

//         let now = DateTime.now().setZone('Africa/Lagos')
//         let dueDate =
//           parsed.turnaround === 'express'
//             ? now.plus({ hours: 24 })
//             : parsed.turnaround === 'same-day'
//             ? now.plus({ hours: 8 })
//             : now.plus({ hours: 48 })

//         const order = await Order.create({
//           userId: user._id,
//           items: pricedItems,
//           status: 'Pending',
//           price: total,
//           loyaltyEarned: total * 0.015,
//           dueDate: dueDate.toJSDate()
//         })

//         let dominantService = pricedItems[0]?.service
//         if (dominantService === 'washIron' || dominantService === 'washFold') {
//           await assignEmployee(order._id, 'washer')
//         } else if (dominantService === 'ironOnly') {
//           await assignEmployee(order._id, 'ironer')
//         }

//         user.loyaltyBalance += total * 0.015
//         user.totalOrders += 1
//         user.conversationState = { step: null, tempOrder: {} }
//         await user.save()

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

//     // 6️⃣ Send reply
//     await sendWhatsAppMessage(from, botReply)

//     // 7️⃣ Log bot reply
//     await Message.create({
//       userId: user._id,
//       from: 'bot',
//       text: botReply,
//       externalId: `bot-${messageId}`
//     })

//     return res.status(200).end()
//   } catch (err) {
//     console.error('❌ Bot Error:', err)
//     return res.sendStatus(500)
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
import { DateTime } from 'luxon'
import { calculatePrice } from '../helpers/pricing.js'
import { assignEmployee } from '../helpers/employeeAssignment.js'

const STATUS_EMOJIS = {
  Pending: '⏳',
  'In Wash': '🧺',
  Ironing: '👔',
  Packaging: '🎁',
  Ready: '✅',
  Delivered: '🚚'
}

// 🖊️ Send typing indicator using axios
async function sendTypingIndicator (to) {
  try {
    await axios.post(
      `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'typing',
        status: 'typing_on'
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
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

// 🧩 Helper to send reply (shows typing first)
const replyAndExit = async (to, message, res) => {
  await sendTypingIndicator(to)
  await new Promise(r => setTimeout(r, 1500)) // ⏳ Wait 1.5s for realism
  await sendWhatsAppMessage(to, message)
  return
}

export const handleIncomingMessage = async (
  { from, text, profile, messageId },
  res
) => {
  try {
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

    const normalized = text.trim().toLowerCase()

    // 2️⃣ If onboarded and they say "hi" or "hello", reply nicely
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
        res
      )
    }

    // 3️⃣ Handle onboarding first
    if (!user.isOnboarded) {
      const step = user.conversationState?.step

      if (!step) {
        user.conversationState = { step: 'awaiting_name' }
        await user.save()
        return replyAndExit(
          from,
          '👋 Welcome! Please tell me your *full name* to get started.',
          res
        )
      }

      if (step === 'awaiting_name') {
        user.fullName = text.trim() || user.whatsappName
        user.conversationState = { step: 'awaiting_address' }
        await user.save()
        return replyAndExit(
          from,
          `📍 Thanks ${user.fullName}! Now send me your *address*.`,
          res
        )
      }

      if (step === 'awaiting_address') {
        user.address = text.trim()
        user.conversationState = { step: 'awaiting_preferences' }
        await user.save()
        return replyAndExit(
          from,
          '💭 Great! Lastly, what are your laundry *preferences*? (fragrance, folding, ironing)\n\nExample: *Vanilla fragrance, neatly folded*',
          res
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
          res
        )
      }
    }

    // 4️⃣ Handle multi-step order state
    if (user.conversationState?.step) {
      const state = user.conversationState

      if (state.step === 'awaiting_items') {
        const parsedItems = await parseOrderIntent(text)
        state.tempOrder.items = parsedItems.items
        state.step = null
        user.conversationState = state
        await user.save()
        return await handleIncomingMessage(
          { from, text: 'continue order', profile, messageId },
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
        return await handleIncomingMessage(
          { from, text: 'continue order', profile, messageId },
          res
        )
      }

      if (state.step === 'awaiting_distance') {
        const km = parseInt(text)
        state.tempOrder.distanceKm = km
        state.step = null
        user.conversationState = state
        await user.save()
        return await handleIncomingMessage(
          { from, text: 'continue order', profile, messageId },
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
        return await handleIncomingMessage(
          { from, text: 'continue order', profile, messageId },
          res
        )
      }
    }

    // 5️⃣ Save user message
    await Message.create({
      userId: user._id,
      from: 'user',
      text,
      externalId: messageId
    })

    // 6️⃣ Detect intent
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

        const {
          items: pricedItems,
          subtotal,
          deliveryFee,
          total,
          warnings,
          missingServices
        } = calculatePrice(parsed.items, parsed.turnaround, parsed.distanceKm)

        if (missingServices.length > 0) {
          user.conversationState = {
            step: 'awaiting_service',
            tempOrder: parsed
          }
          await user.save()
          botReply = `🧺 I see some items without a selected service.\nHow should I handle them?\n- Wash & Iron\n- Wash & Fold\n- Iron Only`
          break
        }

        let now = DateTime.now().setZone('Africa/Lagos')
        let dueDate =
          parsed.turnaround === 'express'
            ? now.plus({ hours: 24 })
            : parsed.turnaround === 'same-day'
            ? now.plus({ hours: 8 })
            : now.plus({ hours: 48 })

        const order = await Order.create({
          userId: user._id,
          items: pricedItems,
          status: 'Pending',
          price: total,
          loyaltyEarned: total * 0.015,
          dueDate: dueDate.toJSDate()
        })

        let dominantService = pricedItems[0]?.service
        if (dominantService === 'washIron' || dominantService === 'washFold') {
          await assignEmployee(order._id, 'washer')
        } else if (dominantService === 'ironOnly') {
          await assignEmployee(order._id, 'ironer')
        }

        user.loyaltyBalance += total * 0.015
        user.totalOrders += 1
        user.conversationState = {}
        await user.save()

        const itemList = pricedItems
          .map(
            i =>
              `- ${i.quantity} ${i.name} (${i.service}) @ ₦${i.unitPrice} = ₦${i.lineTotal}`
          )
          .join('\n')

        const dueDateStr = dueDate
          .setZone('Africa/Lagos')
          .toFormat('EEE d MMM, h:mma')

        botReply = `✅ Order placed!\n\n🧺 Items:\n${itemList}\n\n💵 Subtotal: ₦${subtotal.toLocaleString()}\n🚚 Delivery: ₦${deliveryFee.toLocaleString()}\n📦 Total: ₦${total.toLocaleString()}\n\n⏱ Turnaround: *${
          parsed.turnaround
        }*\n📅 Ready by: ${dueDateStr}\n🎁 Loyalty earned: ₦${(
          total * 0.015
        ).toFixed(2)}`

        if (warnings.length > 0) {
          botReply += `\n\n⚠️ Notes:\n${warnings.join('\n')}`
        }
        break
      }

      default:
        try {
          botReply = await processUserMessage(user._id, text)
        } catch (err) {
          console.warn('⚠️ OpenAI unavailable for fallback:', err.message)
          botReply =
            '🤖 I didn’t fully get that, but you can place an order, track it, or check your loyalty balance.'
        }
    }

    // 7️⃣ Send reply (with typing effect)
    await sendTypingIndicator(from)
    await new Promise(r => setTimeout(r, 1500))
    await sendWhatsAppMessage(from, botReply)

    // 8️⃣ Log bot reply
    await Message.create({
      userId: user._id,
      from: 'bot',
      text: botReply,
      externalId: `bot-${messageId}`
    })

    return res.status(200).end()
  } catch (err) {
    console.error('❌ Bot Error:', err)
    return
  }
}
