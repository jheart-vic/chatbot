# Chuvi WhatsApp Bot — Backend Integration Upgrade

The bot is now a full agent over **chuvibackend**: anything a Chuvi app user can do, a WhatsApp user can now do in chat — plus AI customer support and payment assistance.

## What changed

| File | Change |
|---|---|
| `services/chuviApi.js` | **Rewritten.** Per-user `ChuviClient` matching the real backend routes. Handles the backend's httpOnly-cookie auth: captures `Set-Cookie` on login/refresh, stores tokens on the bot's User doc, replays them as a `Cookie` header, auto-refreshes once on `jwt_expired` and retries. Old version had wrong endpoints, a global shared auth header (token bleed between users), and a broken `exports =` in an ES module. |
| `helpers/agent.js` | **New.** OpenAI function-calling agent. ~20 tools mapped 1:1 to backend endpoints: orders (book / history / track / report issue), wallet (balance / transactions / top-up / pay order), payments (Paystack links via `/users/initialize-payment`), subscriptions (plans / subscribe / cancel / current), profile & addresses, notifications, and `escalate_to_support`. Reads the last 14 chat messages for context. |
| `controllers/botController.js` | **Rewritten** (old one kept as `botController.legacy.js`). Pipeline: dedupe → human-handoff check → account-link state machine → agent. |
| `models/User.js` | Added `chuvi` (linked account + tokens), `supportMode`, and `linkDraft` in conversation state. |
| `controllers/whatsappController.js` | No longer logs message bodies (passwords could appear during linking). |

## User flows

**Account linking** — `link account` → email → password → logged into chuvibackend, cookies stored. `create account` → name → email → password → OTP verify → link. Passwords are **never** stored in the Message log (masked as `••••••••`) and **never** passed to the LLM — the state machine handles them directly. `unlink` / `logout` disconnects.

**Payments** — after a pay-per-item order the bot proactively offers: a Paystack link (`initialize-payment`, returns `authorization_url` + reference) or wallet payment (`pay-with-wallet`). Insufficient balance → bot quotes the shortfall and offers a top-up link (`wallet-top-up`). "I paid but it's still pending" → bot re-checks `paymentStatus` and escalates if unresolved.

**Human handoff** — `escalate_to_support` flips `supportMode`, alerts `OPERATIONS_NUMBER` on WhatsApp with a summary, and the bot goes silent in that chat. An agent sends `#resume` in the customer's chat to hand back to the bot.

## Config (.env additions)

```
CHUVI_API_BASE_URL=https://api.chuvilaundry.com/api   # chuvibackend base (must include /api)
OPENAI_MODEL=gpt-4o                                    # optional, defaults to gpt-4o
```

`OPERATIONS_NUMBER` (already present) is used for support handoffs.

## Things to verify before go-live

1. **Live pricing (done)** — the bot now pulls prices, fees, speed charges, tier multipliers and pickup time slots from `GET /admin/admin-order-details` (regular user auth), cached 10 minutes per process. Order creation always uses the live DB price — a price passed by the LLM is ignored — and rejects items not on the live list. `FALLBACK_PRICES` is used only for indicative quotes when the user hasn't linked an account yet; the bot flags those as indicative.
2. **`serviceTier` mismatch** — the backend *validates* `classic|premium|vip` but its Swagger docs say `standard|premium`. The bot follows the validation. Confirm which is correct.
3. **Registration `userType`** — the bot registers/logs in with `userType: 'user'`; confirm that matches your user model enum.
4. **Webhook timeout** — the agent can take a few seconds; WhatsApp may retry the webhook. The `externalId` dedupe already absorbs retries, but for high volume consider acking 200 immediately and processing async.
5. **Rotate your secrets** — the uploaded `.env` files contain live OpenAI, WhatsApp, and (backend) Paystack/DB credentials. Treat them as exposed and rotate.

## Payment confirmations in WhatsApp (new)

When Paystack confirms a payment, the customer now gets an instant message in their WhatsApp chat:
- ✅ wallet top-up successful (with new balance)
- ✅ order payment received (with OSC number)
- ✅ subscription active (plan name)

