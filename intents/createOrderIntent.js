// intents/createOrderIntent.js
import chuvi from '../services/chuviApi.js'
import sessionStore from '../helpers/sessionStore.js'

/**
 * Parses item string like:
 * "2 shirts, 1 bedsheet, 3 trousers" → structured array
 */
function parseItems(text) {
  const items = []
  const parts = text.split(',').map(p => p.trim())

  for (const part of parts) {
    const match = part.match(/(\d+)\s+(.+)/i)
    if (match) {
      const quantity = parseInt(match[1], 10)
      const name = match[2].trim()

      items.push({
        serviceCode: name.toUpperCase().replace(/\s+/g, '_'), // temporary code
        serviceName: name,
        quantity,
        unit: 'piece',
        itemNotes: '',
        addOns: [],
        express: false,
        sameDay: false
      })
    } else if (part) {
      // fallback: quantity=1 if not specified
      items.push({
        serviceCode: part.toUpperCase().replace(/\s+/g, '_'),
        serviceName: part,
        quantity: 1,
        unit: 'piece',
        itemNotes: '',
        addOns: [],
        express: false,
        sameDay: false
      })
    }
  }

  return items
}

/**
 * Parse a natural language date/time quickly.
 * Example inputs: "tomorrow 9am", "next monday 2pm", "today"
 */
function parseDateTime(input) {
  const now = new Date()
  const lower = input.toLowerCase()

  if (lower.includes('tomorrow')) {
    const d = new Date(now)
    d.setDate(now.getDate() + 1)
    return d
  }
  if (lower.includes('today')) {
    return now
  }

  // Fallback: try Date.parse
  const parsed = Date.parse(input)
  if (!isNaN(parsed)) return new Date(parsed)

  // If all else fails → tomorrow 9am default
  const fallback = new Date(now)
  fallback.setDate(now.getDate() + 1)
  fallback.setHours(9, 0, 0, 0)
  return fallback
}

export default async function createOrderIntent(userId, message, session) {
  if (!session.tempOrder) {
    session.tempOrder = {
      step: 'start',
      items: [],
      pickup: {},
      delivery: {},
      notes: '',
      couponCode: null,
      serviceTier: 'STANDARD',
      pricingModel: 'RETAIL',
      paymentMethod: 'CARD',
      paymentGateway: 'PAYSTACK',
      paymentMode: 'FULL'
    }
  }

  const temp = session.tempOrder
  const normalized = message.trim().toLowerCase()

  // STEP 1: Start
  if (temp.step === 'start') {
    temp.step = 'items'
    return `🧺 Let's start your order!\nPlease list the items you'd like to send (e.g. "2 shirts, 1 bedsheet").`
  }

  // STEP 2: Parse items
  if (temp.step === 'items') {
    temp.items = parseItems(message)
    if (!temp.items.length) {
      return `⚠️ I couldn't understand the items. Please list them again like "2 shirts, 1 bedsheet".`
    }

    temp.step = 'pickupDate'
    return `📅 Great! When should we pick up your laundry? (e.g. "Tomorrow 9am")`
  }

  // STEP 3: Pickup date
  if (temp.step === 'pickupDate') {
    const date = parseDateTime(message)
    temp.pickup.date = date
    temp.step = 'pickupAddress'
    return `📍 Please provide your pickup address.`
  }

  // STEP 4: Pickup address
  if (temp.step === 'pickupAddress') {
    temp.pickup.address = {
      label: 'Pickup Address',
      line1: message,
      city: 'Lagos',
      state: 'Lagos'
    }
    temp.pickup.window = '09:00 - 12:00'
    temp.step = 'deliveryDate'
    return `🚚 Nice. When should we deliver your laundry back? (e.g. "Friday 2pm")`
  }

  // STEP 5: Delivery date
  if (temp.step === 'deliveryDate') {
    const date = parseDateTime(message)
    temp.delivery.date = date
    temp.step = 'deliveryAddress'
    return `🏠 What's the delivery address?`
  }

  // STEP 6: Delivery address
  if (temp.step === 'deliveryAddress') {
    temp.delivery.address = {
      label: 'Delivery Address',
      line1: message,
      city: 'Lagos',
      state: 'Lagos'
    }
    temp.delivery.window = '12:00 - 15:00'
    temp.step = 'subscription'
    return `✨ Are you using a subscription plan for this order? (yes/no)`
  }

  // STEP 7: Subscription?
  if (temp.step === 'subscription') {
    if (normalized === 'yes') {
      temp.pricingModel = 'SUBSCRIPTION'
    } else {
      temp.pricingModel = 'RETAIL'
    }
    temp.step = 'coupon'
    return `🎟 Do you have a coupon code? (type the code or 'no')`
  }

  // STEP 8: Coupon
  if (temp.step === 'coupon') {
    if (normalized !== 'no') {
      temp.couponCode = message.trim()
    }
    temp.step = 'notes'
    return `📝 Any special notes or instructions for your order? (e.g. "Handle with care", or 'no')`
  }

  // STEP 9: Notes
  if (temp.step === 'notes') {
    if (normalized !== 'no') {
      temp.notes = message
    }
    temp.step = 'express'
    return `⚡ Do you want same-day or express service for any items? (yes/no)`
  }

  // STEP 10: Express
  if (temp.step === 'express') {
    if (normalized === 'yes') {
      // Mark all items express for now — can later support item-specific
      temp.items = temp.items.map(i => ({ ...i, express: true }))
    }
    temp.step = 'confirm'
    return `✅ All set!\n\n🧺 Items: ${temp.items.map(i => `${i.quantity}× ${i.serviceName}`).join(', ')}\n📍 Pickup: ${temp.pickup.address.line1} on ${temp.pickup.date.toLocaleString()}\n🏠 Delivery: ${temp.delivery.address.line1} on ${temp.delivery.date.toLocaleString()}\n💳 ${temp.pricingModel}\n\nType **confirm** to place your order or **cancel** to abort.`
  }

  // STEP 11: Confirm
  if (temp.step === 'confirm') {
    if (normalized === 'confirm' || normalized === 'yes') {
      const token = sessionStore.getUserToken(userId)
      if (!token) {
        return `⚠️ Please log in first before placing an order.`
      }

      chuvi.setAuthToken(token)

      const payload = {
        items: temp.items,
        pickup: temp.pickup,
        delivery: temp.delivery,
        notes: temp.notes || '',
        couponCode: temp.couponCode || null,
        serviceTier: temp.serviceTier || 'STANDARD',
        pricingModel: temp.pricingModel,
        payment: {
          method: temp.paymentMethod,
          gateway: temp.paymentGateway,
          mode: temp.paymentMode
        }
      }

      try {
        const response = await chuvi.createOrder(payload)
        session.tempOrder = null

        return `🎉 Your order has been placed!\n🧾 Order ID: ${response.order.orderId}\n💳 Payment Link: ${response.paymentInitResponse?.authorization_url || response.paymentInitResponse?.checkoutUrl || 'Check your email/SMS.'}`
      } catch (err) {
        console.error('Order creation failed:', err?.response?.data || err.message)
        return `❌ Sorry, we couldn't create your order. ${err?.response?.data?.message || ''}`
      }
    }

    if (normalized === 'cancel') {
      session.tempOrder = null
      return `❌ Order cancelled. You can start again anytime.`
    }

    return `Please type **confirm** to place the order or **cancel** to abort.`
  }

  return `🤔 Let's start again. Type "order" to begin.`
}
