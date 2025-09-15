// // helpers/openAi.js
// import 'dotenv/config'
// import OpenAI from 'openai'
// import Message from '../models/Message.js'

// const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// // 🔹 Intents with keyword shortcuts
// const keywordIntents = {
//   create_order: [
//     'order',
//     'wash',
//     'laundry',
//     'pickup',
//     'drop',
//     'iron',
//     'shirt',
//     'trouser',
//     'suit',
//     'bedsheet',
//     'pillow',
//     'pillowcase',
//     'blanket'
//   ],
//   track_order: ['track', 'status', 'where', 'progress'],
//   check_loyalty: ['points', 'loyalty', 'rewards'],
//   greeting: [
//     'hi',
//     'hello',
//     'hey',
//     'good morning',
//     'good evening',
//     'good afternoon'
//   ],
//   farewell: ['bye', 'goodbye', 'see you', 'later', 'thanks', 'thank you'],
//   my_orders: [
//     'my order',
//     'previous order',
//     'last order',
//     'recent order',
//     'show my orders',
//     'orders'
//   ],
//   update_preferences: [
//     'fragrance',
//     'preference',
//     'folding',
//     'iron only',
//     'change',
//     'update'
//   ]
// }

// export const detectIntent = text => {
//   if (!text || typeof text !== 'string') return 'unknown'

//   const lower = text.toLowerCase().replace(/[_-]+/g, ' ')

//   const itemOrderHint =
//     /\b(\d+|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve))\b\s+(shirts?|trousers?|shorts?|jeans?|dresses?|towels?|bedsheets?|pillowcases?|pillow\s?case|curtains?|suits?|skirts?|blouses?|jackets?|sweaters?|blankets?)\b/i
//   if (itemOrderHint.test(text) || /\b(wash|laundry|iron|fold)\b/.test(lower)) {
//     return 'create_order'
//   }

//   const priorityOrder = [
//     'track_order',
//     'my_orders',
//     'check_loyalty',
//     'update_preferences',
//     'farewell',
//     'greeting',
//     'create_order'
//   ]

//   for (const intent of priorityOrder) {
//     if (keywordIntents[intent].some(kw => lower.includes(kw))) {
//       return intent
//     }
//   }

//   return 'unknown'
// }

// // 🔢 Number words up to 300
// const numberWords = {
//   one: 1,
//   two: 2,
//   three: 3,
//   four: 4,
//   five: 5,
//   six: 6,
//   seven: 7,
//   eight: 8,
//   nine: 9,
//   ten: 10,
//   eleven: 11,
//   twelve: 12,
//   thirteen: 13,
//   fourteen: 14,
//   fifteen: 15,
//   sixteen: 16,
//   seventeen: 17,
//   eighteen: 18,
//   nineteen: 19,
//   twenty: 20,
//   thirty: 30,
//   forty: 40,
//   fifty: 50,
//   sixty: 60,
//   seventy: 70,
//   eighty: 80,
//   ninety: 90,
//   hundred: 100
// }

// function wordsToNumber (str) {
//   str = str.toLowerCase().replace(/-/g, ' ').replace(/ and /g, ' ')
//   const parts = str.split(/\s+/)
//   let total = 0,
//     current = 0
//   for (let part of parts) {
//     if (numberWords[part]) {
//       let num = numberWords[part]
//       if (num === 100) {
//         if (current === 0) current = 1
//         current *= 100
//       } else {
//         current += num
//       }
//     }
//   }
//   total += current
//   return total || null
// }

// // 🧺 Normalize item names
// function normalizeItemName (name) {
//   name = name.toLowerCase()
//   const map = {
//     shirt: 'shirts',
//     trouser: 'trousers',
//     short: 'shorts',
//     jean: 'jeans',
//     dress: 'dresses',
//     towel: 'towels',
//     bedspread: 'bedspreads',
//     bedsheet: 'bedsheets',
//     pillow: 'pillowcases',
//     pillowcase: 'pillowcases',
//     'pillow case': 'pillowcases',
//     pillowcases: 'pillowcases',
//     curtain: 'curtains',
//     suit: 'suits',
//     skirt: 'skirts',
//     blouse: 'blouses',
//     jacket: 'jackets',
//     sweater: 'sweaters',
//     blanket: 'blankets'
//   }
//   if (map[name]) return map[name]
//   if (!name.endsWith('s')) return name + 's'
//   return name
// }

// // 👉 Regex
// const itemRegex =
//   /(\d+)\s*(shirts?|trousers?|shorts?|jeans?|dresses?|towels?|bedspreads?|bedsheets?|pillowcases?|pillow\s?case|curtains?|suits?|skirts?|blouses?|jackets?|sweaters?|blankets?)/i

