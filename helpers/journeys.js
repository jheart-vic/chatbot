// helpers/journeys.js
// CHUVI post-delivery journey engine, per the Customer Communication Manual:
//   T1  — delivery confirmation     (immediately, on order-delivered event)
//   T2  — feedback request          (+1 day; one gentle reminder +2 days later)
//   T3  — retention check-in        (+7 days)
//   R1–R3 — reactivation            (dormant 21d student/household, 35d professional;
//                                    then +7d, +7d, then STOP — never chase)
//
// Modes:
//   JOURNEY_TEST_MINUTES=true  → 1 "day" = 1 minute (watch the whole journey in ~30 min)
//   JOURNEY_USE_TEMPLATES=true → sends Meta-approved template messages (production,
//                                outside the 24h window). false = free-form (dev mode,
//                                works while you're actively chatting with the bot).
//
// Stops & respect rules (from the manual):
//   - supportMode (human handling) → nothing sends
//   - negative feedback (≤3★)      → automation stops until the next delivery
//   - customer replied to T2       → no reminder
//   - after R3                     → stop completely; door stays open

import User from '../models/User.js'
import Message from '../models/Message.js'
import {
  sendWhatsAppMessage,
  sendWhatsAppButtons,
  sendWhatsAppList,
  sendWhatsAppTemplate
} from './whatsApp.js'

const TEST_MODE = process.env.JOURNEY_TEST_MINUTES === 'true'
const USE_TEMPLATES = process.env.JOURNEY_USE_TEMPLATES === 'true'
const DAY_MS = TEST_MODE ? 60 * 1000 : 24 * 60 * 60 * 1000

// Days, per the manual
const TIMING = {
  t2: 1, // feedback request, 24h after delivery
  t2Reminder: 2, // one reminder, 48h after T2 (if no reply)
  t3: 7, // retention check-in
  dormant: { student: 21, professional: 35, household: 21 },
  reactivationGap: 7 // R1 → R2 → R3
}

// Meta template names (create these in WhatsApp Manager; override via env)
const TEMPLATES = {
  t1: process.env.TPL_T1 || 'chuvi_delivery_confirmation',
  t2: process.env.TPL_T2 || 'chuvi_feedback_request',
  t2Reminder: process.env.TPL_T2_REMINDER || 'chuvi_feedback_reminder',
  t3: process.env.TPL_T3 || 'chuvi_retention_checkin',
  r1: process.env.TPL_R1 || 'chuvi_reactivation_1',
  r2: process.env.TPL_R2 || 'chuvi_reactivation_2',
  r3: process.env.TPL_R3 || 'chuvi_reactivation_3'
}

const firstName = u =>
  (u.fullName || u.whatsappName || '').split(' ')[0] || 'there'

/* ------------------------------ message texts ------------------------------ */
/* Taken from the CHUVI manual, segment-aware where the manual differs. */

const RATING_ROWS = [
  { id: 'rating 5', title: '⭐⭐⭐⭐⭐ Excellent' },
  { id: 'rating 4', title: '⭐⭐⭐⭐ Good' },
  { id: 'rating 3', title: '⭐⭐⭐ Fair' },
  { id: 'rating 2', title: '⭐⭐ Needs Improvement' },
  { id: 'rating 1', title: '⭐ Poor' }
]

function t3Text (u) {
  const name = firstName(u)
  switch (u.segment) {
    case 'professional':
      return `Hello ${name}! 👋\n\nHope work has been going well. 😊\n\nJust checking in.\n\nWe're still helping professionals keep their shirts, native wear and work clothes ready for the week.\n\nAnd if a colleague ever mentions laundry frustrations, keep CHUVI in mind. 💙\nWe'd be happy to help them too.`
    case 'household':
      return `Hello ${name}! 👋\n\nHope you and the family are doing well. 😊\n\nJust checking in.\n\nWe're still helping households keep the laundry under control without spending the whole weekend washing and pressing.\n\nAnd if someone around you could use a reliable laundry service, feel free to tell them about CHUVI. 💙`
    default: // student
      return `Hello ${name}! 👋\n\nHope school has been going well. 😊\n\nJust checking in.\n\nIf practicals, tests or classes have been keeping you busy, we're still helping students keep their clothes and lab coats ready without the stress.\n\nAnd if you know a coursemate who could use a reliable laundry service, feel free to point them our way. 💙`
  }
}

