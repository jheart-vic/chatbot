// helpers/agent.js
// The Chuvi WhatsApp agent: an OpenAI tool-calling loop where every tool maps
// to a real chuvibackend endpoint, so the bot can do anything an app user can do.

import 'dotenv/config'
import OpenAI from 'openai'
import MessageModel from '../models/Message.js'
import { ChuviClient, ChuviApiError } from '../services/chuviApi.js'
import { recordFeedback } from './journeys.js'
import { WEBSITE_URL, locationsForPrompt, BRANCHES } from './companyInfo.js'
import { sendWhatsAppMessage, sendWhatsAppButtons, sendWhatsAppCtaUrl, sendWhatsAppList } from './whatsApp.js'

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o'
const OPERATIONS_NUMBER = process.env.OPERATIONS_NUMBER

// Fallback prices used ONLY if the live config can't be fetched (e.g. user not
// linked yet and asking for a rough quote). Live prices come from
// GET /admin/admin-order-details (orderItems + fees + surcharges).
export const FALLBACK_PRICES = {
  shirt: 500,
  trouser: 500,
  jean: 500,
  short: 500,
  native: 600,
  agbada: 1500,
  dress: 1500,
  suit: 2000,
  bedsheet: 1500,
  pillowcase: 300,
  duvet: 3000,
  blanket: 3000,
  curtain: 1500,
  towel: 500
}

/* ------------------- live booking config (cached) ------------------- */

const CONFIG_TTL_MS = 10 * 60 * 1000 // 10 minutes
let _configCache = { data: null, at: 0 }

/**
 * Fetch live prices/fees from the backend, cached for CONFIG_TTL_MS.
 * Requires a linked user session (any linked user works — the data is global).
 */
export async function getLiveOrderConfig (api, { force = false } = {}) {
  const fresh = _configCache.data && (Date.now() - _configCache.at) < CONFIG_TTL_MS
  if (fresh && !force) return _configCache.data

  const raw = await api.getOrderConfig()
  const cfg = raw?.message || raw || {}
  const priceMap = {}
  for (const item of cfg.orderItems || []) {
    if (item?.name) priceMap[item.name.toLowerCase().trim()] = item
  }
  const data = {
    priceMap, // lowercased name -> {name, price, isHeavy}
    orderItems: cfg.orderItems || [],
    heavyItems: cfg.heavyItems || [],
    serviceTypes: cfg.serviceType || [],
    pickupTimeSlots: cfg.pickupTime || ['10am-12pm', '4pm-6pm'],
    deliveryFee: cfg.deliveryFee ?? 500,
    pickupFee: cfg.pickupFee ?? 500,
    sameDayCharge: cfg.sameDayCharge ?? 300,
    expressCharge: cfg.expressCharge ?? 100,
    premiumServiceTierCharge: cfg.premiumServiceTierCharge ?? 1.5,
    vipServiceTierCharge: cfg.vipServiceTierCharge ?? 2,
    bankDetails: cfg.bankDetails || null
  }
  _configCache = { data, at: Date.now() }
  return data
}

/** Resolve an item name to a live price entry (handles plurals/case). */
export function resolveItem (priceMap, name) {
  if (!name) return null
  const n = String(name).toLowerCase().trim()
  if (priceMap[n]) return priceMap[n]
  // singular/plural tolerance: "shirts" -> "shirt", "dress" -> "dresses"
  if (n.endsWith('es') && priceMap[n.slice(0, -2)]) return priceMap[n.slice(0, -2)]
  if (n.endsWith('s') && priceMap[n.slice(0, -1)]) return priceMap[n.slice(0, -1)]
  if (priceMap[n + 's']) return priceMap[n + 's']
  return null
}

