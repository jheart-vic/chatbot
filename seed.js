// import mongoose from 'mongoose'
// import {
//   detectIntent,
//   parseItemPartFallback,
//   parseOrderIntent,
//   processUserMessage
// } from './helpers/openAi.js'
// import Message from './models/Message.js'

// // 🧪 Connect to Mongo (for processUserMessage history)
// await mongoose.connect(
//   process.env.MONGO_URL || 'mongodb://localhost:27017/laundry_test',
//   {
//     useNewUrlParser: true,
//     useUnifiedTopology: true
//   }
// )

// // 🧪 Seed dummy chat history
// async function seedMessages (userId) {
//   await Message.deleteMany({ userId })
//   await Message.insertMany([
//     { userId, text: 'Hello', from: 'user' },
//     { userId, text: 'Hi there, how can I help you?', from: 'bot' }
//   ])
// }

// // 🧪 1. Test detectIntent
// async function testDetectIntent () {
//   console.log('\n=== detectIntent ===')
//   const samples = [
//     'Can you wash 3 shirts and 2 towels',
//     'What is the status of my order',
//     'Hello there',
//     'I want to update my fragrance preference',
//     'Thanks bye',
//     'show my orders',
//     'how many loyalty points do I have'
//   ]
//   for (const text of samples) {
//     console.log(text, '→', detectIntent(text))
//   }
// }

// // 🧪 2. Test parseItemPartFallback
// async function testParseItemPartFallback () {
//   console.log('\n=== parseItemPartFallback ===')
//   const samples = [
//     'wash 3 shirts and 2 towels',
//     'iron 5 trousers and 1 suit',
//     'wash and fold 2 duvets',
//     'wash 3 pillows and 2 shirts, also fold them neatly',
//     'just wash 4 uniforms',
//     'wash ten shirts and five trousers'
//   ]
//   for (const text of samples) {
//     console.log(text, '→', parseItemPartFallback(text))
//   }
// }

// // 🧪 3. Test parseOrderIntent
// async function testParseOrderIntent () {
//   console.log('\n=== parseOrderIntent ===')
//   const samples = [
//     'I want you to wash 4 trousers and 3 shirts, pickup at 3km away, pay with cash, express please',
//     'wash and fold 2 duvets and deliver to my house, pay with card, same day'
//   ]
//   for (const text of samples) {
//     const result = await parseOrderIntent(text)
//     console.log(text, '\n→', result, '\n')
//   }
// }

// // 🧪 4. Test processUserMessage (end-to-end)
// async function testProcessUserMessage () {
//   console.log('\n=== processUserMessage ===')
//   const userId = new mongoose.Types.ObjectId()
//   await seedMessages(userId)
//   const text = 'Can you wash 3 shirts and 2 towels and pickup at my house?'
//   const reply = await processUserMessage(userId, text)
//   console.log('User:', text)
//   console.log('Bot:', reply)
// }

// async function runAll () {
//   await testDetectIntent()
//   await testParseItemPartFallback()
//   await testParseOrderIntent()
//   await testProcessUserMessage()

//   console.log('\n✅ All tests completed')
//   mongoose.disconnect()
// }

// runAll()


// testBotController.js
import { createRequire } from "module";
const require = createRequire(import.meta.url);

// ✅ 1️⃣ Mock helpers BEFORE loading controller
require.cache[require.resolve("./helpers/whatsApp.js")] = {
  exports: {
    sendWhatsAppMessage: async (to, message) =>
      console.log("📤 [MOCK WHATSAPP] Sending message:", message),
  },
};

require.cache[require.resolve("./helpers/openAi.js")] = {
  exports: {
    detectIntent: (text) => {
      console.log("🤖 [MOCK AI] Detecting intent for:", text);
      if (text.toLowerCase().includes("order")) return "create_order";
      if (text.toLowerCase().includes("points")) return "check_loyalty";
      return "greeting";
    },
    parseOrderIntent: (text) => ({
      items: [{ name: "shirts", quantity: 3, service: "washIron" }],
      turnaround: "standard",
      distanceKm: 2,
    }),
    processUserMessage: async (userId, text) =>
      `[MOCK AI REPLY] You said: ${text}`,
  },
};

// ✅ 2️⃣ Now import controller (it will use mocks above)
import { handleIncomingMessage } from "./controllers/botController.js";
import User from "./models/User.js";
import Order from "./models/Order.js";
import Message from "./models/Message.js";

// ✅ 3️⃣ Mock DB models
User.findOne = async () => ({
  _id: "mockUserId",
  phone: "12345",
  whatsappName: "Test User",
  loyaltyBalance: 50,
  totalOrders: 2,
  isOnboarded: true,
  conversationState: {},
  save: async () => console.log("💾 [MOCK] User saved"),
});

User.create = async (data) => {
  console.log("👤 [MOCK] Creating user:", data);
  return { ...data, _id: "newUser", save: async () => {} };
};

Message.findOne = async () => null;
Message.create = async (data) =>
  console.log("💬 [MOCK] Saving message:", data);

Order.find = async () => [];
Order.create = async (data) => {
  console.log("🧾 [MOCK] Creating order:", data);
  return { ...data, _id: "order123", loyaltyEarned: 10 };
};

// ✅ 4️⃣ Fake Express-like res object
const fakeRes = {
  status: (code) => {
    console.log(`📡 [MOCK RES] Status: ${code}`);
    return fakeRes;
  },
  end: () => console.log("✅ [MOCK RES] End called"),
  json: (obj) => console.log("🛑 [MOCK RES] JSON:", obj),
};

// ✅ 5️⃣ Run test
console.log("🚀 Running manual test...\n");

await handleIncomingMessage(
  {
    from: "12345",
    text: "hello there", // Try "I want to order laundry" or "how many points"
    profile: { name: "Tester" },
    messageId: "msg-abc-123",
  },
  fakeRes
);

console.log("\n✅ Done!");
