// // controllers/botController.js
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
//         loyaltyBalance: 0,
//         totalOrders: 0
//       })
//     }

//     // 2️⃣ Smart onboarding
//     if (!user.fullName || !user.address) {
//       const lines = text.split('\n').map(l => l.trim())
//       if (lines.length >= 1) {
//         user.fullName = user.fullName || lines[0] || user.whatsappName
//         user.address = user.address || lines[1]
//         user.preferences = user.preferences || { fragrance: lines[2] || '' }
//         user.isOnboarded = true
//         await user.save()

//         await sendWhatsAppMessage(
//           from,
//           `✅ Thanks ${user.fullName}! Your details are saved.\n\nYou can now place orders like: *Wash 3 shirts and 2 trousers*.`
//         )
//       } else {
//         await sendWhatsAppMessage(
//           from,
//           '👋 Please send your *full name*, *address*, and *preferences* (fragrance, folding, ironing).\n\nFormat:\nJohn Doe\n123 Main Street\nVanilla fragrance'
//         )
//       }
//       return res.sendStatus(200)
//     }

//     // 3️⃣ Save user message
//     await Message.create({
//       userId: user._id,
//       from: 'user',
//       text,
//       externalId: messageId
//     })

//     // 4️⃣ Detect intent
//     const intent = detectIntent(text)
//     console.log('👉 Detected intent:', intent)

//     let botReply = ''

//     switch (intent) {
//       case 'create_order': {
//         let parsed = await parseOrderIntent(text)

//         // if (!parsed.items || parsed.items.length === 0) {
//         //   botReply =
//         //     '🧺 Please tell me what you’d like me to wash. Example: *Wash 3 shirts and 2 trousers*.'
//         //   break
//         // }

//         // // 🔹 If turnaround missing, ask user
//         // if (!parsed.turnaround) {
//         //   botReply =
//         //     '⏱ How fast do you need it?\n- Standard (48h)\n- Express (24h, +40%)\n- Same-day (6–8h, +80%, ≤15 items)'
//         //   break
//         // }

//         // // 🔹 If delivery distance missing, ask user
//         // if (parsed.distanceKm === null) {
//         //   botReply =
//         //     '🚚 Do you need pickup/delivery? If yes, how far are you from us (in km)?\nExample: *2 km*'
//         //   break
//         // }
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
//           botReply = '⏱ How fast do you need it? ...'
//           break
//         }

//         if (parsed.distanceKm == null) {
//           user.conversationState = {
//             step: 'awaiting_distance',
//             tempOrder: parsed
//           }
//           await user.save()
//           botReply = '🚚 Do you need pickup/delivery? ...'
//           break
//         }

//         // ✅ Everything available → calculate price
//         const {
//           items: pricedItems,
//           subtotal,
//           deliveryFee,
//           total,
//           warnings,
//           missingServices
//         } = calculatePrice(parsed.items, parsed.turnaround, parsed.distanceKm)

//         // 🔹 Ask service choice if missing
//         if (missingServices.length > 0) {
//           botReply = `🧺 I see you want to wash:\n${missingServices.join(
//             ', '
//           )}\n\nHow should I handle them?\n- Wash & Iron\n- Wash & Fold\n- Iron Only`
//           break
//         }

//         // 🔹 Set due date using Luxon (Nigeria time)
//         let now = DateTime.now().setZone('Africa/Lagos')
//         let dueDate = now
//         if (parsed.turnaround === 'express') {
//           dueDate = now.plus({ hours: 24 })
//         } else if (parsed.turnaround === 'same-day') {
//           dueDate = now.plus({ hours: 8 }) // upper bound
//         } else {
//           dueDate = now.plus({ hours: 48 })
//         }

//         // ✅ Create order with enriched items
//         const order = await Order.create({
//           userId: user._id,
//           items: pricedItems, // 👈 full breakdown
//           status: 'Pending',
//           price: total,
//           loyaltyEarned: total * 0.015,
//           dueDate: dueDate.toJSDate()
//         })

//         // ✅ Auto-assign staff after order is created
//         let assignedEmployee = null

//         const dominantService = pricedItems[0]?.service
//         if (dominantService === 'washIron' || dominantService === 'washFold') {
//           assignedEmployee = await assignEmployee(order._id, 'washer')
//         } else if (dominantService === 'ironOnly') {
//           assignedEmployee = await assignEmployee(order._id, 'ironer')
//         }

//         // Update user stats
//         user.loyaltyBalance += total * 0.015
//         user.totalOrders += 1
//         await user.save()

