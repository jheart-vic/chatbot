// intents/trackOrderIntent.js
import chuvi from '../services/chuviApi.js'
import sessionStore from '../helpers/sessionStore.js'

export default async function trackOrderIntent(userId, message, session) {
  const token = sessionStore.getUserToken(userId)
  if (!token) {
    return `⚠️ Please log in first to track your orders.`
  }

  chuvi.setAuthToken(token)

  // Try to extract order ID from the message, e.g. "track 12345"
  const match = message.match(/track\s+(\w+)/i)
  let orderId = match ? match[1] : null

  try {
    let order

    if (orderId) {
      // 🔸 User specified an order ID explicitly
      order = await chuvi.getOrderById(orderId)
    } else {
      // 🔸 Fallback: get their most recent order
      const list = await chuvi.getOrders()
      if (!list || list.length === 0) {
        return `🫤 You don't have any orders yet.`
      }
      order = list[0]
    }

    if (!order) {
      return `❌ Sorry, I couldn't find that order.`
    }

    const status = order.status || order.orderStatus || 'Unknown'
    const pickupDate = order.pickup?.date
      ? new Date(order.pickup.date).toLocaleString()
      : '—'
    const deliveryDate = order.delivery?.date
      ? new Date(order.delivery.date).toLocaleString()
      : '—'

    return `📦 **Order ID:** ${order.orderId}\n📅 **Pickup:** ${pickupDate}\n🚚 **Delivery:** ${deliveryDate}\n📍 **Status:** ${status}`
  } catch (err) {
    console.error('Track order failed:', err?.response?.data || err.message)
    return `❌ Sorry, I couldn't track your order right now. ${err?.response?.data?.message || ''}`
  }
}