const SYSTEM_PROMPT = `You are Chuvi, the WhatsApp assistant and first line of customer support for CHUVI Laundry (Agulu/Awka, Nigeria). You handle conversion, orders, payments, support, and complaints — following the CHUVI Customer Communication Manual below.

WHAT CHUVI SELLS
Not just washing. Convenience, reliability, accountability, peace of mind, and confidence in how customers show up. Every reply should reflect that.

VOICE — every message must be:
Short. Clear. Calm. Human. Professional. Lightly personal. Understood at a glance. Properly spaced (short lines, blank lines between thoughts). If the customer must struggle to read it, it's too heavy. Never sound irritated, desperate, or argumentative. Use the person's first name when known. WhatsApp formatting: *bold* for key info (amounts, dates, order IDs), occasional fitting emoji (🧺 💳 🚚 ✅ 🙏 💙). No headers, no tables. Naira as ₦1,500. Dates like "12 Jun, 3:45pm".

CAPABILITIES (tools)
Book orders, order history, track orders, report issues; wallet balance/transactions/top-up/pay; Paystack payment links for orders & subscriptions; plans (view/subscribe/cancel/current); profile & addresses; notifications; human escalation. Business hours: Tue–Sat 9am–7pm, Sun 12pm–7pm.

WEBSITE & LOCATIONS
- Website: share the website link ONLY when the customer asks about the website, ordering online, or other ways to order/track. Don't volunteer it otherwise. If no website is configured, say online ordering is via this WhatsApp for now.
- Locations: when asked where we are, which branch is nearest, or for an address/directions, give the relevant branch name + address (+ hours if useful) from the LOCATIONS list provided below. If they name an area, point them to the closest branch. If no branches are configured, say you'll connect them to the team for the nearest location (escalate).

GENERAL CONVERSATION & SCOPE
- People will chat casually — greetings, "how are you", jokes, small talk about their day, school, or work. Respond warmly and briefly like a friendly front-desk person, then gently steer back to how you can help with laundry.
- Stay within CHUVI's world: laundry, fabric care, stain questions, our services, prices, orders, payments, and the customer's account. You MAY give quick practical fabric-care/stain tips — that builds trust.
- Politely decline unrelated tasks (homework, essays, code, news, politics, other businesses): "I'm Chuvi's laundry assistant, so that's outside what I can help with 😊 — but if it involves your clothes or an order, I'm your person." Never be preachy about declining.
- Never invent data, prices, or order details. If a tool fails, say so plainly and offer the next step.

CONVERSION FLOW (new/enquiring customers): Greet → Qualify → Offer → Handle objection → Close.
- Qualify with ONLY necessary questions, one at a time: what items? when needed back? pickup or drop-off (address if pickup)? any stains/delicates/special instructions?
- Offer clearly and confidently: items, *amount*, *ready-by*, service speed. No over-explaining, no sounding unsure. Use live prices (get_price_list) — never guess.
- Close with ONE clear next step, e.g. "Should I prepare the order for you?"

OBJECTION RULE — Agree → Reframe → Proof → Forward. Never open with "No/But/Actually". Never end on the objection; always end moving forward.
Proof points (use these, not "we are good"): we count every item with you, record the order, inspect before processing, send updates, confirm delivery, collect feedback.
Stances:
- "Too expensive / others cheaper": agree we're probably not the cheapest; we focus on reliability and peace of mind; many switched to us from cheaper places; invite them to try once and compare. Then forward.
- "I'll wash it myself": totally fine — most customers can; CHUVI saves time and stress, especially with school/work/family. Offer Standard or Express.
- "I don't trust laundries / what if you lose or damage my clothes": fair concern; we count and document before processing, inspect and point out existing damage first; if we ever cause damage we take responsibility and make it right. Suggest starting with a few items.
- "I need it urgently": ask the exact time needed, then recommend the safest option (standard/express/same-day). Never promise what we can't deliver.
- "Let me think about it": absolutely — ask if anything is unclear (price, timing, or trust?) so they can decide well.
- "Not ready to pay now": no pressure at all; ask when to follow up, and leave the door open.

PAYMENTS — proactive and reassuring
- After creating a pay-per-item order: immediately offer payment via send_payment_button (Paystack) or pay_order_with_wallet. Show *amount* and reference.
- Deliver EVERY Paystack link via send_payment_button — never paste raw URLs.
- Insufficient wallet balance: state balance and shortfall calmly, offer top-up button or direct payment link.
- PAYMENT FAILED (customer says it failed, or asks why): reassure first — failed Paystack charges don't take money, and any debit reverses automatically. Then offer a fresh payment link, or wallet payment as an alternative. If they say they were debited but the order shows unpaid: check the order's paymentStatus, explain confirmation can take a few minutes, and if it doesn't resolve, escalate to a human with the reference — never argue about whether they paid.
- "I paid but it's still pending": check get_order paymentStatus, reassure, escalate if unresolved.

COMPLAINTS — CHUVI Recovery Framework: Thank → Understand → Take ownership → Resolve → Follow up.
- Always thank them first ("Thank you for bringing this to our attention 🙏"). Never defend, argue, blame, or say "that's impossible".
- Understand: ask exactly what happened, which item, when noticed.
- Take ownership before fault is determined: "We're sorry your experience wasn't what it should have been. We're looking into it immediately."
- Resolve with tools where possible (report_delivery_issue for missing/damaged/late items), and tell them what happens next.
- ESCALATE IMMEDIATELY (escalate_to_support) for: damage claims, refund requests, threats or legal mentions, social-media escalation, repeated complaints from the same customer, or a missing item not resolved quickly. Confirm a human will take over in this same chat.

FEEDBACK (when customers rate or comment after delivery)
- When a customer gives a rating (stars, a number, or picks from the rating list), ALWAYS call record_feedback with the rating (1-5) and their comment.
- 5★: warm thanks ("Thank you so much 💙 we're glad you loved the service"), then the referral note: "If anyone around you ever needs help with laundry, feel free to keep CHUVI in mind — we'd be happy to help them too. 😊"
- 4★: thanks + "what can we do to make it 5 stars next time?" — then the same referral note.
- 3★ or below: thank them for honesty, apologise, ask exactly what happened — and escalate_to_support; negative feedback is never handled by automation alone.
- "I haven't used it yet": no problem at all, ask them to check when they can.
- Never argue with feedback. Never turn feedback into selling. Never ask unhappy customers for referrals.

RETENTION TONE
Good retention says "we're still here", never "order again". Don't push subscriptions on new customers — only mention plans if the customer asks, or if they're clearly a regular (several successful orders).

INTERACTIVE MESSAGES (buttons) — strongly preferred over plain text
- send_payment_button: for EVERY Paystack link (label like "Pay Now 💳").
- send_quick_replies: when next steps are obvious — max 3 buttons, titles ≤20 chars. E.g. after order: [💳 Pay Now] [👛 Pay from Wallet]; after payment: [🚚 Track Order] [🧾 My Orders].
- send_list: for 4–10 options (plans, addresses, time slots, recent orders).
- These tools SEND immediately. After sending everything needed, reply exactly NO_REPLY to avoid duplicate texts. Button ids should be short human phrases echoed back as text.

ORDER BOOKING RULES
- ALWAYS call get_price_list before quoting or summarising — prices, fees, speed charges, tier multipliers come from there (live). Only quote items on the live list; offer close alternatives for unknown items.
- Required before create_book_order: items (name + quantity), serviceType, serviceTier (classic/premium/vip), deliverySpeed (standard/express/same-day), pickup and/or delivery (address, date, a time slot from live config), billingType (pay-per-item / pay-from-wallet / pay-from-subscription).
- Pre-fill name/phone/addresses from get_account and list_addresses instead of re-asking.
- ALWAYS show a clear order summary with the total and get an explicit "yes" before calling create_book_order.

ACCOUNT
- If a tool returns NOT_LINKED: explain they need to connect their CHUVI account — reply *link account* (or *create account* if new). Never ask for their password yourself; the secure flow handles it.
- If SESSION_EXPIRED: apologise briefly and ask them to reply *link account* to sign in again.
`

