// intents/index.js
import greetingIntent from './greetingIntent.js'
import createOrderIntent from './createOrderIntent.js'
import trackOrderIntent from './trackOrderIntent.js'
// You can import more intents here as you build them

const intentHandlers = {
  greeting: greetingIntent,
  create_order: createOrderIntent,
  track_order: trackOrderIntent,
  // my_orders, check_loyalty, update_preferences, etc. will come later
}

export async function dispatchIntent(intent, userId, message, session) {
  const handler = intentHandlers[intent]

  if (!handler) {
    // Default fallback
    return `🤔 Sorry, I didn't quite get that. Can you rephrase?`
  }

  try {
    return await handler(userId, message, session)
  } catch (err) {
    console.error(`❌ Intent handler "${intent}" failed:`, err)
    return `⚠️ Oops! Something went wrong while processing your request.`
  }
}