function r1Text (u) {
  const name = firstName(u)
  switch (u.segment) {
    case 'professional':
      return `Hello ${name}! 👋\n\nIt's been a while since we last served you.\n\nYou already know the quality you can expect from CHUVI, and we've actually improved a lot since your last order.\n\nWe'd love the opportunity to serve you again.\n\nIf you book this week, we'll handle the delivery at no extra charge. 💙`
    case 'household':
      return `Hello ${name}! 👋\n\nIt's been a while since your last CHUVI order. 😊\n\nWe just wanted to check in and let you know we're still here whenever the laundry starts piling up again.\n\nAnd because it's been some time, delivery is on us if you need a pickup this week. 💙`
    default:
      return `Hello ${name}! 👋\n\nIt's been a while since we handled your last CHUVI order. 😊\n\nWe noticed we haven't seen your name on the pickup list recently and honestly wanted to check in.\n\nSince your last order we've improved a few things behind the scenes and we'd love for you to experience them.\n\nIf you need a pickup this week, delivery is on us. 💙`
  }
}

const r2Text = u =>
  `Hello ${firstName(u)}! 👋\n\nWe were reviewing some customer records recently and realised it's been quite some time since your last CHUVI order.\n\nTo be honest, we miss serving customers like you. 💙\n\nMost people come back because they remember how much time and stress CHUVI saved them.\n\nIf you've been thinking about sorting out the laundry again, we'd love to help.\nWe'll prioritise your pickup this week if you'd like to come back.`

const r3Text = u =>
  `Hello ${firstName(u)}! 👋\n\nThis will be our final check-in for now.\n\nWe genuinely appreciate that you've trusted CHUVI before and we'd love to serve you again.\n\nIf you place an order before the end of the week, we'll include:\n✅ Free Pickup\n✅ Free Delivery\n✅ Priority Processing\n\nNo codes. No conditions. Just a small thank you from us. 💙\n\nWhenever you're ready, we'll be happy to help.`

/* ------------------------------- send helper ------------------------------- */

async function deliver (user, key, { text, buttons, list, templateParams }) {
  try {
    if (USE_TEMPLATES) {
      await sendWhatsAppTemplate(user.phone, TEMPLATES[key], templateParams || [])
    } else if (list) {
      await sendWhatsAppList(user.phone, list.body, list.buttonText, list.rows, { sectionTitle: list.sectionTitle })
    } else if (buttons) {
      await sendWhatsAppButtons(user.phone, text, buttons)
    } else {
      await sendWhatsAppMessage(user.phone, text)
    }
    const logText = text || list?.body || `[template ${TEMPLATES[key]}]`
    await Message.create({ userId: user._id, from: 'bot', text: `${logText}${buttons ? ` [Buttons: ${buttons.map(b => b.title).join(' | ')}]` : ''}` })
    return true
  } catch (err) {
    console.error(`Journey send ${key} failed for ${user.phone}:`, err.response?.data?.error?.message || err.message)
    return false
  }
}

/* --------------------------- event: order delivered --------------------------- */
/** Called from the internal route when the backend reports a delivery. Sends T1
 *  immediately and resets the journey for a fresh cycle. */
export async function onOrderDelivered (user, { oscNumber, orderId, itemsCount, collected }) {
  const name = firstName(user)
  const text = collected
    ? `Hello ${name}! 👋\n\nThank you for collecting your CHUVI order today. 🎉\n\nOrder ID: *${oscNumber || orderId}*\nItems Collected: *${itemsCount || '-'}*\n\nPlease confirm everything is complete. 🙏`
    : `Hello ${name}! 👋\n\nYour CHUVI order has been delivered. 🎉\n\nOrder ID: *${oscNumber || orderId}*\nItems Returned: *${itemsCount || '-'}*\n\nPlease confirm everything arrived safely. 🙏`

  await deliver(user, 't1', {
    text,
    buttons: [
      { id: 'all items received complete', title: '✅ All Good' },
      { id: `I have an issue with order ${oscNumber || orderId}`, title: '⚠️ Report Issue' }
    ],
    templateParams: [name, String(oscNumber || orderId), String(itemsCount || '-')]
  })

  // fresh journey cycle
  user.journey = {
    ...user.journey,
    lastDeliveryAt: new Date(),
    lastActivityAt: new Date(),
    lastOscNumber: oscNumber || orderId,
    t2SentAt: null,
    t2ReminderAt: null,
    t3SentAt: null,
    feedbackAt: null,
    feedbackRating: null,
    stopped: false,
    r1At: null,
    r2At: null,
    r3At: null
  }
  user.markModified('journey')
  await user.save()
}