//         // Format item list for WhatsApp
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

//       case 'update_preferences': {
//         const lower = text.toLowerCase()
//         const updates = {}

//         if (lower.includes('fragrance')) {
//           updates.fragrance = text.split('fragrance')[1]?.trim()
//         }
//         if (lower.includes('fold')) {
//           updates.foldingStyle = text.split('fold')[1]?.trim()
//         }
//         if (lower.includes('iron')) {
//           updates.ironingInstructions = text.split('iron')[1]?.trim()
//         }

//         if (Object.keys(updates).length === 0) {
//           botReply =
//             '🤔 Please specify which preference to update (fragrance, folding, ironing).'
//           break
//         }

//         user.preferences = { ...user.preferences.toObject(), ...updates }
//         await user.save()

//         botReply = `✨ Preferences updated!
//           - Fragrance: ${user.preferences.fragrance || 'not set'}
//           - Folding: ${user.preferences.foldingStyle || 'not set'}
//           - Ironing: ${user.preferences.ironingInstructions || 'not set'}`

//         // Save as a notification
//         await Notification.create({
//           userId: user._id,
//           type: 'preference',
//           message: `Preferences updated: ${changes.join(', ')}`,
//           status: 'sent'
//         })
//         break
//       }

//       case 'track_order': {
//         const lower = text.toLowerCase()

//         // Case 1: "last order"
//         if (/last/.test(lower)) {
//           const lastOrder = await Order.findOne({ userId: user._id }).sort({
//             createdAt: -1
//           })
//           if (!lastOrder) {
//             botReply = '❌ You have no active orders.'
//           } else {
//             const itemList = lastOrder.items
//               .map(i => `- ${i.quantity} ${i.name} (${i.service})`)
//               .join('\n')

//             const emoji = STATUS_EMOJIS[lastOrder.status] || '📦'
//             botReply = `${emoji} Your last order (${lastOrder.orderCode}) is *${
//               lastOrder.status
//             }*.\n\n🧺 Items:\n${itemList}\n\n📅 Due: ${DateTime.fromJSDate(
//               lastOrder.dueDate
//             )
//               .setZone('Africa/Lagos')
//               .toFormat(
//                 'EEE d MMM, h:mma'
//               )}\n💵 Total: ₦${lastOrder.price.toLocaleString()}`
//           }
//           break
//         }

//         // Case 2: "Track ORD-XXXX"
//         const codeMatch = text.match(/ord-\w+/i)
//         if (codeMatch) {
//           const orderCode = codeMatch[0].toUpperCase()
//           const order = await Order.findOne({ orderCode, userId: user._id })
//           if (!order) {
//             botReply = '❌ No order found under your account with that ID.'
//           } else {
//             const itemList = order.items
//               .map(i => `- ${i.quantity} ${i.name} (${i.service})`)
//               .join('\n')

//             const emoji = STATUS_EMOJIS[order.status] || '📦'
//             botReply = `${emoji} Order ${order.orderCode} is *${
//               order.status
//             }*.\n\n🧺 Items:\n${itemList}\n\n📅 Due: ${DateTime.fromJSDate(
//               order.dueDate
//             )
//               .setZone('Africa/Lagos')
//               .toFormat(
//                 'EEE d MMM, h:mma'
//               )}\n💵 Total: ₦${order.price.toLocaleString()}`
//           }
//           break
//         }

//         // Case 3: List active orders
//         if (/all|active/.test(lower)) {
//           const activeOrders = await Order.find({
//             userId: user._id,
//             status: { $ne: 'Delivered' }
//           }).sort({ createdAt: -1 })

//           if (activeOrders.length === 0) {
//             botReply = '✅ You have no active orders.'
//           } else {
//             botReply =
//               '📋 Your active orders:\n\n' +
//               activeOrders
//                 .map(o => {
//                   const emoji = STATUS_EMOJIS[o.status] || '📦'
//                   return `${emoji} ${o.orderCode}: *${
//                     o.status
//                   }*, ₦${o.price.toLocaleString()}, due ${DateTime.fromJSDate(
//                     o.dueDate
//                   )
//                     .setZone('Africa/Lagos')
//                     .toFormat('EEE d MMM')}`
//                 })
//                 .join('\n')
//           }
//           break
//         }

//         // Fallback
//         botReply =
//           '🔎 Please tell me which order to track.\nExample: *last order*, *Track ORD-123ABC*, or *Track all*.'
//         break
//       }

