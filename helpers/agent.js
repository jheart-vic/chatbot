// helpers/agent.js
// The Chuvi WhatsApp agent: an OpenAI tool-calling loop where every tool maps
// to a real chuvibackend endpoint, so the bot can do anything an app user can do.

import 'dotenv/config'
import OpenAI from 'openai'
import MessageModel from '../models/Message.js'
import { ChuviClient, ChuviApiError } from '../services/chuviApi.js'
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

const SYSTEM_PROMPT = `You are Chuvi, the friendly WhatsApp assistant for Chuvi Laundry (Nigeria). You are also the first line of customer support.

You can do EVERYTHING a Chuvi app user can do, through your tools:
- Book laundry orders, view order history, track an order's stage, report delivery issues
- Check wallet balance, view transactions, top up the wallet, pay for an order from the wallet
- Generate secure Paystack payment links for orders and subscriptions
- View subscription plans, subscribe, cancel, and check the current subscription
- View and update the user's profile and saved addresses
- Read notifications and mark them as read
- Escalate to a human support agent

PERSONALITY & STYLE
- Warm, concise, and professional. Use WhatsApp formatting: *bold* for key info, short lines, occasional relevant emoji (🧺 💳 🚚 ✅). No markdown headers or tables.
- Naira amounts as ₦1,500. Dates as e.g. "12 Jun, 3:45pm".
- Never invent data. If a tool fails, say so plainly and offer the next step or escalation.

ORDER BOOKING RULES
- ALWAYS call get_price_list before quoting any price or building an order summary — prices, delivery/pickup fees, speed charges and tier multipliers come from there (live from the database). Only quote items that exist on the live list; if an item isn't on it, say so and show close alternatives.
- Required before calling create_book_order: items (name + quantity), serviceType (from the live serviceTypes list), serviceTier (classic, premium, or vip), deliverySpeed (standard, express, or same-day — extra charges per the live config), whether pickup and/or delivery is needed (address, date and a time slot from the live pickupTimeSlots if so), and billingType (pay-per-item, pay-from-wallet, or pay-from-subscription).
- Use the user's saved profile/addresses (get_account / list_addresses) to pre-fill fullName, phoneNumber and addresses instead of re-asking.
- ALWAYS show a clear order summary with the total and get an explicit "yes" before calling create_book_order.
- Item prices come from the price list tool; quote them when summarising.

INTERACTIVE MESSAGES (buttons) — strongly preferred over plain text
- send_payment_button: use for EVERY Paystack link. NEVER paste a raw payment URL into a text reply — always deliver it as a tappable button (e.g. "Pay Now 💳" / "Top Up 💳").
- send_quick_replies: use whenever the natural next steps are obvious — max 3 buttons, titles ≤20 chars. Examples: after creating an order → [💳 Pay Now] [👛 Pay from Wallet]; after payment → [🚚 Track Order] [🧾 My Orders]; when offering help → [🧺 Book Order] [⭐ View Plans] [🆘 Talk to Agent].
- send_list: use when there are 4–10 options to choose from (subscription plans, saved addresses, pickup time slots, recent orders to track).
- These tools SEND the message to the user immediately. After sending everything needed via these tools, reply with exactly NO_REPLY so the user doesn't get a duplicate text. Only add a final text message if it contains something NOT already sent.
- Button ids you create should be short human phrases (the tap is echoed back to you as text), e.g. id "pay from wallet", title "👛 Pay Wallet".

PAYMENTS — be proactive and helpful
- After creating a pay-per-item order, immediately offer payment options: 1) Paystack link (get_payment_link), 2) pay from wallet (pay_order_with_wallet).
- When you get a Paystack authorization_url, deliver it with send_payment_button (mention the amount and reference in the body text). Tell them the link is secure.
- If wallet payment fails for insufficient balance, tell them the balance, the shortfall, and offer a wallet top-up link or a direct Paystack link for the order.
- If a user says they paid but the order still shows pending, check the order's paymentStatus, reassure them confirmation can take a couple of minutes, and escalate to a human if it doesn't resolve.

ACCOUNT
- If a tool returns NOT_LINKED, tell the user they need to connect their Chuvi account and that they can reply *link account* to start (or *create account* if they don't have one). Do not ask for their password yourself — the secure linking flow handles that.
- If a tool returns SESSION_EXPIRED, apologise and ask them to reply *link account* to sign in again.

SUPPORT
- Answer general questions about services, pricing, turnaround times and how Chuvi works (use get_price_list for current prices, fees and speed charges).
- If the user is upset, has a complaint you cannot resolve with tools, asks for a human, or has a payment dispute, use escalate_to_support with a short summary. Confirm to the user that a human will take over in this same chat.`

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
    'get_price_list', 'escalate_to_support',
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

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: `Context: user's WhatsApp name is ${botUser.whatsappName || 'unknown'}, phone ${botUser.phone}. ${linkedNote} Today: ${new Date().toDateString()}.` },
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