/* ----------------------------- feedback capture ----------------------------- */
/** Called by the agent's record_feedback tool. Returns guidance for the agent. */
export async function recordFeedback (user, rating, comment) {
  user.journey = {
    ...user.journey,
    feedbackAt: new Date(),
    feedbackRating: rating,
    ...(rating <= 3 && { stopped: true }) // manual: stop automation on negative feedback
  }
  user.markModified('journey')
  await user.save()
  return rating
}

/* --------------------------------- the tick --------------------------------- */

const NUDGE_AFTER_MS = TEST_MODE ? 2 * 60 * 1000 : 2 * 60 * 60 * 1000 // 2 min test / 2h prod

const FLOW_LABEL = {
  link_: 'linking your account',
  reg_: 'creating your account',
  reset_: 'resetting your password'
}

/** Nudge users who abandoned registration/linking/reset mid-flow — once. */
async function nudgeAbandonedFlows (now) {
  const stale = await User.find({
    'conversationState.step': { $regex: '^(link_|reg_|reset_)' },
    'conversationState.nudgedAt': { $in: [null, undefined] },
    lastInboundAt: { $lt: new Date(now - NUDGE_AFTER_MS) },
    supportMode: { $ne: true }
  }).limit(100)

  for (const u of stale) {
    try {
      const step = u.conversationState.step
      const label = FLOW_LABEL[Object.keys(FLOW_LABEL).find(p => step.startsWith(p))] || 'setting up your account'
      const text = `Hello ${firstName(u)}! 👋\n\nLooks like we didn't finish *${label}* earlier — you were almost done. 😊\n\nWant to pick up where we left off?`
      await sendWhatsAppButtons(u.phone, text, [
        { id: 'cmd:resume_flow', title: '▶️ Continue' },
        { id: 'cmd:cancel_flow', title: '❌ Cancel' }
      ])
      await Message.create({ userId: u._id, from: 'bot', text: `${text} [Buttons: Continue | Cancel]` })
      u.conversationState = { ...u.conversationState, nudgedAt: new Date() }
      u.markModified('conversationState')
      await u.save()
    } catch (err) {
      console.error('Flow nudge failed for', u.phone, err.message)
    }
  }
}

/** Nudge users who left a booking/inquiry unfinished — once, after they go quiet. */
async function nudgeAbandonedDrafts (now) {
  const stale = await User.find({
    draft: { $ne: null },
    'draft.resumedNudgeAt': { $in: [null, undefined] },
    lastInboundAt: { $lt: new Date(now - NUDGE_AFTER_MS) },
    supportMode: { $ne: true },
    'conversationState.step': { $in: [null, undefined] } // not mid structured-flow
  }).limit(100)

  for (const u of stale) {
    try {
      const d = u.draft || {}
      const what = d.kind === 'inquiry' ? 'something you were asking about' : 'an order you were setting up'
      const text = `Hello ${firstName(u)}! 👋\n\nWe didn't get to finish *${what}* earlier:\n_${d.summary || 'your request'}_\n\nWant to pick up where we left off? 😊`
      await sendWhatsAppButtons(u.phone, text, [
        { id: 'continue my ' + (d.kind || 'order') + ' where we left off', title: '▶️ Continue' },
        { id: 'cmd:cancel_draft', title: '❌ Cancel' }
      ])
      await Message.create({ userId: u._id, from: 'bot', text: `${text} [Buttons: Continue | Cancel]` })
      u.draft = { ...d, resumedNudgeAt: new Date() }
      u.markModified('draft')
      await u.save()
    } catch (err) {
      console.error('Draft nudge failed for', u.phone, err.message)
    }
  }
}

