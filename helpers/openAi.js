// helpers/openAi.js
import 'dotenv/config'
import OpenAI from 'openai'
import Message from '../models/Message.js'

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// 🔹 Intents with keyword shortcuts
const keywordIntents = {
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
    'blanket'
  ],
  track_order: ['track', 'status', 'where', 'progress'],
  check_loyalty: ['points', 'loyalty', 'rewards'],
  greeting: ['hi', 'hello', 'hey', 'good morning', 'good evening'],
  update_preferences: [
    'fragrance',
    'preference',
    'folding',
    'iron only',
    'change',
    'update'
  ]
}

export const detectIntent = text => {
  const lower = text.toLowerCase()
  for (const [intent, keywords] of Object.entries(keywordIntents)) {
    if (keywords.some(kw => lower.includes(kw))) {
      return intent
    }
  }
  return 'unknown'
}

// 🔢 Number words up to 300
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
  str = str.toLowerCase().replace(/-/g, ' ').replace(/ and /g, ' ')
  const parts = str.split(/\s+/)
  let total = 0,
    current = 0
  for (let part of parts) {
    if (numberWords[part]) {
      let num = numberWords[part]
      if (num === 100) {
        if (current === 0) current = 1
        current *= 100
      } else {
        current += num
      }
    }
  }
  total += current
  return total || null
}

// 🧺 Normalize item names
function normalizeItemName (name) {
  name = name.toLowerCase()
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
  if (!name.endsWith('s')) return name + 's'
  return name
}

// 👉 Regex
const itemRegex =
  /(\d+)\s*(shirts?|trousers?|shorts?|jeans?|dresses?|towels?|bedspreads?|bedsheets?|pillowcases?|pillow\s?case|curtains?|suits?|skirts?|blouses?|jackets?|sweaters?|blankets?)/i

const wordRegex = new RegExp(
  `\\b((?:one|two|three|four|five|six|seven|eight|nine|ten|
      eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|
      twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)
      (?:[\\s-](?:one|two|three|four|five|six|seven|eight|nine|ten|
      eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|
      twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety))*)\\s+
      (shirts?|trousers?|shorts?|jeans?|dresses?|towels?|bedspreads?|bedsheets?|pillow\\s?cases?|curtains?|suits?|skirts?|blouses?|jackets?|sweaters?|blankets?)`,
  'i'
)

// 🧺 Parse a single part → item
function parseItemPart (part) {
  part = part.toLowerCase().trim()
  let service = 'washIron' // default
  let name = part

  // 🔹 Detect service
  if (/iron only/.test(part)) {
    service = 'ironOnly'
    name = part.replace(/iron only/, '').trim()
  } else if (/wash and fold/.test(part)) {
    service = 'washFold'
    name = part.replace(/wash and fold/, '').trim()
  } else if (/wash and iron|wash & iron|laundry/.test(part)) {
    service = 'washIron'
    name = part.replace(/wash (and|&) iron|laundry/, '').trim()
  }

  // 🔹 Detect quantity
  let quantity = null
  const digitMatch = part.match(/(\d+)\s+([a-z\s]+)/i)
  const wordMatch = part.match(wordRegex)

  if (digitMatch) {
    quantity = parseInt(digitMatch[1], 10)
    name = digitMatch[2].trim()
  } else if (wordMatch) {
    quantity = wordsToNumber(wordMatch[1])
    name = wordMatch[2].trim()
  }

  if (!quantity) quantity = 1

  // 🔹 Normalize
  name = normalizeItemName(name)

  return { name, quantity, service }
}

/**
 * 🔹 Parse laundry orders
 */
export async function parseOrderIntent (message) {
  try {
    // 👉 Try AI extraction first
    const prompt = `Extract structured laundry order details from this request:

"${message}"

Return JSON with:
{
  "items": [{ "name": "shirts", "quantity": 3, "service": "washIron" }],
  "instructions": "special notes if any",
  "delivery": "pickup tomorrow 9am" | "home delivery evening" | "none",
  "payment": "cash" | "card" | "transfer" | "unspecified",
  "turnaround": "standard" | "express" | "same-day",
  "distanceKm": 2
}`

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0
    })

    return JSON.parse(completion.choices[0].message.content)
  } catch (err) {
    console.error('❌ parseOrderIntent AI failed:', err.message)

    // 👉 Fallback
    const items = []
    const lower = message.toLowerCase()
    const parts = message.split(/,| and /i)

    for (let part of parts) {
      const parsed = parseItemPart(part)
      if (parsed.quantity > 0 && parsed.name) {
        items.push(parsed)
      }
    }

    // 🔹 Turnaround detection
    let turnaround = 'standard'
    if (/\b(express|24h|24 hours|next day)\b/.test(lower))
      turnaround = 'express'
    if (/\b(same day|today|urgent|6h|6-8 hours)\b/.test(lower))
      turnaround = 'same-day'

    // 🔹 Delivery detection
    let delivery = 'none'
    if (/pickup/.test(lower)) delivery = 'pickup'
    if (/(deliver|home delivery|send to my house)/.test(lower))
      delivery = 'delivery'

    // 🔹 Distance
    let distanceKm = null
    const distanceMatch = lower.match(/(\d+)\s*(km|kilomet(er|re)s?)/)
    if (distanceMatch) distanceKm = parseInt(distanceMatch[1], 10)

    // 🔹 Payment
    let payment = 'unspecified'
    if (/cash/.test(lower)) payment = 'cash'
    if (/card/.test(lower)) payment = 'card'
    if (/transfer/.test(lower)) payment = 'transfer'

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
 * 🔹 Conversational AI with memory
 */
export async function processUserMessage (userId, userMessage) {
  const history = await Message.find({ userId })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean()

  const chatHistory = history.reverse().map(m => ({
    role: m.from === 'bot' ? 'assistant' : 'user',
    content: m.text
  }))

  const res = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are CHUVI, a friendly laundry assistant chatbot.'
      },
      ...chatHistory,
      { role: 'user', content: userMessage }
    ]
  })

  return res.choices[0].message.content
}
