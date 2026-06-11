// intents/greetingIntent.js
export default async function greetingIntent(userId, message, session) {
  // You can personalize this using session/user info later
  return `👋 Hello! Welcome to Chuvi Laundry.\nHow can I help you today?\n\nYou can:\n• Place an order 🧺\n• Track your order 🚚\n• Check referal⭐`
}
