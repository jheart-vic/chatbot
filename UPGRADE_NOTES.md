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

## Customer-service playbook + payment failures (new)

- **Agent persona** now embeds the CHUVI Customer Communication Manual: the voice rules (short, calm, glanceable, lightly personal), the conversion flow (greet → qualify → offer → objection → close with one next step), the objection rule (Agree → Reframe → Proof → Forward, with all 8 objection stances), the complaint Recovery Framework (Thank → Understand → Own → Resolve → Follow up) with the manual's escalation triggers, feedback handling by star rating, and the retention tone ("we're still here", never pushy; subscriptions not pitched to new customers).
- **General conversation**: the agent chats naturally (greetings, small talk) and steers back to laundry; it can give quick fabric-care/stain tips, and politely declines unrelated tasks (homework, code, news) while staying in the CHUVI lane.
- **Payment failures**: backend webhook now handles `charge.failed` (marks the Payment record failed, notifies the customer on WhatsApp with the gateway reason + "💳 New Link / 🆘 Talk to Agent" buttons) and notifies on `invoice.payment_failed` (subscription renewal failure). The agent also has a support pattern for "my payment failed / I was debited": reassure (failed charges reverse automatically), offer a fresh link or wallet payment, check paymentStatus, escalate with the reference — never argue.

## Follow-up, retention & reactivation journeys (new)

`helpers/journeys.js` runs the manual's full timeline automatically:
- **T1** delivery confirmation — instant, triggered by the backend's rider mark-delivered AND in-person collection endpoints (both now fire an `order-delivered` event to the bot). Includes ✅ All Good / ⚠️ Report Issue buttons and the pickup-vs-delivery wording variants.
- **T2** feedback request — +1 day, as a 5-row rating list. One gentle reminder +2 days later, only if no reply. The agent's `record_feedback` tool captures the rating: ≥4★ → thanks + the manual's referral note; ≤3★ → journeys stop, apology + escalation to a human.
- **T3** retention check-in — +7 days, segment-aware (student / professional / household texts from the manual).
- **Reactivation R1→R2→R3** — dormancy 21d (student/household) / 35d (professional), then +7d, +7d, then full stop ("door stays open"). A new order or delivery resets the dormancy clock.
- Respect rules: nothing sends while `supportMode` is on; negative feedback halts automation until the next delivery; no chasing after the reminder or after R3.

**Modes (env):**
- `JOURNEY_TEST_MINUTES=true` → 1 day = 1 minute, tick every 20s (watch a 35-day journey in ~35 min)
- `JOURNEY_USE_TEMPLATES=true` → sends Meta-approved templates (REQUIRED in production: T2 onward falls outside WhatsApp's 24h window). `false` = free-form sends for dev-mode testing while you're actively chatting. Template names configurable via `TPL_T1..TPL_R3` env vars (defaults `chuvi_delivery_confirmation`, `chuvi_feedback_request`, `chuvi_feedback_reminder`, `chuvi_retention_checkin`, `chuvi_reactivation_1/2/3`).

Customer `segment` lives on the bot's User model (default `student`).

## Existing-account detection + password reset (new)

- **"create account" with a known account**: if this WhatsApp number has ever linked a CHUVI account, the bot reminds them immediately — "You already have an account (*email*)" — with buttons **🔑 Log in / 🔁 Reset password / 📝 New account**. The remembered email (`knownEmail`) survives unlinking.
- **Email probe during registration**: when any user enters an email in the create-account flow, the bot checks it against the backend with a side-effect-free probe (a throwaway-password login attempt — no emails sent). Already registered & verified → Log in / Reset password buttons; registered but unverified → fresh OTP + straight to verification; free → continues normally. If the backend is unreachable the probe returns `unknown` and registration proceeds (the backend's own duplicate check still applies).
- **Full password-reset flow in chat**: *reset password* (typed or button) → email (one-tap button if we remember it) → reset code via `/auth/forgot-password` → OTP verify (`/auth/verify-reset-password-otp`, returns a reset JWT) → new password (masked in logs like all passwords) → `/auth/reset-password` → straight into account linking. Compromised-account messaging included.

## Webhook reliability + abandoned-flow follow-up (new)

- **Instant webhook ack**: the webhook now returns 200 to Meta immediately and processes everything (OpenAI agent, backend calls) in the background. Previously the 200 waited for the full agent run (10-30s) — past Meta's ~10s timeout — causing retries, growing backoff, and the "send twice before it responds" symptom.
- **Atomic dedupe**: Meta's retries are absorbed by inserting the inbound message against the unique `externalId` index (duplicate-key = already processed). Race-proof even when two deliveries arrive simultaneously.
- **Stale-flow expiry**: any registration/linking/reset flow older than 24h auto-clears so users can never get trapped mid-flow.
- **Abandoned-flow follow-up**: the journey engine nudges users who went silent mid-registration/linking/reset — once, after 2h (2 min in test mode): "Looks like we didn't finish creating your account — want to pick up where we left off?" with ▶️ Continue / ❌ Cancel buttons. Continue re-prompts the exact step they were on.
- Note: instant ack solves the Meta-timeout delays, but Render free-tier cold starts (~30-60s wake-up after 15 min idle) are infrastructure: either upgrade the bot to a paid instance or point a free uptime pinger (e.g. UptimeRobot) at the bot's `/` health endpoint every 5-10 minutes.

## Flow intelligence & escape hatches (new)

The registration/linking/reset state machine no longer traps users:
- **Conversational input mid-flow** (hi, hello, help, "I'm stuck", "?") is recognised and answered with orientation — "we're in the middle of setting up, I just need your password" — plus ▶️ Continue / 🔄 Start over / 🆘 Talk to agent buttons, instead of being consumed as an email/password/OTP attempt.
- **Two failures on the same step** → the bot stops repeating itself and offers Start over / Talk to agent / Cancel buttons. The counter resets on every step change.
- **Global escapes work anywhere, even mid-flow**: *reset / restart / start over / start afresh / menu* clears all state and shows a fresh menu (this is the fix for "I cleared the chat but the bot remembered" — chat clearing is phone-side only; bot state lives in the database and now has a proper reset command). *agent / human / customer care* clears the flow, flags supportMode, alerts the ops number, and confirms a human is taking over.
- **Real backend errors surfaced**: the generic "Registration failed." fallback now shows the actual error message so failures are diagnosable.

## Tested

A mock-backend test verified the auth core: login cookie capture, automatic refresh + retry on `jwt_expired` (exactly one refresh call), token rotation persistence, and clean error surfacing on bad credentials. All new modules import cleanly under the project's ESM setup.