**How:** the backend's Paystack webhook handler now calls `util/notifyBot.js` (fire-and-forget, 5s timeout, can never break the webhook) → `POST /api/internal/payment-event` on the bot, secured with a shared secret header. The bot looks up the linked WhatsApp user by `chuvi.userId`/email and pushes the message. If the customer isn't on WhatsApp, it's a silent no-op.

**Config:**
- Bot `.env`: `BOT_INTERNAL_SECRET=<long random string>`
- Backend `.env`: `CHATBOT_NOTIFY_URL=https://<chatbot-host>/api/internal/payment-event` and `CHATBOT_NOTIFY_SECRET=<same string>`

Generate the secret with: `openssl rand -hex 32`

## Interactive buttons (new)

The bot now uses WhatsApp interactive messages instead of plain text wherever taps beat typing:
- **Pay Now 💳 URL buttons** — every Paystack link is delivered as a tappable button that opens the checkout page (the agent is forbidden from pasting raw payment URLs). Footer reads "Secure payment via Paystack".
- **Quick-reply buttons** (max 3) — welcome screen (Link account / Create account / See prices), after linking (Book Order / Wallet / Plans), after order creation (Pay Now / Pay from Wallet), and on payment confirmations (Track Order / My Orders, Book Order / Balance, New Link / Talk to Agent on failure).
- **List pickers** — for 4–10 options: subscription plans, saved addresses, pickup time slots, recent orders.

How it works: `helpers/whatsApp.js` gained `sendWhatsAppButtons`, `sendWhatsAppCtaUrl`, `sendWhatsAppList` (Cloud API limits enforced: 3 buttons, 20-char titles, 10 rows, 72-char descriptions — over-long content is clipped, never rejected). The webhook (`whatsappController.parseInbound`) now understands `interactive` replies: the tapped title becomes the user message and the id rides along as `buttonId`; `cmd:*` ids (e.g. `cmd:track:<orderId>`) map to deterministic commands in `botController`. The agent has three new tools (`send_payment_button`, `send_quick_replies`, `send_list`) that send immediately; it replies `NO_REPLY` afterwards to avoid duplicate texts.

Note: interactive messages work in 1-to-1 chats within the 24-hour customer-service window (always the case here, since the bot only replies to inbound messages).

## Project cleanup (final structure)

All legacy standalone-bot code was removed — the old keyword intents, local pricing engine, cron jobs, worker, and the unused finance/employee/inventory/order models and routes. The bot is now a thin WhatsApp layer over chuvibackend. Final tree:

```
chatbot/
├── index.js                      # express app: /api/whatsapp + /api/internal
├── controllers/
│   ├── whatsappController.js     # webhook parsing (text + button/list taps)
│   └── botController.js          # pipeline: dedupe → handoff → linking → agent
├── helpers/
│   ├── agent.js                  # OpenAI tool agent (all user capabilities)
│   └── whatsApp.js               # Cloud API senders: text/buttons/cta-url/list
├── services/
│   └── chuviApi.js               # per-user backend client (cookie auth + refresh)
├── models/
│   ├── User.js                   # WhatsApp user + linked chuvi session
│   └── Message.js                # chat log (agent context + dedupe)
└── routes/
    ├── whatsappRoutes.js         # GET verify + POST webhook
    └── internalRoutes.js         # payment-event pushes from chuvibackend
```

Dependencies slimmed accordingly: dropped `luxon`, `node-cron`, `jsonwebtoken` (and the `worker` scripts); lockfile regenerated. Heads-up: the local bot Mongo DB may still contain collections from the old system (orders, employees, finances...); they're harmless but can be dropped — only `users` and `messages` are used now.

## Tested

A mock-backend test verified the auth core: login cookie capture, automatic refresh + retry on `jwt_expired` (exactly one refresh call), token rotation persistence, and clean error surfacing on bad credentials. All new modules import cleanly under the project's ESM setup.