// const wordRegex = new RegExp(
//   `\\b((?:one|two|three|four|five|six|seven|eight|nine|ten|
//       eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|
//       twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)
//       (?:[\\s-](?:one|two|three|four|five|six|seven|eight|nine|ten|
//       eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|
//       twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety))*)\\s+
//       (shirts?|trousers?|shorts?|jeans?|dresses?|towels?|bedspreads?|bedsheets?|pillow\\s?cases?|curtains?|suits?|skirts?|blouses?|jackets?|sweaters?|blankets?)`,
//   'i'
// )

// // 🧩 Improved fallback item parser
// function parseItemPartFallback (part) {
//   part = part.toLowerCase().trim()
//   let service = 'washIron'
//   if (/iron only/.test(part)) {
//     service = 'ironOnly'
//     part = part.replace(/iron only/, '')
//   } else if (/wash and fold/.test(part)) {
//     service = 'washFold'
//     part = part.replace(/wash and fold/, '')
//   } else if (/wash and iron|wash & iron|laundry/.test(part)) {
//     service = 'washIron'
//     part = part.replace(/wash (and|&) iron|laundry/, '')
//   }

//   let quantity = null
//   let item = null

//   const digitMatch = part.match(itemRegex)
//   const wordMatch = part.match(wordRegex)

//   if (digitMatch) {
//     quantity = parseInt(digitMatch[1], 10)
//     item = normalizeItemName(digitMatch[2])
//   } else if (wordMatch) {
//     quantity = wordsToNumber(wordMatch[1])
//     item = normalizeItemName(wordMatch[2])
//   }

//   if (!quantity) quantity = 1
//   if (!item) {
//     item = part.replace(/[^a-z\s]/g, '').trim()
//     item = normalizeItemName(item)
//   }

//   return { name: item, quantity, service }
// }

// /**
//  * 🔹 Parse laundry orders
//  */
// export async function parseOrderIntent (message) {
//   try {
//     const prompt = `Extract structured laundry order details from this request:

// "${message}"

// Return JSON ONLY (no commentary) with keys:
// {
//   "items": [{ "name": "shirts", "quantity": 3, "service": "washIron" }],
//   "instructions": "",
//   "delivery": "pickup" | "delivery" | "none",
//   "payment": "cash" | "card" | "transfer" | "unspecified",
//   "turnaround": "standard" | "express" | "same-day",
//   "distanceKm": 2
// }`

//     const completion = await client.chat.completions.create({
//       model: 'gpt-4o-mini',
//       response_format: { type: 'json' },
//       messages: [{ role: 'user', content: prompt }],
//       temperature: 0
//     })

//     let parsed = completion.choices?.[0]?.message?.content
//     if (!parsed) throw new Error('Empty AI response')

//     if (typeof parsed === 'object') {
//       if (!Array.isArray(parsed.items)) throw new Error('Invalid structure')
//       return parsed
//     }

//     parsed = JSON.parse(parsed)
//     if (!parsed || !Array.isArray(parsed.items))
//       throw new Error('Invalid AI JSON structure')

//     return parsed
//   } catch (err) {
//     console.error(
//       '❌ parseOrderIntent AI failed or returned invalid JSON:',
//       err.message
//     )

//     const items = []
//     const lower = message.toLowerCase()
//     const parts = message.split(/,| and /i)

//     for (let part of parts) {
//       const parsed = parseItemPartFallback(part)
//       if (parsed && parsed.quantity > 0 && parsed.name) items.push(parsed)
//     }

//     let turnaround = 'standard'
//     if (/\b(express|24h|24 hours|next day)\b/.test(lower))
//       turnaround = 'express'
//     if (/\b(same day|today|urgent|6h|6-8 hours)\b/.test(lower))
//       turnaround = 'same-day'

//     let delivery = 'none'
//     if (/\bpickup\b/.test(lower)) delivery = 'pickup'
//     if (/(deliver|home delivery|send to my house)/.test(lower))
//       delivery = 'delivery'

//     let distanceKm = null
//     const distanceMatch = lower.match(/(\d+)\s*(km|kilomet(er|re)s?)/)
//     if (distanceMatch) distanceKm = parseInt(distanceMatch[1], 10)

//     let payment = 'unspecified'
//     if (/\bcash\b/.test(lower)) payment = 'cash'
//     if (/\bcard\b/.test(lower)) payment = 'card'
//     if (/\btransfer\b/.test(lower)) payment = 'transfer'

