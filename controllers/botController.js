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
import { transcribeWhatsAppAudio } from '../helpers/voice.js'
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
      lastStepAt: next ? new Date() : null,
      nudgedAt: null,
      failCount: 0,
      linkDraft: next ? { ...draft, ...draftPatch } : {}
    }
    botUser.markModified('conversationState')
    await botUser.save()
  }

  if (/^cancel$/i.test(t)) {
    await setState(null)
    return '✅ Okay, cancelled. You can reply *link account* anytime.'
  }

  // 🔀 Flow-switching commands typed mid-flow ("create account", "link account",
  // "reset password") must escape the current flow, NOT be treated as an email.
  // Exception: password steps, where such words could be a real password.
  const isPwStep = step === 'link_password' || step === 'reg_password' || step === 'reset_password'
  if (!isPwStep) {
    if (/^create( an)? account$|^register$|^sign ?up$/i.test(t)) {
      await setState('reg_name')
      return '📝 Let\'s create your Chuvi account!\n\nFirst, what\'s your *full name*?'
    }
    if (/^link( my)? account$|^log ?in$|^sign ?in$/i.test(t)) {
      await setState('link_email')
      return '🔗 Let\'s connect your Chuvi account.\n\nPlease send the *email* on your account.'
    }
    if (/^(reset|forgot)( my)? ?password$/i.test(t)) {
      await setState('reset_email')
      return '🔁 Let\'s reset your password.\n\nPlease send the *email* on your CHUVI account.'
    }
  }

  // 🧠 Conversational input mid-flow (greetings, confusion, help) should NOT be
  // consumed as emails/passwords/OTPs — orient the user and offer exits instead.
  const STEP_NEEDS = {
    link_email: 'the *email* on your CHUVI account',
    link_password: 'your *password*',
    reg_name: 'your *full name*',
    reg_email: 'the *email* for your new account',
    reg_password: 'a *password* (at least 8 characters)',
    reg_otp: 'the *OTP code* from your email',
    reset_email: 'the *email* on your account',
    reset_otp: 'the *reset code* from your email',
    reset_password: 'your *new password* (at least 8 characters)'
  }
  if (/^(hi|hello|hey|good (morning|afternoon|evening)|help|what|why|how|huh|\?+|i'?m (stuck|confused|lost)|stuck|confused)\b/i.test(t) || /^hello there$/i.test(t)) {
    return {
      text: `😊 No wahala — we're in the middle of setting things up.\n\nRight now I just need ${STEP_NEEDS[step] || 'one more detail'}.\n\nOr pick an option below:`,
      buttons: [
        { id: 'cmd:resume_flow', title: '▶️ Continue' },
        { id: 'cmd:start_over', title: '🔄 Start over' },
        { id: 'cmd:agent', title: '🆘 Talk to agent' }
      ]
    }
  }

  // After 2 failed attempts on the same step, stop repeating — offer exits.
  const bumpFail = async () => {
    const n = (botUser.conversationState.failCount || 0) + 1
    botUser.conversationState = { ...botUser.conversationState, failCount: n }
    botUser.markModified('conversationState')
    await botUser.save()
    return n
  }
  const fail = async (text) => {
    const n = await bumpFail()
    if (n < 2) return text
    return {
      text: `${text}\n\nHaving trouble? I can help another way:`,
      buttons: [
        { id: 'cmd:start_over', title: '🔄 Start over' },
        { id: 'cmd:agent', title: '🆘 Talk to agent' },
        { id: 'cmd:cancel_flow', title: '❌ Cancel' }
      ]
    }
  }

  switch (step) {
    case 'link_email': {
      if (!EMAIL_RE.test(t)) return await fail('📧 That doesn\'t look like an email address.\n\nPlease send the email on your CHUVI account, reply *create account* if you\'re new, or *cancel* to stop.')
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
        const msg = (err instanceof ChuviApiError ? err.message : err.message) || 'Login failed.'
        await setState('link_email')
        return await fail(`❌ ${msg}\n\nLet's try again — please send your *email* (or *cancel*, or *create account* if you don't have one).`)
      }
    }

    case 'reg_name': {
      if (t.length < 2) return 'Please send your *full name*.'
      await setState('reg_email', { fullName: t })
      return '📧 Thanks! What *email* should we use for your account?'
    }

    case 'reg_email': {
      if (!EMAIL_RE.test(t)) return await fail('📧 That doesn\'t look like an email — try again (or *cancel*).')
      const email = t.toLowerCase()
      const status = await api.probeEmail(email)

      if (status === 'exists') {
        await setState(null)
        return {
          text: `ℹ️ *${email}* already has a CHUVI account. 😊\n\nWould you like to *log in* instead?\n\nIf you don't remember your password — or you feel your account may have been compromised — you can *reset your password* right here.`,
          buttons: [
            { id: 'cmd:link_account', title: '🔑 Log in' },
            { id: 'cmd:reset_password', title: '🔁 Reset password' }
          ]
        }
      }

      if (status === 'unverified') {
        try {
          await api.resendOtp(email)
          await setState('reg_otp', { email })
          return `ℹ️ *${email}* is already registered but not yet verified — possibly from an earlier attempt.\n\n📨 I've sent a fresh verification code to that email. Send me the *OTP* to verify it (or *cancel*).`
        } catch (_) { /* fall through to normal flow */ }
      }

      await setState('reg_password', { email })
      return '🔐 Now choose a *password* (at least 8 characters).\n\n_We don\'t store this message — feel free to delete it after sending._'
    }

    case 'reg_password': {
      if (t.length < 8) return await fail('🔐 Password must be at least 8 characters. Try another one.')
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
        const msg = (err instanceof ChuviApiError ? err.message : err.message) || 'Registration failed.'
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
        return await fail(`❌ ${msg}\nPlease try a different password (or *cancel*).`)
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
        return await fail(`❌ ${msg}\nSend the code again, reply *resend* for a new one, or *cancel*.`)
      }
    }

    case 'reset_email': {
      if (!EMAIL_RE.test(t)) return await fail('📧 That doesn\'t look like an email. Please send the email on your CHUVI account (or *cancel*).')
      try {
        await api.forgotPassword(t.toLowerCase())
        await setState('reset_otp', { email: t.toLowerCase() })
        return `📨 I've sent a password-reset code to *${t.toLowerCase()}*.\n\nSend me the *OTP* to continue (or *cancel*).`
      } catch (err) {
        const msg = err instanceof ChuviApiError ? err.message : 'Could not start the reset.'
        if (/not found/i.test(msg)) return `❌ No CHUVI account found for that email.\nCheck the spelling and try again — or reply *create account* if you're new.`
        return `❌ ${msg}\nPlease try again (or *cancel*).`
      }
    }

    case 'reset_otp': {
      try {
        const data = await api.verifyResetPasswordOtp(draft.email, t.replace(/\s/g, ''))
        const resetToken = data?.resetToken || data?.message?.resetToken
        if (!resetToken) return '❌ Something went wrong verifying the code. Please send the OTP again (or *cancel*).'
        await setState('reset_password', { resetToken })
        return '✅ Code verified!\n\n🔐 Now send your *new password* (at least 8 characters).\n\n_We don\'t store this message — feel free to delete it after sending._'
      } catch (err) {
        const msg = err instanceof ChuviApiError ? err.message : 'Verification failed.'
        return await fail(`❌ ${msg}\nSend the code again, or *cancel*.`)
      }
    }

    case 'reset_password': {
      if (t.length < 8) return await fail('🔐 Password must be at least 8 characters. Try another one.')
      try {
        await api.resetPassword(draft.resetToken, t)
        const email = draft.email
        await setState('link_email', {})
        return {
          text: `✅ Your password has been changed! 🎉\n\nFor your security, any old sessions are now signed out.\n\nLet's link your account — please send your *email*${email ? ` (*${email}*)` : ''}.`,
          buttons: email ? [{ id: email, title: '📧 Use ' + email.slice(0, 14) }] : undefined
        }
      } catch (err) {
        const msg = err instanceof ChuviApiError ? err.message : 'Reset failed.'
        return `❌ ${msg}\nPlease try a different password (or *cancel*).`
      }
    }

    default:
      return null
  }
}

