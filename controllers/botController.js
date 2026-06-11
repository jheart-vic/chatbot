// controllers/botController.js
// Incoming WhatsApp message pipeline:
// 1) dedupe + read receipt/typing
// 2) human-handoff mode (bot stays silent until #resume)
// 3) secure account linking / registration state machine (passwords are NEVER
//    stored in the Message log and NEVER passed to the LLM)
// 4) everything else → AI agent (full Chuvi backend tool access)

import axios from 'axios'
import dotenv from 'dotenv'
import User from '../models/User.js'
import Message from '../models/Message.js'
import { sendWhatsAppMessage, sendWhatsAppButtons } from '../helpers/whatsApp.js'
import { runAgent } from '../helpers/agent.js'
import { ChuviClient, ChuviApiError } from '../services/chuviApi.js'

dotenv.config()

const GRAPH = `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`
const graphHeaders = {
  Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
  'Content-Type': 'application/json'
}

async function markRead (messageId, typing = true) {
  try {
    await axios.post(GRAPH, {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
      ...(typing && { typing_indicator: { type: 'text' } })
    }, { headers: graphHeaders })
  } catch (err) {
    console.error('markRead failed:', err.response?.data || err.message)
  }
}

async function reply (botUser, to, text, { log = true, buttons = null } = {}) {
  if (buttons?.length) {
    await sendWhatsAppButtons(to, text, buttons)
    if (log) await Message.create({ userId: botUser._id, from: 'bot', text: `${text} [Buttons: ${buttons.map(b => b.title).join(' | ')}]` })
  } else {
    await sendWhatsAppMessage(to, text)
    if (log) await Message.create({ userId: botUser._id, from: 'bot', text })
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/* ------------------------- account linking flow ------------------------- */
// Steps: link_email → link_password  (existing account)
//        reg_name → reg_email → reg_password → reg_otp  (new account)

async function handleLinkingFlow (botUser, text) {
  const step = botUser.conversationState?.step
  const draft = botUser.conversationState?.linkDraft || {}
  const api = new ChuviClient(botUser)
  const t = text.trim()

  const setState = async (next, draftPatch = {}) => {
    botUser.conversationState = {
      ...botUser.conversationState,
      step: next,
      linkDraft: next ? { ...draft, ...draftPatch } : {}
    }
    botUser.markModified('conversationState')
    await botUser.save()
  }

  if (/^cancel$/i.test(t)) {
    await setState(null)
    return '✅ Okay, cancelled. You can reply *link account* anytime.'
  }

  switch (step) {
    case 'link_email': {
      if (!EMAIL_RE.test(t)) return '📧 That doesn\'t look like an email. Please send the email on your Chuvi account (or *cancel*).'
      await setState('link_password', { email: t.toLowerCase() })
      return '🔐 Got it. Now send your *password*.\n\n_For your privacy we don\'t store this message, and you can delete it from the chat after sending._'
    }

    case 'link_password': {
      try {
        const user = await api.login(draft.email, t)
        await setState(null)
        const name = user?.fullName?.split(' ')[0]
        return {
          text: `✅ Account linked${name ? `, ${name}` : ''}! 🎉\n\nYou can now do everything right here — book orders, track them, pay, manage your wallet and subscription. What would you like to do?`,
          buttons: [
            { id: 'cmd:book', title: '🧺 Book Order' },
            { id: 'cmd:balance', title: '👛 Wallet' },
            { id: 'cmd:plans', title: '⭐ Plans' }
          ]
        }
      } catch (err) {
        const msg = err instanceof ChuviApiError ? err.message : 'Login failed.'
        await setState('link_email')
        return `❌ ${msg}\n\nLet's try again — please send your *email* (or *cancel*, or *create account* if you don't have one).`
      }
    }

    case 'reg_name': {
      if (t.length < 2) return 'Please send your *full name*.'
      await setState('reg_email', { fullName: t })
      return '📧 Thanks! What *email* should we use for your account?'
    }

    case 'reg_email': {
      if (!EMAIL_RE.test(t)) return '📧 That doesn\'t look like an email — try again (or *cancel*).'
      await setState('reg_password', { email: t.toLowerCase() })
      return '🔐 Now choose a *password* (at least 8 characters).\n\n_We don\'t store this message — feel free to delete it after sending._'
    }

    case 'reg_password': {
      if (t.length < 8) return '🔐 Password must be at least 8 characters. Try another one.'
      try {
        await api.register({
          fullName: draft.fullName,
          email: draft.email,
          password: t,
          phoneNumber: botUser.phone.startsWith('+') ? botUser.phone : `+${botUser.phone}`
        })
        await setState('reg_otp', { password: undefined })
        return `📨 Almost done! We've sent a verification code to *${draft.email}*. Please send me the *OTP*.`
      } catch (err) {
        const msg = err instanceof ChuviApiError ? err.message : 'Registration failed.'
        if (/exist/i.test(msg)) {
          // The email is already registered — often from an earlier attempt where
          // the OTP email failed. Recover by resending the code and verifying.
          try {
            await api.resendOtp(draft.email)
            await setState('reg_otp')
            return `ℹ️ *${draft.email}* is already registered — possibly from an earlier attempt.\n\n📨 I've sent a fresh verification code to that email. Send me the *OTP* to verify it.\n\n(If this is your account and it's already verified, reply *cancel* then *link account* to sign in instead.)`
          } catch (_) {
            await setState('link_email')
            return `ℹ️ ${msg}\nLooks like you already have an account — let's link it instead. Please send your *email*.`
          }
        }
        return `❌ ${msg}\nPlease try a different password (or *cancel*).`
      }
    }

    case 'reg_otp': {
      try {
        await api.verifyOtp(draft.email, t.replace(/\s/g, ''))
        await setState('link_email', {})
        return `✅ Email verified! Now let's sign you in — please send your *email* again to link this WhatsApp to your new account.`
      } catch (err) {
        const msg = err instanceof ChuviApiError ? err.message : 'Verification failed.'
        if (/resend/i.test(t)) {
          await api.resendOtp(draft.email).catch(() => {})
          return '📨 A new code has been sent. Please send me the OTP.'
        }
        return `❌ ${msg}\nSend the code again, reply *resend* for a new one, or *cancel*.`
      }
    }

    default:
      return null
  }
}

/* ------------------------------ main handler ------------------------------ */

export const handleIncomingMessage = async ({ from, text, buttonId, profile, messageId }, res) => {
  // WhatsApp's typing indicator expires after ~25s; keep it alive while we work
  // (slow paths: agent runs with multiple backend calls). Cleared in finally.
  let typingKeepAlive = null
  try {
    // Translate tapped buttons (by id) into deterministic input for the pipeline
    if (buttonId) {
      const [cmd, arg] = buttonId.startsWith('cmd:')
        ? [buttonId.slice(4).split(':')[0], buttonId.split(':').slice(2).join(':') || buttonId.split(':')[2]]
        : [null, null]
      const CMD_TEXT = {
        link_account: 'link account',
        create_account: 'create account',
        prices: 'Show me the current price list',
        agent: 'I want to talk to a human agent',
        my_orders: 'Show my recent orders',
        balance: "What's my wallet balance?",
        book: 'I want to book a laundry order',
        plans: 'Show me the subscription plans'
      }
      if (cmd === 'track' && arg) text = `Track my order with id ${arg}`
      else if (cmd === 'pay_wallet' && arg) text = `Pay for my order with id ${arg} from my wallet`
      else if (cmd === 'pay_link' && arg) text = `Send me a payment link for my order with id ${arg}`
      else if (cmd && CMD_TEXT[cmd]) text = CMD_TEXT[cmd]
      // otherwise fall through with the button title as text
    }
    if (!text) return res?.status(200).end()

    const exists = await Message.findOne({ externalId: messageId })
    if (exists) return res?.status(200).end()

    await markRead(messageId)
    typingKeepAlive = setInterval(() => markRead(messageId), 20000)

    let user = await User.findOne({ phone: from })
    if (!user) {
      user = await User.create({
        phone: from,
        whatsappName: profile?.name || 'WhatsApp User',
        isOnboarded: true, // onboarding now happens via account linking
        conversationState: {}
      })
    }

    const step = user.conversationState?.step
    const isSecretStep = step === 'link_password' || step === 'reg_password'

    // Log the inbound message — but never log passwords
    await Message.create({
      userId: user._id,
      from: 'user',
      externalId: messageId,
      text: isSecretStep ? '••••••••' : text
    })

    const normalized = text.trim().toLowerCase()

    // --- Human handoff mode: bot stays quiet until an agent resumes it ---
    if (user.supportMode) {
      if (normalized === '#resume') {
        user.supportMode = false
        await user.save()
        await reply(user, from, '🤖 Hi again! I\'m back and ready to help. What can I do for you?')
      }
      // otherwise: a human agent is handling this chat; do not auto-respond
      return res?.status(200).end()
    }

    // --- Linking / registration state machine ---
    if (step?.startsWith('link_') || step?.startsWith('reg_')) {
      const flowReply = await handleLinkingFlow(user, text)
      if (flowReply) {
        if (typeof flowReply === 'string') await reply(user, from, flowReply)
        else await reply(user, from, flowReply.text, { buttons: flowReply.buttons })
        return res?.status(200).end()
      }
    }

    // --- Explicit commands ---
    if (/^link( my)? account$|^login$|^sign ?in$/i.test(normalized)) {
      user.conversationState = { step: 'link_email', linkDraft: {} }
      user.markModified('conversationState')
      await user.save()
      await reply(user, from, '🔗 Let\'s connect your Chuvi account.\n\nPlease send the *email* on your account.\n(No account yet? Reply *create account*. To stop, reply *cancel*.)')
      return res?.status(200).end()
    }

    if (/^create( an)? account$|^register$|^sign ?up$/i.test(normalized)) {
      user.conversationState = { step: 'reg_name', linkDraft: {} }
      user.markModified('conversationState')
      await user.save()
      await reply(user, from, '📝 Let\'s create your Chuvi account!\n\nFirst, what\'s your *full name*?')
      return res?.status(200).end()
    }

    if (/^unlink( account)?$|^log ?out$/i.test(normalized)) {
      await new ChuviClient(user).unlinkLocal()
      await reply(user, from, '🔓 Your Chuvi account has been disconnected from this WhatsApp. Reply *link account* anytime to reconnect.')
      return res?.status(200).end()
    }

    // First contact nudge for unlinked users (still let the agent answer questions)
    if (!user.chuvi?.accessToken && /^(hi|hello|hey|start|good (morning|afternoon|evening))/i.test(normalized)) {
      const name = profile?.name || user.whatsappName
      const welcome = `👋 Hi ${name}! I'm *Chuvi*, your laundry assistant.\n\nI can book orders, track them, handle payments, manage your wallet and subscription — everything the app does, right here in WhatsApp. 🧺\n\nConnect your Chuvi account to get started, or just ask me anything about our services and prices!`
      await sendWhatsAppButtons(from, welcome, [
        { id: 'cmd:link_account', title: '🔗 Link account' },
        { id: 'cmd:create_account', title: '📝 Create account' },
        { id: 'cmd:prices', title: '🏷️ See prices' }
      ])
      await Message.create({ userId: user._id, from: 'bot', text: welcome + ' [Buttons: Link account | Create account | See prices]' })
      return res?.status(200).end()
    }

    // --- Everything else → the agent ---
    const botReply = await runAgent(user, text)
    const skip = !botReply || !botReply.trim() || botReply.trim() === 'NO_REPLY'
    if (!skip) await reply(user, from, botReply)
    return res?.status(200).end()
  } catch (err) {
    console.error('❌ handleIncomingMessage error:', err)
    try { await sendWhatsAppMessage(from, '⚠️ Sorry, something went wrong on my end. Please try again in a moment.') } catch (_) {}
    return res?.status(200).end()
  } finally {
    if (typingKeepAlive) clearInterval(typingKeepAlive)
  }
}