//     return {
//       items,
//       turnaround,
//       distanceKm,
//       delivery,
//       payment,
//       instructions: ''
//     }
//   }
// }

// /**
//  * 🔹 Conversational AI with memory
//  */
// export async function processUserMessage (userId, userMessage) {
//   const history = await Message.find({ userId })
//     .sort({ createdAt: -1 })
//     .limit(10)
//     .lean()

//   const chatHistory = history.reverse().map(m => ({
//     role: m.from === 'bot' ? 'assistant' : 'user',
//     content: m.text
//   }))

//   const res = await client.chat.completions.create({
//     model: 'gpt-4o-mini',
//     messages: [
//       {
//         role: 'system',
//         content:
//           'You are CHUVI, a friendly laundry assistant chatbot. When a user appears to be placing an order (mentions items and quantities), DO NOT give do-it-yourself washing instructions. Instead, reply as an assistant that helps place orders, asks clarifying questions (quantity, turnaround, pickup/delivery), or confirms the order summary. Keep replies short and actionable.'
//       },
//       ...chatHistory,
//       { role: 'user', content: userMessage }
//     ],
//     temperature: 0.2
//   })

//   return res.choices[0].message.content
// }

// helpers/openAi.js
import 'dotenv/config'
import OpenAI from 'openai'
import Message from '../models/Message.js'

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// 🔹 Intents with keyword shortcuts
export const keywordIntents = {
  create_order: [
    'order',
    'wash',
    'laundry',
    'pickup',
    'drop',
    'iron',
    'shirt',
    'trouser',
    'suit',
    'bedsheet',
    'pillow',
    'pillowcase',
    'blanket'
  ],
  track_order: ['track', 'status', 'where', 'progress'],
  check_loyalty: ['points', 'loyalty', 'rewards'],
  greeting: [
    'hi',
    'hello',
    'hey',
    'good morning',
    'good evening',
    'good afternoon'
  ],
  farewell: ['bye', 'goodbye', 'see you', 'later', 'thanks', 'thank you'],
  my_orders: [
    'my order',
    'previous order',
    'last order',
    'recent order',
    'show my orders',
    'orders'
  ],
  update_preferences: [
    'fragrance',
    'preference',
    'folding',
    'iron only',
    'change',
    'update'
  ]
}

export function detectIntent (text) {
  if (!text || typeof text !== 'string') return 'unknown'
  const lower = text.toLowerCase().replace(/[_-]+/g, ' ')

  const itemOrderHint =
    /\b(\d+|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve))\b\s+(shirts?|trousers?|shorts?|jeans?|dresses?|towels?|bedsheets?|pillowcases?|pillow\s?case|curtains?|suits?|skirts?|blouses?|jackets?|sweaters?|blankets?)\b/i
  if (itemOrderHint.test(text) || /\b(wash|laundry|iron|fold)\b/.test(lower)) {
    return 'create_order'
  }

  const priorityOrder = [
    'track_order',
    'my_orders',
    'check_loyalty',
    'update_preferences',
    'farewell',
    'greeting',
    'create_order'
  ]

  for (const intent of priorityOrder) {
    if (keywordIntents[intent].some(kw => lower.includes(kw))) return intent
  }

  return 'unknown'
}

const numberWords = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100
}

function wordsToNumber (str) {
  str = String(str || '')
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/ and /g, ' ')
  const parts = str.split(/\s+/)
  let total = 0,
    current = 0
  for (let part of parts) {
    if (!part) continue
    if (numberWords[part]) {
      let num = numberWords[part]
      if (num === 100) {
        if (current === 0) current = 1
        current *= 100
      } else current += num
    }
  }
  total += current
  return total || null
}

function normalizeItemName (name) {
  if (!name || typeof name !== 'string') return ''
  name = name.toLowerCase().trim()
  const map = {
    shirt: 'shirts',
    trouser: 'trousers',
    short: 'shorts',
    jean: 'jeans',
    dress: 'dresses',
    towel: 'towels',
    bedspread: 'bedspreads',
    bedsheet: 'bedsheets',
    pillow: 'pillowcases',
    pillowcase: 'pillowcases',
    'pillow case': 'pillowcases',
    pillowcases: 'pillowcases',
    curtain: 'curtains',
    suit: 'suits',
    skirt: 'skirts',
    blouse: 'blouses',
    jacket: 'jackets',
    sweater: 'sweaters',
    blanket: 'blankets'
  }
  if (map[name]) return map[name]
  const words = name.split(/\s+/)
  const last = words[words.length - 1]
  if (map[last]) return map[last]
  if (!name.endsWith('s')) return name + 's'
  return name
}