/* ----------------------------- tool schemas ----------------------------- */

const tools = [
  // profile
  { type: 'function', function: { name: 'get_dashboard', description: 'User dashboard summary: recent orders, wallet, subscription overview.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'get_account', description: 'Get the linked user profile (name, email, phone, etc.).', parameters: { type: 'object', properties: {} } } },
  {
    type: 'function',
    function: {
      name: 'update_profile',
      description: 'Update profile fields on the linked account.',
      parameters: {
        type: 'object',
        properties: {
          fullName: { type: 'string' },
          phoneNumber: { type: 'string' }
        }
      }
    }
  },
  { type: 'function', function: { name: 'list_addresses', description: 'List saved addresses.', parameters: { type: 'object', properties: {} } } },
  {
    type: 'function',
    function: {
      name: 'add_address',
      description: 'Save a new address to the user profile.',
      parameters: {
        type: 'object',
        properties: { address: { type: 'string' }, label: { type: 'string', description: 'e.g. Home, Office' } },
        required: ['address']
      }
    }
  },

  // pricing & orders
  { type: 'function', function: { name: 'get_price_list', description: 'Current per-item laundry price list in Naira.', parameters: { type: 'object', properties: {} } } },
  {
    type: 'function',
    function: {
      name: 'create_book_order',
      description: 'Create a laundry order AFTER the user has confirmed the summary. Items use types from get_price_list.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', description: 'item name exactly as it appears on get_price_list' },
                quantity: { type: 'integer', minimum: 1 }
              },
              required: ['type', 'quantity']
            }
          },
          serviceType: { type: 'string', enum: ['wash-and-iron', 'dry-cleaning'] },
          serviceTier: { type: 'string', enum: ['classic', 'premium', 'vip'] },
          deliverySpeed: { type: 'string', enum: ['standard', 'express', 'same-day'] },
          billingType: { type: 'string', enum: ['pay-per-item', 'pay-from-wallet', 'pay-from-subscription'] },
          isPickUp: { type: 'boolean' },
          isDelivery: { type: 'boolean' },
          pickupAddress: { type: 'string' },
          deliveryAddress: { type: 'string' },
          pickupDate: { type: 'string', description: 'YYYY-MM-DD' },
          pickupTime: { type: 'string', description: 'e.g. 10am-12pm' },
          extraNote: { type: 'string' }
        },
        required: ['items', 'serviceType', 'serviceTier', 'deliverySpeed', 'billingType', 'isPickUp', 'isDelivery']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'order_history',
      description: 'Fetch the user\'s past and active orders.',
      parameters: { type: 'object', properties: { page: { type: 'integer' }, limit: { type: 'integer' } } }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_order',
      description: 'Get a single order with its current stage/status and payment status. Use to track an order.',
      parameters: { type: 'object', properties: { orderId: { type: 'string' } }, required: ['orderId'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'report_delivery_issue',
      description: 'Report an issue with an order (missing item, damage, late delivery, etc.).',
      parameters: {
        type: 'object',
        properties: { orderId: { type: 'string' }, issue: { type: 'string' } },
        required: ['orderId', 'issue']
      }
    }
  },

  // wallet & payments
  { type: 'function', function: { name: 'wallet_balance', description: 'Current wallet balance.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'wallet_transactions', description: 'Recent wallet transactions.', parameters: { type: 'object', properties: { page: { type: 'integer' }, limit: { type: 'integer' } } } } },
  {
    type: 'function',
    function: {
      name: 'wallet_top_up',
      description: 'Start a wallet top-up. Returns a secure Paystack authorization_url to send to the user.',
      parameters: { type: 'object', properties: { amount: { type: 'integer', description: 'Naira, e.g. 5000' } }, required: ['amount'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'pay_order_with_wallet',
      description: 'Pay an existing unpaid order from the user wallet.',
      parameters: { type: 'object', properties: { orderId: { type: 'string' } }, required: ['orderId'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_payment_link',
      description: 'Generate a secure Paystack payment link for an unpaid order or a subscription plan.',
      parameters: {
        type: 'object',
        properties: {
          transactionType: { type: 'string', enum: ['order', 'subscription'] },
          orderId: { type: 'string', description: 'required when transactionType=order' },
          planId: { type: 'string', description: 'required when transactionType=subscription' }
        },
        required: ['transactionType']
      }
    }
  },

  // subscriptions
  { type: 'function', function: { name: 'get_plans', description: 'List available subscription plans with prices and monthly limits.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'current_subscription', description: 'The user\'s current subscription, if any.', parameters: { type: 'object', properties: {} } } },
  {
    type: 'function',
    function: {
      name: 'subscribe_plan',
      description: 'Subscribe the user to a plan (creates the subscription; payment is completed via get_payment_link with transactionType=subscription).',
      parameters: { type: 'object', properties: { planId: { type: 'string' } }, required: ['planId'] }
    }
  },
  { type: 'function', function: { name: 'cancel_subscription', description: 'Cancel the active subscription. Confirm with the user first.', parameters: { type: 'object', properties: {} } } },

  // notifications
  { type: 'function', function: { name: 'get_notifications', description: 'Fetch the user\'s notifications.', parameters: { type: 'object', properties: { limit: { type: 'integer' } } } } },
  { type: 'function', function: { name: 'mark_all_notifications_read', description: 'Mark all notifications as read.', parameters: { type: 'object', properties: {} } } },

  // interactive messages (these SEND immediately)
  {
    type: 'function',
    function: {
      name: 'send_payment_button',
      description: 'Send the user a message with a tappable URL button that opens a payment page. Use for ALL Paystack links. Sends immediately.',
      parameters: {
        type: 'object',
        properties: {
          body: { type: 'string', description: 'message text shown above the button, e.g. amount + reference' },
          url: { type: 'string', description: 'the Paystack authorization_url' },
          button_label: { type: 'string', description: '≤20 chars, e.g. "Pay Now 💳"' }
        },
        required: ['body', 'url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_quick_replies',
      description: 'Send a message with up to 3 tappable quick-reply buttons. The tapped button title comes back as the user\'s next message. Sends immediately.',
      parameters: {
        type: 'object',
        properties: {
          body: { type: 'string' },
          buttons: {
            type: 'array',
            maxItems: 3,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'short phrase echoed back on tap (defaults to title)' },
                title: { type: 'string', description: '≤20 chars incl. emoji' }
              },
              required: ['title']
            }
          },
          footer: { type: 'string', description: 'optional small grey text, ≤60 chars' }
        },
        required: ['body', 'buttons']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_list',
      description: 'Send a tappable list picker (4-10 options): plans, addresses, time slots, orders. The chosen row title comes back as the user\'s next message. Sends immediately.',
      parameters: {
        type: 'object',
        properties: {
          body: { type: 'string' },
          button_text: { type: 'string', description: 'label that opens the list, ≤20 chars, e.g. "View Plans"' },
          rows: {
            type: 'array',
            maxItems: 10,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'short phrase echoed back on selection (defaults to title)' },
                title: { type: 'string', description: '≤24 chars' },
                description: { type: 'string', description: '≤72 chars, e.g. price/details' }
              },
              required: ['title']
            }
          },
          section_title: { type: 'string', description: '≤24 chars' }
        },
        required: ['body', 'button_text', 'rows']
      }
    }
  },

  {
    type: 'function',
    function: {
      name: 'record_feedback',
      description: 'Record a customer rating (1-5) after delivery. ALWAYS call when a rating is given. Returns guidance for the follow-up.',
      parameters: {
        type: 'object',
        properties: {
          rating: { type: 'integer', minimum: 1, maximum: 5 },
          comment: { type: 'string', description: 'their own words, verbatim' }
        },
        required: ['rating']
      }
    }
  },

  // support
  {
    type: 'function',
    function: {
      name: 'escalate_to_support',
      description: 'Hand the conversation to a human support agent. Use for complaints you cannot resolve, payment disputes, or when the user asks for a human.',
      parameters: {
        type: 'object',
        properties: { summary: { type: 'string', description: 'one-paragraph summary of the issue for the agent' } },
        required: ['summary']
      }
    }
  }
]

/* ----------------------------- tool executor ----------------------------- */

async function execTool (name, args, ctx) {
  const { botUser } = ctx
  const api = new ChuviClient(botUser)

  const needsLink = ![
    'get_price_list', 'escalate_to_support', 'record_feedback',
    'send_payment_button', 'send_quick_replies', 'send_list'
  ].includes(name)

  if (needsLink && !api.isLinked) return { error: 'NOT_LINKED' }

  try {
    switch (name) {
      case 'get_dashboard': return await api.getDashboard()
      case 'get_account': return await api.getAccount()
      case 'update_profile': return await api.updateUser(args)
      case 'list_addresses': return await api.getAddresses()
      case 'add_address': return await api.addAddress(args)

      case 'get_price_list': {
        if (api.isLinked) {
          try {
            const cfg = await getLiveOrderConfig(api)
            return {
              currency: 'NGN',
              source: 'live',
              items: cfg.orderItems.map(i => ({ name: i.name, price: i.price, isHeavy: !!i.isHeavy })),
              fees: { deliveryFee: cfg.deliveryFee, pickupFee: cfg.pickupFee },
              deliverySpeedCharge: { standard: 0, express: cfg.expressCharge, 'same-day': cfg.sameDayCharge },
              serviceTierMultiplier: { classic: 1, premium: cfg.premiumServiceTierCharge, vip: cfg.vipServiceTierCharge },
              serviceTypes: cfg.serviceTypes,
              pickupTimeSlots: cfg.pickupTimeSlots
            }
          } catch (e) {
            console.error('Live config fetch failed:', e.message)
          }
        }
        return {
          currency: 'NGN',
          source: 'fallback',
          note: 'Indicative prices only — tell the user exact prices are confirmed at booking (or after linking their account).',
          prices: FALLBACK_PRICES,
          deliverySpeedSurcharge: { standard: '0%', express: 'extra charge', 'same-day': 'extra charge' }
        }
      }

      case 'create_book_order': {
        const [account, cfg] = await Promise.all([
          api.getAccount().catch(() => null),
          getLiveOrderConfig(api).catch(e => {
            console.error('Live config fetch failed:', e.message)
            return null
          })
        ])
        if (!cfg) return { error: 'Could not load the current price list from the server, so the order was NOT created. Ask the user to try again shortly or escalate.' }

        const profile = account?.user || account || {}
        const unknown = []
        const items = (args.items || []).map(i => {
          const live = resolveItem(cfg.priceMap, i.type)
          if (!live) { unknown.push(i.type); return null }
          // Live DB price is the source of truth — never trust an LLM-passed price.
          return { type: live.name, quantity: i.quantity, price: live.price }
        }).filter(Boolean)

        if (unknown.length) {
          return {
            error: `These items are not on the current price list: ${unknown.join(', ')}. The order was NOT created.`,
            availableItems: cfg.orderItems.map(i => i.name)
          }
        }
        const payload = {
          fullName: profile.fullName || botUser.fullName || botUser.whatsappName,
          phoneNumber: profile.phoneNumber || botUser.phone,
          ...args,
          items
        }
        const order = await api.createBookOrder(payload)
        botUser.journey = { ...botUser.journey, lastActivityAt: new Date(), r1At: null, r2At: null, r3At: null }
        botUser.markModified('journey')
        await botUser.save()
        return { order, note: 'If billingType is pay-per-item, offer a Paystack link (get_payment_link) or wallet payment now.' }
      }
      case 'order_history': return await api.orderHistory(args)
      case 'get_order': return await api.getOrder(args.orderId)
      case 'report_delivery_issue': return await api.reportDeliveryIssue(args.orderId, { issue: args.issue })

      case 'wallet_balance': return await api.walletBalance()
      case 'wallet_transactions': return await api.walletTransactions(args)
      case 'wallet_top_up': return await api.walletTopUp(args.amount)
      case 'pay_order_with_wallet': return await api.payWithWallet(args.orderId)
      case 'get_payment_link': return await api.initializePayment(args)

      case 'get_plans': return await api.getPlans()
      case 'current_subscription': return await api.currentSubscription()
      case 'subscribe_plan': return await api.subscribePlan(args.planId)
      case 'cancel_subscription': return await api.cancelSubscription()

      case 'get_notifications': return await api.getNotifications(args)
      case 'mark_all_notifications_read': return await api.markAllNotificationsRead()

      case 'send_payment_button': {
        const label = args.button_label || 'Pay Now 💳'
        await sendWhatsAppCtaUrl(botUser.phone, args.body, label, args.url, { footer: 'Secure payment via Paystack' })
        await MessageModel.create({ userId: botUser._id, from: 'bot', text: `${args.body} [Button: ${label} → ${args.url}]` })
        return { sent: true, note: 'Payment button delivered. Reply NO_REPLY unless you have something new to add.' }
      }

      case 'send_quick_replies': {
        const buttons = (args.buttons || []).slice(0, 3).map(b => ({ id: b.id || b.title, title: b.title }))
        await sendWhatsAppButtons(botUser.phone, args.body, buttons, { footer: args.footer })
        await MessageModel.create({ userId: botUser._id, from: 'bot', text: `${args.body} [Buttons: ${buttons.map(b => b.title).join(' | ')}]` })
        return { sent: true, note: 'Buttons delivered. Reply NO_REPLY unless you have something new to add.' }
      }

      case 'send_list': {
        const rows = (args.rows || []).slice(0, 10).map(r => ({ id: r.id || r.title, title: r.title, description: r.description }))
        await sendWhatsAppList(botUser.phone, args.body, args.button_text, rows, { sectionTitle: args.section_title })
        await MessageModel.create({ userId: botUser._id, from: 'bot', text: `${args.body} [List "${args.button_text}": ${rows.map(r => r.title).join(' | ')}]` })
        return { sent: true, note: 'List delivered. Reply NO_REPLY unless you have something new to add.' }
      }

      case 'record_feedback': {
        await recordFeedback(botUser, args.rating, args.comment || '')
        if (args.rating >= 4) return { saved: true, next: 'Thank them warmly and add the referral note. Ask permission before any public use of their words.' }
        return { saved: true, next: 'Thank them for honesty, apologise, ask what happened, then escalate_to_support with their comment.' }
      }

      case 'escalate_to_support': {
        botUser.supportMode = true
        await botUser.save()
        if (OPERATIONS_NUMBER) {
          const who = botUser.fullName || botUser.whatsappName || botUser.phone
          await sendWhatsAppMessage(
            OPERATIONS_NUMBER,
            `🆘 *Support handoff*\nCustomer: ${who} (wa: ${botUser.phone})\nLinked account: ${botUser.chuvi?.email || 'not linked'}\n\nIssue: ${args.summary}\n\nReply to the customer directly. Send *#resume* in their chat thread context to hand back to the bot.`
          ).catch(e => console.error('Ops alert failed:', e.message))
        }
        return { ok: true, message: 'A human agent has been notified and will continue in this chat.' }
      }

      default:
        return { error: `Unknown tool ${name}` }
    }
  } catch (err) {
    if (err instanceof ChuviApiError) {
      if (err.message === 'SESSION_EXPIRED') return { error: 'SESSION_EXPIRED' }
      return { error: err.message }
    }
    console.error(`Tool ${name} failed:`, err)
    return { error: 'Something went wrong on our side. Offer to escalate if it persists.' }
  }
}

/* ----------------------------- agent loop ----------------------------- */

async function recentHistory (botUserId, limit = 14) {
  const msgs = await MessageModel.find({ userId: botUserId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean()
  return msgs.reverse().map(m => ({
    role: m.from === 'user' ? 'user' : 'assistant',
    content: m.text || ''
  })).filter(m => m.content)
}

/**
 * Run the agent for one incoming user message. Returns the reply text.
 */
export async function runAgent (botUser, userText) {
  const linkedNote = botUser.chuvi?.email
    ? `The user's WhatsApp is linked to Chuvi account ${botUser.chuvi.email}.`
    : 'The user has NOT linked a Chuvi account yet. Account features will return NOT_LINKED.'

  const websiteLine = WEBSITE_URL
    ? `Website (share only when asked about website/online ordering): ${WEBSITE_URL}`
    : 'Website: none configured — online ordering is via this WhatsApp for now.'
  const locationsLine = `LOCATIONS (branches):\n${locationsForPrompt()}`

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: `Context: user's WhatsApp name is ${botUser.whatsappName || 'unknown'}, phone ${botUser.phone}. ${linkedNote} Today: ${new Date().toDateString()}.` },
    { role: 'system', content: `${websiteLine}\n${locationsLine}` },
    ...(await recentHistory(botUser._id)),
    { role: 'user', content: userText }
  ]

  for (let turn = 0; turn < 6; turn++) {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools,
      tool_choice: 'auto',
      temperature: 0.4
    })

    const msg = completion.choices[0].message
    messages.push(msg)

    if (!msg.tool_calls?.length) {
      return msg.content?.trim() || '🤔 Sorry, could you say that again?'
    }

    for (const call of msg.tool_calls) {
      let args = {}
      try { args = JSON.parse(call.function.arguments || '{}') } catch (_) {}
      console.log(`🔧 Tool: ${call.function.name}`, args)
      const result = await execTool(call.function.name, args, { botUser })
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result).slice(0, 12000)
      })
    }
  }

  return '⚠️ That took longer than expected. Could you rephrase, or reply *agent* to talk to a human?'
}

export default runAgent
