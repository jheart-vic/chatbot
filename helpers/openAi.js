// helpers/openAi.js
import 'dotenv/config'
import OpenAI from 'openai'
import Message from '../models/Message.js'

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export const keywordIntents = {
  create_order: ['order', 'wash', 'laundry', 'pickup', 'drop', 'iron', 'shirt', 'trouser', 'suit', 'bedsheet', 'pillow', 'pillowcase', 'blanket'],
  track_order: ['track', 'status', 'where', 'progress'],
  check_loyalty: ['points', 'loyalty', 'rewards'],
  greeting: ['hi', 'hello', 'hey', 'good morning', 'good evening', 'good afternoon'],
  farewell: ['bye', 'goodbye', 'see you', 'later', 'thanks', 'thank you'],
  my_orders: ['my order', 'previous order', 'last order', 'recent order', 'show my orders', 'orders'],
  update_preferences: ['fragrance', 'preference', 'folding', 'iron only', 'change', 'update']
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

function normalizeItemName(name, quantity = 1) {
  if (!name || typeof name !== 'string') return ''

  name = name.toLowerCase().trim()

  // ✅ Synonym map (singular form only)
  const synonymMap = {
    shirt: 'shirt',
    trouser: 'trouser',
    pant: 'trouser',
    short: 'short',
    jean: 'jean',
    dress: 'dress',
    towel: 'towel',
    bedspread: 'bedspread',
    bedsheet: 'bedsheet',
    sheet: 'bedsheet',
    pillow: 'pillow',
    pillowcase: 'pillowcase',
    'pillow case': 'pillowcase',
    curtain: 'curtain',
    suit: 'suit',
    skirt: 'skirt',
    blouse: 'blouse',
    jacket: 'jacket',
    sweater: 'sweater',
    blanket: 'blanket',
    duvet: 'duvet',
    uniform: 'uniform',
    scarf: 'scarf'
  }

  // ✅ Use mapped synonym if available
  if (synonymMap[name]) name = synonymMap[name]

  // ✅ Convert to plural only if quantity > 1
  if (quantity > 1) {
    // Special plural rules
    if (name.endsWith('y') && !/[aeiou]y$/.test(name)) return name.slice(0, -1) + 'ies' // e.g. "pillowcase" → "pillowcases"
    if (name.endsWith('s') || name.endsWith('x') || name.endsWith('z') || name.endsWith('ch') || name.endsWith('sh')) return name + 'es'
    if (name === 'jean') return 'jeans'
    if (name === 'trouser') return 'trousers'
    if (name === 'short') return 'shorts'
    return name + 's'
  }

  return name // keep singular for qty 1
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
// ✅ Improved parseItemPartFallback
export function parseItemPartFallback(userText) {
  if (!userText || typeof userText !== 'string') return []

  const text = userText.toLowerCase().trim()

  const ironables = [
    'shirt', 'shirts',
    'trouser', 'trousers',
    'uniform', 'uniforms',
    'towel', 'towels',
    'pillow', 'pillows',
    'pillowcase', 'pillowcases',
    'suit', 'suits',
    'short', 'shorts',
    'scarf', 'scarves',
    'jean', 'jeans',
    'sweater', 'sweaters',
    'jacket', 'jackets',
    'bedsheet', 'bedsheets'
  ]

  const nonIronables = ['duvet', 'duvets', 'blanket', 'blankets', 'curtain', 'curtains']

  const ignoreWords = [
    'wash','iron','fold','clean','launder','press','neatly','tidy',
    'and','also','them','those','these','it','my','the','their','just',
    'i','want','you','to','please','pickup','deliver','drop','off','at',
    'away','pay','with','cash','card','transfer','km','express','same','day'
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
    const words = clause.split(/\s+/)
    let i = 0
    while (i < words.length) {
      let word = words[i]
      if (ignoreWords.includes(word)) {
        i++
        continue
      }

      let quantity = 1
      if (numberWords[word]) {
        quantity = numberWords[word]
        i++
        word = words[i] || 'item'
      } else if (/^\d+$/.test(word)) {
        quantity = parseInt(word, 10)
        i++
        word = words[i] || 'item'
      }

      // ✅ Always store in singular form
      const singularName = normalizeItemName(word, 1)
      if (!ironables.includes(singularName) && !nonIronables.includes(singularName)) {
        i++
        continue
      }

      let service = defaultService(singularName)
      const serviceHint = { wash: hasWash(clause), iron: hasIron(clause), fold: hasFold(clause) }
      if (serviceHint.wash && serviceHint.iron) service = 'washIron'
      else if (serviceHint.wash && serviceHint.fold) service = 'washFold'
      else if (serviceHint.iron && !serviceHint.wash) service = 'ironOnly'
      else if (serviceHint.fold && !serviceHint.wash) service = 'foldOnly'

      items.push({ name: singularName, quantity, service })
      i++
    }
  }

  // ✅ Merge duplicates & keep singular naming
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


// ✅ Improved parseOrderIntent (less junk, cleaner output)
export async function parseOrderIntent(message) {
  const lower = message.toLowerCase()
  const items = parseItemPartFallback(message)

  let turnaround = 'standard'
  if (/\b(express|24h|next day)\b/.test(lower)) turnaround = 'express'
  if (/\b(same day|today|urgent)\b/.test(lower)) turnaround = 'same-day'

  let delivery = 'none'
  if (/\bpickup\b/.test(lower)) delivery = 'pickup'
  if (/\b(deliver|drop off|send)\b/.test(lower)) delivery = 'delivery'

  const distanceMatch = lower.match(/(\d+)\s*km/)
  const distanceKm = distanceMatch ? parseInt(distanceMatch[1], 10) : null

  let payment = 'unspecified'
  if (/\bcash\b/.test(lower)) payment = 'cash'
  if (/\bcard\b/.test(lower)) payment = 'card'
  if (/\btransfer\b/.test(lower)) payment = 'transfer'

  return { items, turnaround, distanceKm, delivery, payment, instructions: '' }
}

// ✅ FIX: use AI ONLY for general chat
export async function processUserMessage(userId, userMessage) {
  const intent = detectIntent(userMessage)

  // 🚫 Do NOT call GPT if this is an order
  if (intent === 'create_order') {
    const structuredOrder = await parseOrderIntent(userMessage)
    return {
      type: 'order',
      intent,
      data: structuredOrder
    }
  }

  // 🔄 Get last messages for context
  const history = await Message.find({ userId }).sort({ createdAt: -1 }).limit(10).lean()
  const chatHistory = history.reverse().map(m => ({
    role: m.from === 'bot' ? 'assistant' : 'user',
    content: m.text
  }))

  const res = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You are CHUVI, a friendly laundry assistant. Stay focused on laundry-related FAQs only.' },
      ...chatHistory,
      { role: 'user', content: userMessage }
    ],
    temperature: 0.2
  })

  return {
    type: 'chat',
    intent,
    data: res.choices[0].message.content
  }
}


