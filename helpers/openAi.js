// // helpers/openAi.js
// import "dotenv/config";
// import OpenAI from "openai";
// import Message from "../models/Message.js";

// const client = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY,
// });

// // 1️⃣ Keyword intents
// const keywordIntents = {
//   create_order: ["order", "wash", "laundry", "pickup", "drop", "iron"],
//   track_order: ["track", "status", "where", "progress"],
//   check_loyalty: ["points", "loyalty", "rewards"],
//   greeting: ["hi", "hello", "hey", "good morning", "good evening"],
// };

// /**
//  * Detects user intent without always calling OpenAI
//  */
// export const detectIntent = (text) => {
//   const lower = text.toLowerCase();

//   for (const [intent, keywords] of Object.entries(keywordIntents)) {
//     if (keywords.some((kw) => lower.includes(kw))) {
//       return intent;
//     }
//   }

//   return "unknown"; // fallback
// };

// /**
//  * Parses structured laundry orders with regex
//  * Example: "Wash 3 shirts and 2 trousers"
//  */
// export const parseOrderIntent = (message) => {
//   const items = [];
//   const regex = /(\d+)\s*(shirts?|trousers?|jeans?|dresses?|clothes?|towels?)/gi;
//   let match;
//   while ((match = regex.exec(message))) {
//     items.push({ name: match[2].toLowerCase(), quantity: parseInt(match[1]) });
//   }
//   return { items };
// };

// /**
//  * Fallback: process free chat using OpenAI with memory
//  */
// export async function processUserMessage(userId, userMessage) {
//   // Save user message
//   await Message.create({ userId, from: "user", text: userMessage });

//   // Fetch last 10 messages for context
//   const history = await Message.find({ userId })
//     .sort({ createdAt: -1 })
//     .limit(10)
//     .lean();

//   const chatHistory = history.reverse().map((m) => ({
//     role: m.from === "bot" ? "assistant" : "user",
//     content: m.text,
//   }));

//   const res = await client.chat.completions.create({
//     model: "gpt-4o-mini", // cheaper than full GPT-4o
//     messages: [
//       { role: "system", content: "You are CHUVI, a friendly laundry assistant chatbot." },
//       ...chatHistory,
//       { role: "user", content: userMessage },
//     ],
//   });

//   const reply = res.choices[0].message.content;

//   // Save bot reply
//   await Message.create({ userId, from: "bot", text: reply });

//   return reply;
// }


import "dotenv/config";
import OpenAI from "openai";
import Message from "../models/Message.js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Intents with keyword shortcuts
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

/**
 * 🔹 Parse laundry orders using AI (fallback to regex if needed)
 */
export async function parseOrderIntent(message) {
  try {
    const prompt = `Extract structured laundry order details from this request:

"${message}"

Return JSON with:
{
  "items": [{ "name": "shirt", "quantity": 3 }],
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
    console.error("❌ parseOrderIntent fallback:", err.message);

    // fallback regex extraction
    const items = [];
    const regex = /(\d+)\s*(shirts?|trousers?|jeans?|dresses?|clothes?|towels?)/gi;
    let match;
    while ((match = regex.exec(message))) {
      items.push({ name: match[2].toLowerCase(), quantity: parseInt(match[1]) });
    }
    return { items, instructions: "", delivery: "", payment: "" };
  }
}

/**
 * 🔹 Fallback: conversational AI with memory
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