async function tick () {
  const now = Date.now()
  const since = (d) => d ? (now - new Date(d).getTime()) / DAY_MS : null

  await nudgeAbandonedFlows(now)
  await nudgeAbandonedDrafts(now)

  // Only linked users who have interacted before
  const users = await User.find({
    'chuvi.accessToken': { $exists: true, $ne: null },
    supportMode: { $ne: true }
  }).limit(500)

  for (const u of users) {
    try {
      const j = u.journey || {}
      let dirty = false

      /* ---- post-delivery flow ---- */
      if (j.lastDeliveryAt && !j.stopped) {
        const days = since(j.lastDeliveryAt)

        // T2 — feedback request
        if (!j.t2SentAt && days >= TIMING.t2) {
          const ok = await deliver(u, 't2', {
            list: {
              body: `Hello ${firstName(u)}! 👋\n\nThank you again for choosing CHUVI. 💙\n\nHow would you rate your experience?\n\nAfter your rating, please tell us in your own words: *what stood out most?*\n\nWe read every response and use them to improve. 🙏`,
              buttonText: 'Rate Us ⭐',
              rows: RATING_ROWS,
              sectionTitle: 'Your rating'
            },
            templateParams: [firstName(u)]
          })
          if (ok) { j.t2SentAt = new Date(); dirty = true }
        }

        // T2 reminder — once, only if no feedback yet
        if (j.t2SentAt && !j.feedbackAt && !j.t2ReminderAt && since(j.t2SentAt) >= TIMING.t2Reminder) {
          const ok = await deliver(u, 't2Reminder', {
            text: `Hello ${firstName(u)} 👋\n\nJust a gentle reminder.\n\nYour feedback helps us know what we're doing well and what to improve.\n\nPlease rate your CHUVI experience when you can. 🙏`,
            templateParams: [firstName(u)]
          })
          if (ok) { j.t2ReminderAt = new Date(); dirty = true }
        }

        // T3 — retention check-in
        if (!j.t3SentAt && days >= TIMING.t3) {
          const ok = await deliver(u, 't3', { text: t3Text(u), templateParams: [firstName(u)] })
          if (ok) { j.t3SentAt = new Date(); dirty = true }
        }
      }

      /* ---- reactivation flow ---- */
      const anchor = j.lastActivityAt || j.lastDeliveryAt
      if (anchor && !j.stopped && !u.supportMode) {
        const idle = since(anchor)
        const threshold = TIMING.dormant[u.segment] || TIMING.dormant.student

        if (!j.r1At && idle >= threshold) {
          const ok = await deliver(u, 'r1', { text: r1Text(u), templateParams: [firstName(u)] })
          if (ok) { j.r1At = new Date(); dirty = true }
        } else if (j.r1At && !j.r2At && since(j.r1At) >= TIMING.reactivationGap) {
          const ok = await deliver(u, 'r2', { text: r2Text(u), templateParams: [firstName(u)] })
          if (ok) { j.r2At = new Date(); dirty = true }
        } else if (j.r2At && !j.r3At && since(j.r2At) >= TIMING.reactivationGap) {
          const ok = await deliver(u, 'r3', { text: r3Text(u), templateParams: [firstName(u)] })
          if (ok) { j.r3At = new Date(); dirty = true } // after R3: stop. Door stays open.
        }
      }

      if (dirty) {
        u.journey = j
        u.markModified('journey')
        await u.save()
      }
    } catch (err) {
      console.error('Journey tick error for', u.phone, err.message)
    }
  }
}

let _interval = null
export function startJourneyEngine () {
  if (_interval) return
  const every = TEST_MODE ? 20 * 1000 : 10 * 60 * 1000 // 20s in test, 10 min in prod
  _interval = setInterval(() => tick().catch(e => console.error('Journey tick failed:', e.message)), every)
  console.log(`🧭 Journey engine started (${TEST_MODE ? 'TEST clock: 1 day = 1 min' : 'real clock'}, ${USE_TEMPLATES ? 'template' : 'free-form'} sends)`)
}

export default { startJourneyEngine, onOrderDelivered, recordFeedback }