// // helpers/openAi.js
// import 'dotenv/config'
// import OpenAI from 'openai'
// import Message from '../models/Message.js'

// const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// // 🔹 Keyword-based intent detection
// export const keywordIntents = {
//   create_order: ['order','wash','laundry','pickup','drop','iron','shirt','trouser','suit','bedsheet','pillow','pillowcase','blanket'],
//   track_order: ['track','status','where','progress'],
//   check_loyalty: ['points','loyalty','rewards'],
//   greeting: ['hi','hello','hey','good morning','good evening','good afternoon'],
//   farewell: ['bye','goodbye','see you','later','thanks','thank you'],
//   my_orders: ['my order','previous order','last order','recent order','show my orders','orders'],
//   update_preferences: ['fragrance','preference','folding','iron only','change','update']
// }

// export function detectIntent (text) {
//   if (!text || typeof text !== 'string') return 'unknown'
//   const lower = text.toLowerCase().replace(/[_-]+/g, ' ')

//   // Fast keyword match
//   const itemOrderHint = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b\s+(shirts?|trousers?|shorts?|jeans?|dresses?|towels?|bedsheets?|pillowcases?|suits?|curtains?|blankets?)\b/i
//   if (itemOrderHint.test(lower) || /\b(wash|laundry|iron|fold)\b/.test(lower)) {
//     return 'create_order'
//   }

