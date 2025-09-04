// helpers/openAi.js
import "dotenv/config";
import OpenAI from "openai";
import Message from "../models/Message.js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 🔹 Intents with keyword shortcuts
const keywordIntents = {
  create_order: ["order", "wash", "laundry", "pickup", "drop", "iron"],
  track_order: ["track", "status", "where", "progress"],
  check_loyalty: ["points", "loyalty", "rewards"],
  greeting: ["hi", "hello", "hey", "good morning", "good evening"],
};

export const detectIntent = (text) => {
  const lower = text.toLowerCase();
  for (const [intent, keywords] of Object.entries(keywordIntents)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return intent;
    }
  }
  return "unknown";
};

// 🔢 Number words up to 300
const numberWords = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  hundred: 100
};

function wordsToNumber(str) {
  str = str.toLowerCase().replace(/-/g, " ").replace(/ and /g, " ");
  const parts = str.split(/\s+/);
  let total = 0, current = 0;

  for (let part of parts) {
    if (numberWords[part]) {
      let num = numberWords[part];
      if (num === 100) {
        if (current === 0) current = 1;
        current *= 100;
      } else {
        current += num;
      }
    }
  }
  total += current;
  return total || null;
}

// 🧺 Normalize item names with more variety
function normalizeItemName(name) {
  name = name.toLowerCase();

  const map = {
    shirt: "shirts",
    trouser: "trousers",
    short: "shorts",
    jean: "jeans",
    dress: "dresses",
    towel: "towels",
    bedspread: "bedspreads",
    bedsheet: "bedsheets",
    pillow: "pillowcases",
    "pillow case": "pillowcases",
    pillowcase: "pillowcases",
    curtain: "curtains",
    suit: "suits",
    skirt: "skirts",
    blouse: "blouses",
    jacket: "jackets",
    sweater: "sweaters",
    blanket: "blankets",
  };

  if (map[name]) return map[name];
  if (!name.endsWith("s")) return name + "s";
  return name;
}

// 👉 Expanded fallback regex: supports more laundry items
const itemRegex = /(\d+)\s*(shirts?|trousers?|shorts?|jeans?|dresses?|towels?|bedspreads?|bedsheets?|pillow\s?cases?|curtains?|suits?|skirts?|blouses?|jackets?|sweaters?|blankets?)/i;

// 👉 Word-number regex (same item list)
const wordRegex = new RegExp(
  `\\b((?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)(?:[\\s-](?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety))*)\\s+(shirts?|trousers?|shorts?|jeans?|dresses?|towels?|bedspreads?|bedsheets?|pillow\\s?cases?|curtains?|suits?|skirts?|blouses?|jackets?|sweaters?|blankets?)`,
  "i"
);

/**
 * 🔹 Parse laundry orders using AI (fallback to regex + words)
 */
export async function parseOrderIntent(message) {
  try {
    // 👉 Try AI extraction first
    const prompt = `Extract structured laundry order details from this request:

"${message}"

Return JSON with:
{
  "items": [{ "name": "shirts", "quantity": 3 }],
  "instructions": "special notes if any",
  "delivery": "pickup tomorrow 9am" or "home delivery evening",
  "payment": "cash" | "card" | "transfer"
}`;

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    });

    return JSON.parse(completion.choices[0].message.content);
  } catch (err) {
    console.error("❌ parseOrderIntent AI failed:", err.message);

    // 👉 Regex + word parsing fallback
    const items = [];
    const parts = message.split(/,| and /i);

    for (let part of parts) {
      // Digits → "40 shirts"
      const digitMatch = part.match(itemRegex);
      if (digitMatch) {
        const quantity = parseInt(digitMatch[1], 10);
        if (quantity > 0 && quantity <= 300) {
          items.push({ name: normalizeItemName(digitMatch[2]), quantity });
          continue;
        }
      }

      // Words → "two hundred pillow cases"
      const wordMatch = part.match(wordRegex);
      if (wordMatch) {
        const quantity = wordsToNumber(wordMatch[1]);
        if (quantity && quantity > 0 && quantity <= 300) {
          items.push({ name: normalizeItemName(wordMatch[2]), quantity });
        }
      }
    }

    return { items, instructions: "", delivery: "", payment: "" };
  }
}

/**
 * 🔹 Conversational AI with memory
 */
export async function processUserMessage(userId, userMessage) {
  await Message.create({ userId, from: "user", text: userMessage });

  const history = await Message.find({ userId })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  const chatHistory = history.reverse().map((m) => ({
    role: m.from === "bot" ? "assistant" : "user",
    content: m.text,
  }));

  const res = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "You are CHUVI, a friendly laundry assistant chatbot." },
      ...chatHistory,
      { role: "user", content: userMessage },
    ],
  });

  const reply = res.choices[0].message.content;
  await Message.create({ userId, from: "bot", text: reply });
  return reply;
}
