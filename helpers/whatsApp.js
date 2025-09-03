// // helpers/whatsApp.js
// import axios from "axios";

// const WHATSAPP_API_URL = "https://graph.facebook.com/v18.0";
// const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID; // from Meta App Dashboard
// const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN; // permanent or refreshed token

// // Send plain text message via WhatsApp Cloud API
// export const sendWhatsAppMessage = async (to, message) => {
//   try {
//     const response = await axios.post(
//       `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
//       {
//         messaging_product: "whatsapp",
//         to,
//         type: "text",
//         text: { body: message },
//       },
//       {
//         headers: {
//           Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
//           "Content-Type": "application/json",
//         },
//       }
//     );

//     console.log("✅ WhatsApp message sent:", response.data);
//     return response.data;
//   } catch (error) {
//     console.error(
//       "❌ WhatsApp API Error:",
//       error.response?.data || error.message
//     );
//     throw error;
//   }
// };

import axios from "axios";

const WHATSAPP_API_URL = "https://graph.facebook.com/v18.0";
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

// Send plain text message via WhatsApp Cloud API
export const sendWhatsAppMessage = async (to, message) => {
  try {
    const response = await axios.post(
      `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: message },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ WhatsApp message sent:", response.data);
    return response.data;
  } catch (error) {
    console.error(
      "❌ WhatsApp API Error:",
      error.response?.data || error.message
    );
    throw error;
  }
};