//       case 'check_loyalty':
//         if (/^(points|loyalty|rewards)$/i.test(text.trim())) {
//           botReply = '🎁 Checking your loyalty points…'
//         } else {
//           botReply = `🎁 You have ₦${user.loyaltyBalance.toFixed(
//             2
//           )} in loyalty cashback.`
//         }
//         break

//       case 'greeting':
//         botReply = `👋 Hi ${user.fullName}! I’m CHUVI, your laundry assistant. You can place an order, track it, or check your loyalty balance.`
//         if (user.preferences?.fragrance) {
//           botReply += `\n✨ I remember you like ${user.preferences.fragrance}.`
//         }
//         break

//       default:
//         try {
//           // Try AI if available
//           botReply = await processUserMessage(user._id, text)
//         } catch (err) {
//           console.warn('⚠️ OpenAI unavailable for fallback:', err.message)
//           botReply =
//             '🤖 I didn’t fully get that, but you can place an order, track it, or check your loyalty balance.'
//         }
//     }

//     // 5️⃣ Send reply
//     await sendWhatsAppMessage(from, botReply)

//     // 6️⃣ Log bot reply
//     await Message.create({
//       userId: user._id,
//       from: 'bot',
//       text: botReply,
//       externalId: `bot-${messageId}`
//     })
//     return res.status(200).end()
//   } catch (err) {
//     console.error('❌ Bot Error:', err)
//     res.sendStatus(500)
//   }
// }

// controllers/botController.js
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

export const handleIncomingMessage = async (
  { from, text, profile, messageId },
  res
) => {
  try {
    // 1️⃣ Ensure user exists
    let user = await User.findOne({ phone: from })
    if (!user) {
      user = await User.create({
        phone: from,
        whatsappName: profile?.name || 'WhatsApp User',
        fullName: null,
        loyaltyBalance: 0,
        totalOrders: 0
      })
    }

    // 2️⃣ Smart onboarding
    if (!user.fullName || !user.address) {
      const lines = text.split('\n').map(l => l.trim())
      if (lines.length >= 1) {
        user.fullName = user.fullName || lines[0] || user.whatsappName
        user.address = user.address || lines[1]
        user.preferences = user.preferences || { fragrance: lines[2] || '' }
        user.isOnboarded = true
        await user.save()

        await sendWhatsAppMessage(
          from,
          `✅ Thanks ${user.fullName}! Your details are saved.\n\nYou can now place orders like: *Wash 3 shirts and 2 trousers*.`
        )
      } else {
        await sendWhatsAppMessage(
          from,
          '👋 Please send your *full name*, *address*, and *preferences* (fragrance, folding, ironing).\n\nFormat:\nJohn Doe\n123 Main Street\nVanilla fragrance'
        )
      }
      return res.sendStatus(200)
    }

    // 3️⃣ Handle ongoing conversation state (multi-step order creation)
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

      // ⚙️ NEW: Handle missing service reply
      if (state.step === 'awaiting_service') {
        const chosen = text.toLowerCase()
        let service

        if (chosen.includes('iron')) service = 'ironOnly'
        else if (chosen.includes('fold')) service = 'washFold'
        else service = 'washIron' // default

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

    // 4️⃣ Save user message
    await Message.create({
      userId: user._id,
      from: 'user',
      text,
      externalId: messageId
    })

    // 5️⃣ Detect intent
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

        // ✅ All info present → calculate price
        const {
          items: pricedItems,
          subtotal,
          deliveryFee,
          total,
          warnings,
          missingServices
        } = calculatePrice(parsed.items, parsed.turnaround, parsed.distanceKm)

        // ⚙️ NEW: If there are items without a service chosen
        if (missingServices.length > 0) {
          user.conversationState = {
            step: 'awaiting_service',
            tempOrder: parsed
          }
          await user.save()

          botReply = `🧺 I see some items without a selected service.\nHow should I handle them?\n- Wash & Iron\n- Wash & Fold\n- Iron Only`
          break
        }

        // ✅ Otherwise continue to create order
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
        user.conversationState = { step: null, tempOrder: {} }
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

    // 6️⃣ Send reply
    await sendWhatsAppMessage(from, botReply)

    // 7️⃣ Log bot reply
    await Message.create({
      userId: user._id,
      from: 'bot',
      text: botReply,
      externalId: `bot-${messageId}`
    })
    return res.status(200).end()
  } catch (err) {
    console.error('❌ Bot Error:', err)
    res.sendStatus(500)
  }
}