// const itemRegex =
//   /(\d+)\s*(shirts?|trousers?|shorts?|jeans?|dresses?|towels?|bedspreads?|bedsheets?|pillowcases?|pillow\s?case|curtains?|suits?|skirts?|blouses?|jackets?|sweaters?|blankets?)/i

// const wordRegex =
//   /\b((?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)(?:[\s-](?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety))*)\s+(shirts?|trousers?|shorts?|jeans?|dresses?|towels?|bedspreads?|bedsheets?|pillowcases?|pillow\s?case|curtains?|suits?|skirts?|blouses?|jackets?|sweaters?|blankets?)/i

// 🔹 Helper to safely split on "and" without breaking "wash and fold"
function smartSplitItems (text) {
  return text
    .toLowerCase()
    .replace(/wash and fold|wash & fold|wash and iron|wash & iron/g, match =>
      match.replace(/ and /, '___')
    )
    .split(/\s+and\s+|,|also/gi)
    .map(s => s.replace(/___/g, ' and ').trim())
    .filter(Boolean)
}

/**
 * 🧺 parseItemPartFallback
 * - now supports multi-item sentences: "wash 3 shirts and two towels"
 * - splits into parts, extracts quantity, item, and service for each
 * - returns an ARRAY of { name, quantity, service }
 */
export function parseItemPartFallback (userText) {
  const text = userText.toLowerCase()

  // item classification
  const ironables = [
    'shirt',
    'shirts',
    'trouser',
    'trousers',
    'uniform',
    'uniforms',
    'towel',
    'towels',
    'pillow',
    'pillows',
    'pillowcase',
    'pillowcases',
    'suit',
    'suits',
    'short',
    'shorts',
    'scarf',
    'scarves',
    'jean',
    'jeans',
    'sweater',
    'sweaters',
    'jacket',
    'jackets',
    'short',
    'shorts',
    'bedsheet',
    'bedsheets'
  ]
  const nonIronables = [
    'duvet',
    'duvets',
    'blanket',
    'blankets',
    'curtain',
    'curtains'
  ]

  const ignoreWords = [
    'wash',
    'iron',
    'fold',
    'clean',
    'launder',
    'press',
    'neatly',
    'tidy',
    'and',
    'also',
    'them',
    'those',
    'these',
    'it',
    'my',
    'the',
    'their'
  ]

  const hasWash = t => /\b(wash|clean|launder)\b/.test(t)
  const hasIron = t => /\b(iron|press)\b/.test(t)
  const hasFold = t => /\b(fold|neatly|tidy)\b/.test(t)

  const defaultService = name => {
    if (ironables.includes(name)) return 'washIron'
    if (nonIronables.includes(name)) return 'washFold'
    return 'wash'
  }

  const clauses = smartSplitItems(text)
  const items = []

  for (let clause of clauses) {
    const serviceHint = {
      wash: hasWash(clause),
      iron: hasIron(clause),
      fold: hasFold(clause)
    }

    const withQty = [...clause.matchAll(/(\d+)\s+([a-zA-Z]+)/g)]
    const singles = [...clause.matchAll(/\b([a-zA-Z]+)\b/g)]

    const determineService = name => {
      let service = defaultService(name)
      if (serviceHint.wash && serviceHint.iron) service = 'washIron'
      else if (serviceHint.wash && serviceHint.fold) service = 'washFold'
      else if (serviceHint.iron && !serviceHint.wash) service = 'ironOnly'
      else if (serviceHint.fold && !serviceHint.wash) service = 'foldOnly'
      else if (serviceHint.wash) {
        if (ironables.includes(name)) service = 'washIron'
        else if (nonIronables.includes(name)) service = 'washFold'
        else service = 'wash'
      }
      return service
    }

    if (withQty.length > 0) {
      for (const m of withQty) {
        const quantity = parseInt(m[1])
        const name = m[2]
        if (!ignoreWords.includes(name)) {
          items.push({ name, quantity, service: determineService(name) })
        }
      }
    } else {
      for (const m of singles) {
        const name = m[1]
        if (!ignoreWords.includes(name)) {
          items.push({ name, quantity: 1, service: determineService(name) })
        }
      }
    }
  }

  // 🧠 Merge duplicate items and upgrade services
  const merged = {}
  const rank = { wash: 1, foldOnly: 2, ironOnly: 2, washFold: 2, washIron: 3 }
  for (const item of items) {
    if (!merged[item.name]) {
      merged[item.name] = { ...item }
    } else {
      merged[item.name].quantity += item.quantity
      if (rank[item.service] > rank[merged[item.name].service]) {
        merged[item.name].service = item.service
      }
    }
  }

  return Object.values(merged)
}