/* ------------------------------ main handler ------------------------------ */

export const handleIncomingMessage = async ({ from, text, buttonId, audioId, profile, messageId }, res) => {
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
      // Button id is a full email (e.g. "Use my email" shortcuts) → use it verbatim,
      // since the visible title gets clipped to 20 chars
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buttonId)) text = buttonId.toLowerCase()
      else if (cmd === 'track' && arg) text = `Track my order with id ${arg}`
      else if (cmd === 'pay_wallet' && arg) text = `Pay for my order with id ${arg} from my wallet`
      else if (cmd === 'pay_link' && arg) text = `Send me a payment link for my order with id ${arg}`
      else if (cmd && CMD_TEXT[cmd]) text = CMD_TEXT[cmd]
      // otherwise fall through with the button title as text
    }
    // Allow audio (voice notes have empty text until transcribed below)
    if (!text && !audioId) return res?.status(200).end()

    let user = await User.findOne({ phone: from })
    if (!user) {
      user = await User.create({
        phone: from,
        whatsappName: profile?.name || 'WhatsApp User',
        isOnboarded: true, // onboarding now happens via account linking
        conversationState: {}
      })
    }

    // Expire stale flows (>24h) so users never get trapped mid-registration
    let step = user.conversationState?.step
    const stepAge = user.conversationState?.lastStepAt
      ? Date.now() - new Date(user.conversationState.lastStepAt).getTime()
      : null
    if (step && stepAge !== null && stepAge > 24 * 60 * 60 * 1000) {
      user.conversationState = {}
      user.markModified('conversationState')
      step = null
    }

    const isSecretStep = step === 'link_password' || step === 'reg_password' || step === 'reset_password'

    // 🎙️ Voice note → transcribe with Whisper, then treat as normal text input.
    if (audioId && !text) {
      await markRead(messageId)
      // Security: never accept a spoken password/OTP — ask the user to type those.
      if (['link_password', 'reg_password', 'reset_password', 'reg_otp', 'reset_otp'].includes(step)) {
        await sendWhatsAppMessage(from, '🔐 For your security, please *type* this one rather than sending a voice note. 🙏')
        return res?.status(200).end()
      }
      let transcript = null
      try {
        transcript = await transcribeWhatsAppAudio(audioId)
      } catch (e) {
        console.error('🎙️ transcribe threw:', e.message)
      }
      if (!transcript) {
        await sendWhatsAppMessage(from, '🎙️ I had trouble hearing that voice note. Could you send it again, or type your message? 🙏')
        return res?.status(200).end()
      }
      text = transcript
      console.log('🎙️ Transcribed voice note (' + transcript.length + ' chars)')
    }

    if (!text) return res?.status(200).end()

    // 🔒 Atomic dedupe: externalId has a unique index, so Meta's webhook
    // retries can never double-process — even if two deliveries race.
    try {
      await Message.create({
        userId: user._id,
        from: 'user',
        externalId: messageId,
        text: isSecretStep ? '••••••••' : text
      })
    } catch (err) {
      if (err?.code === 11000) return res?.status(200).end() // duplicate delivery
      throw err
    }

    user.lastInboundAt = new Date()
    await user.save()

    await markRead(messageId)
    typingKeepAlive = setInterval(() => markRead(messageId), 20000)

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

    // 🌍 GLOBAL ESCAPES — work anywhere, including mid-flow.
    // (Clearing the WhatsApp chat only clears the phone; bot state lives here.)
    if (/^(reset|restart|start over|start afresh|let'?s start afresh|menu|main menu)$/i.test(normalized)) {
      user.conversationState = {}
      user.markModified('conversationState')
      await user.save()
      await reply(user, from, '🔄 All reset — fresh start! 😊\n\nWhat would you like to do?', {
        buttons: user.chuvi?.accessToken
          ? [{ id: 'cmd:book', title: '🧺 Book Order' }, { id: 'cmd:balance', title: '👛 Wallet' }, { id: 'cmd:my_orders', title: '🧾 My Orders' }]
          : [{ id: 'cmd:link_account', title: '🔗 Link account' }, { id: 'cmd:create_account', title: '📝 Create account' }, { id: 'cmd:prices', title: '🏷️ See prices' }]
      })
      return res?.status(200).end()
    }

    if (buttonId === 'cmd:agent' || /^(agent|human|talk to (a |an )?(human|agent|person)|customer (care|service|support))$/i.test(normalized)) {
      user.conversationState = {}
      user.supportMode = true
      user.markModified('conversationState')
      await user.save()
      if (process.env.OPERATIONS_NUMBER) {
        const who = user.fullName || user.whatsappName || user.phone
        await sendWhatsAppMessage(
          process.env.OPERATIONS_NUMBER,
          `🆘 *Support handoff*\nCustomer: ${who} (wa: ${user.phone})\nLinked account: ${user.chuvi?.email || user.knownEmail || 'not linked'}\n\nCustomer asked for a human directly. Reply to them, then send *#resume* in their chat to hand back to the bot.`
        ).catch(e => console.error('Ops alert failed:', e.message))
      }
      await reply(user, from, '🆘 No problem — I\'ve called a human agent for you. They\'ll continue right here in this chat. 🙏')
      return res?.status(200).end()
    }

    if (buttonId === 'cmd:start_over') {
      const prev = step || ''
      const entry = prev.startsWith('reg_') ? ['reg_name', '📝 Fresh start! What\'s your *full name*?']
        : prev.startsWith('reset_') ? ['reset_email', '🔁 Fresh start! Please send the *email* on your CHUVI account.']
        : ['link_email', '🔗 Fresh start! Please send the *email* on your CHUVI account.']
      user.conversationState = { step: entry[0], lastStepAt: new Date(), linkDraft: {} }
      user.markModified('conversationState')
      await user.save()
      await reply(user, from, entry[1])
      return res?.status(200).end()
    }

    // Resume / cancel an abandoned flow (from the follow-up nudge)
    if (buttonId === 'cmd:cancel_flow') {
      user.conversationState = {}
      user.markModified('conversationState')
      await user.save()
      await reply(user, from, '✅ No problem — cancelled. Whenever you\'re ready, just reply *link account* or *create account*. 😊')
      return res?.status(200).end()
    }

    if (buttonId === 'cmd:resume_flow') {
      const PROMPTS = {
        link_email: '🔗 Let\'s continue linking your account.\n\nPlease send the *email* on your CHUVI account.',
        link_password: '🔐 Almost there — please send your *password*.\n\n_We don\'t store this message._',
        reg_name: '📝 Let\'s continue! What\'s your *full name*?',
        reg_email: '📧 Let\'s continue — what *email* should we use for your account?',
        reg_password: '🔐 Let\'s continue — choose a *password* (at least 8 characters).\n\n_We don\'t store this message._',
        reg_otp: '📨 Let\'s continue — send me the *OTP* from your email (or reply *resend* for a new code).',
        reset_email: '🔁 Let\'s continue resetting your password. Please send the *email* on your account.',
        reset_otp: '📨 Let\'s continue — send me the *reset code* from your email.',
        reset_password: '🔐 Let\'s continue — send your *new password* (at least 8 characters).\n\n_We don\'t store this message._'
      }
      const prompt = PROMPTS[step]
      if (prompt) {
        user.conversationState = { ...user.conversationState, lastStepAt: new Date(), nudgedAt: null }
        user.markModified('conversationState')
        await user.save()
        await reply(user, from, prompt)
      } else {
        await reply(user, from, 'Looks like that session already ended. Reply *link account* or *create account* to start fresh. 😊')
      }
      return res?.status(200).end()
    }

    // --- Linking / registration state machine ---
    if (step?.startsWith('link_') || step?.startsWith('reg_') || step?.startsWith('reset_')) {
      const flowReply = await handleLinkingFlow(user, text)
      if (flowReply) {
        if (typeof flowReply === 'string') await reply(user, from, flowReply)
        else await reply(user, from, flowReply.text, { buttons: flowReply.buttons })
        return res?.status(200).end()
      }
    }

    // --- Explicit commands ---
    if (/^link( my)? account$|^login$|^sign ?in$/i.test(normalized)) {
      user.conversationState = { step: 'link_email', lastStepAt: new Date(), linkDraft: {} }
      user.markModified('conversationState')
      await user.save()
      await reply(user, from, '🔗 Let\'s connect your Chuvi account.\n\nPlease send the *email* on your account.\n(No account yet? Reply *create account*. To stop, reply *cancel*.)')
      return res?.status(200).end()
    }

    if (/^create( an)? account$|^register$|^sign ?up$/i.test(normalized)) {
      const rememberedEmail = user.chuvi?.email || user.knownEmail
      if (rememberedEmail) {
        await reply(user, from,
          `ℹ️ You already have a CHUVI account on this WhatsApp — *${rememberedEmail}*. 😊\n\nWould you like to *log in* instead?\n\nIf you don't remember your password — or you feel your account may have been compromised — you can *reset your password* right here. Or, if you really want a separate account with a different email, tap *New account*.`,
          { buttons: [
            { id: 'cmd:link_account', title: '🔑 Log in' },
            { id: 'cmd:reset_password', title: '🔁 Reset password' },
            { id: 'cmd:new_account', title: '📝 New account' }
          ] })
        return res?.status(200).end()
      }
      user.conversationState = { step: 'reg_name', lastStepAt: new Date(), linkDraft: {} }
      user.markModified('conversationState')
      await user.save()
      await reply(user, from, '📝 Let\'s create your Chuvi account!\n\nFirst, what\'s your *full name*?')
      return res?.status(200).end()
    }

    // Explicit "new account anyway" (from the button) skips the reminder
    if (buttonId === 'cmd:new_account') {
      user.conversationState = { step: 'reg_name', lastStepAt: new Date(), linkDraft: {} }
      user.markModified('conversationState')
      await user.save()
      await reply(user, from, '📝 Okay! Let\'s create a new Chuvi account.\n\nFirst, what\'s your *full name*?')
      return res?.status(200).end()
    }

    // Password reset entry (typed or via button)
    if (buttonId === 'cmd:reset_password' || /^(reset|forgot)( my)? ?password$/i.test(normalized)) {
      const remembered = user.chuvi?.email || user.knownEmail
      user.conversationState = { step: 'reset_email', lastStepAt: new Date(), linkDraft: {} }
      user.markModified('conversationState')
      await user.save()
      await reply(user, from,
        `🔁 Let's reset your password.\n\nPlease send the *email* on your CHUVI account${remembered ? ` (*${remembered}*)` : ''} — we'll send a reset code there.\n(To stop, reply *cancel*.)`,
        remembered ? { buttons: [{ id: remembered, title: '📧 Use ' + remembered.slice(0, 14) }] } : {})
      return res?.status(200).end()
    }

    if (/^unlink( account)?$|^log ?out$/i.test(normalized)) {
      await new ChuviClient(user).unlinkLocal()
      await reply(user, from, '🔓 Your Chuvi account has been disconnected from this WhatsApp. Reply *link account* anytime to reconnect.')
      return res?.status(200).end()
    }

    // First contact nudge for unlinked users (still let the agent answer questions)
    // Only PURE greetings get the canned welcome — "hello, what are your prices?"
    // must fall through to the AI agent so the question actually gets answered.
    if (!user.chuvi?.accessToken && /^(hi+|hello( there)?|hey+|start|good (morning|afternoon|evening))\s*[!.,😊🙏👋]*$/i.test(normalized)) {
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