//   const priorityOrder = ['track_order','my_orders','check_loyalty','update_preferences','farewell','greeting','create_order']
//   for (const intent of priorityOrder) {
//     if (keywordIntents[intent].some(kw => lower.includes(kw))) return intent
//   }

//   return 'unknown'
// }

// // Number word → integer
// const numberWords = { one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10 }
// const normalizeItemName = name => {
//   const map = { shirt:'shirts', trouser:'trousers', short:'shorts', jean:'jeans', dress:'dresses', bedsheet:'bedsheets', pillowcase:'pillowcases', pillow:'pillowcases', suit:'suits', blanket:'blankets' }
//   name = name.toLowerCase().trim()
//   return map[name] || (name.endsWith('s') ? name : name + 's')
// }

// // Pure rule-based parsing
// export function parseOrderIntent(message) {
//   if (!message || typeof message !== 'string') {
//     return { items: [], turnaround: 'standard', distanceKm: null, delivery: 'none', payment: 'unspecified', instructions: '' }
//   }

//   const lower = message.toLowerCase()
//   const items = []
//   const clauses = message.split(/,| and /i).map(c => c.trim()).filter(Boolean)

//   for (const clause of clauses) {
//     const words = clause.split(/\s+/)
//     let qty = 1
//     let service = null

//     // 🔹 Detect service keywords within the clause
//     if (/\bwash\b/.test(clause) && /\b(fold|iron)\b/.test(clause)) {
//       service = 'washFold' // combined service
//     } else if (/\bwash\b/.test(clause)) {
//       service = 'washIron' // default to wash & iron
//     } else if (/\bfold\b/.test(clause)) {
//       service = 'foldOnly'
//     } else if (/\biron\b/.test(clause)) {
//       service = 'ironOnly'
//     }

//     for (let i = 0; i < words.length; i++) {
//       const w = words[i]
//       if (numberWords[w]) qty = numberWords[w]
//       else if (/^\d+$/.test(w)) qty = parseInt(w, 10)
//       else if (/shirt|trouser|short|jean|dress|towel|bedsheet|pillow|suit|blanket/i.test(w)) {
//         items.push({ name: normalizeItemName(w), quantity: qty, service })
//         qty = 1
//       }
//     }
//   }

//   // Detect turnaround
//   let turnaround = null
//   if (/\b(express|24h|next day)\b/.test(lower)) turnaround = 'express'
//   if (/\b(same day|today|urgent)\b/.test(lower)) turnaround = 'same-day'

//   // Delivery / distance
//   let delivery = /pickup|pick up/.test(lower) ? 'pickup' : (/deliver|drop off|send/.test(lower) ? 'delivery' : 'none')
//   const distanceMatch = lower.match(/(\d+)\s*km/)
//   const distanceKm = distanceMatch ? parseInt(distanceMatch[1], 10) : null

//   // Payment
//   let payment = 'unspecified'
//   if (/\bcash\b/.test(lower)) payment = 'cash'
//   if (/\bcard\b/.test(lower)) payment = 'card'
//   if (/\btransfer\b/.test(lower)) payment = 'transfer'

//   return { items, turnaround, distanceKm, delivery, payment, instructions: '' }
// }


// // AI is ONLY used for FAQs and fallback
// export async function processUserMessage (userId, userMessage) {
//   const history = await Message.find({ userId }).sort({ createdAt: -1 }).limit(8).lean()
//   const chatHistory = history.reverse().map(m => ({
//     role: m.from === 'bot' ? 'assistant' : 'user',
//     content: m.text
//   }))

//   const res = await client.chat.completions.create({
//     model: 'gpt-4o-mini',
//     messages: [
//       { role: 'system', content: 'You are CHUVI, a friendly laundry assistant. Focus on laundry-related FAQs. If you cannot answer, politely say you don’t know.' },
//       ...chatHistory,
//       { role: 'user', content: userMessage }
//     ],
//     temperature: 0.2
//   })

//   return res.choices[0].message.content
// }