/**
 * parseOrderIntent(message)
 * - tries the LLM first (expects JSON)
 * - validates the returned structure
 * - falls back to the robust regex/parser above
 */
export async function parseOrderIntent (message) {
  if (!message || typeof message !== 'string') {
    return {
      items: [],
      turnaround: 'standard',
      distanceKm: null,
      delivery: 'none',
      payment: 'unspecified',
      instructions: ''
    }
  }

  try {
    const prompt = `Extract structured laundry order details from this request:

"${message}"

Return JSON ONLY (no commentary) with keys:
{
  "items": [{ "name": "shirts", "quantity": 3, "service": "washIron" }],
  "instructions": "",
  "delivery": "pickup" | "delivery" | "none",
  "payment": "cash" | "card" | "transfer" | "unspecified",
  "turnaround": "standard" | "express" | "same-day",
  "distanceKm": 2
}`

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
      temperature: 0
    })

    let parsed = completion.choices?.[0]?.message?.content
    if (!parsed) throw new Error('Empty AI response')

    // if SDK produced an object
    if (typeof parsed === 'object') {
      if (!Array.isArray(parsed.items))
        throw new Error('Invalid structure: items not array')
      return parsed
    }

    // string -> parse
    parsed = JSON.parse(parsed)
    if (!parsed || !Array.isArray(parsed.items))
      throw new Error('Invalid AI JSON structure')

    return parsed
  } catch (err) {
    console.error(
      '❌ parseOrderIntent AI failed or returned invalid JSON:',
      err.message
    )

    // fallback parser
    const items = []
    const lower = message.toLowerCase()
    // split by comma or " and " but preserve phrases like "wash and iron" — splitting on ',| and ' is still OK here
    const parts = message
      .split(/,| and /i)
      .map(p => p.trim())
      .filter(Boolean)

    for (let part of parts) {
      const parsed = parseItemPartFallback(part)
      if (parsed && parsed.quantity > 0 && parsed.name) items.push(parsed)
    }

    // Turnaround detection
    let turnaround = 'standard'
    if (/\b(express|24h|24 hours|next day)\b/.test(lower))
      turnaround = 'express'
    if (/\b(same day|today|urgent|6h|6-8 hours)\b/.test(lower))
      turnaround = 'same-day'

    // Delivery detection
    let delivery = 'none'
    if (/\bpickup\b/.test(lower)) delivery = 'pickup'
    if (/(deliver|home delivery|send to my house)/.test(lower))
      delivery = 'delivery'

    // Distance
    let distanceKm = null
    const distanceMatch = lower.match(/(\d+)\s*(km|kilomet(er|re)s?)/)
    if (distanceMatch) distanceKm = parseInt(distanceMatch[1], 10)

    // Payment
    let payment = 'unspecified'
    if (/\bcash\b/.test(lower)) payment = 'cash'
    if (/\bcard\b/.test(lower)) payment = 'card'
    if (/\btransfer\b/.test(lower)) payment = 'transfer'

    return {
      items,
      turnaround,
      distanceKm,
      delivery,
      payment,
      instructions: ''
    }
  }
}

/**
 * processUserMessage(userId, userMessage)
 * - narrow system prompt so assistant won't give DIY washing instructions when user is ordering
 */
// helpers/openAi.js
export async function processUserMessage (userId, userMessage) {
  // 1. Detect intent first
  const intent = detectIntent(userMessage)

  // 2. Try to extract order items if it looks like an order
  let structuredOrder = null
  if (intent === 'create_order') {
    structuredOrder = await parseOrderIntent(userMessage)
  }

  // 3. Get chat history
  const history = await Message.find({ userId })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean()

  const chatHistory = history.reverse().map(m => ({
    role: m.from === 'bot' ? 'assistant' : 'user',
    content: m.text
  }))

  // 4. Compose a very clear system + context message
  const contextMsg =
    intent === 'create_order'
      ? `User is trying to place a laundry order. Parsed items: ${JSON.stringify(
          structuredOrder?.items || []
        )}.
      Ask for clarifications (pickup, delivery, turnaround) or confirm the order summary.`
      : `User intent seems to be "${intent}". Stay in the laundry domain and give helpful, concise replies.`

  // 5. Call OpenAI
  const res = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content:
          'You are CHUVI, a friendly laundry assistant chatbot. Never give DIY washing instructions.'
      },
      { role: 'system', content: contextMsg },
      ...chatHistory,
      { role: 'user', content: userMessage }
    ],
    temperature: 0.2
  })

  return res.choices[0].message.content
}
