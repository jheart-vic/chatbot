// helpers/voice.js
// Downloads a WhatsApp audio message from Meta's media API and transcribes it
// with OpenAI Whisper. Returns the transcript text (or null on failure).

import axios from 'axios'
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const GRAPH = 'https://graph.facebook.com/v20.0'
const TOKEN = process.env.WHATSAPP_ACCESS_TOKEN

/**
 * @param {string} mediaId - the id from message.audio.id (or voice.id)
 * @returns {Promise<string|null>} transcript, or null if anything failed
 */
export async function transcribeWhatsAppAudio (mediaId) {
  try {
    // 1) Resolve the media id to a short-lived download URL
    const meta = await axios.get(`${GRAPH}/${mediaId}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      timeout: 15000
    })
    const url = meta.data?.url
    const mime = meta.data?.mime_type || 'audio/ogg'
    if (!url) return null

    // 2) Download the audio bytes (must send the auth header to Meta's CDN)
    const audio = await axios.get(url, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      responseType: 'arraybuffer',
      timeout: 30000
    })

    // 3) Whisper transcription. WhatsApp voice notes are OGG/Opus.
    const ext = mime.includes('mpeg') ? 'mp3' : mime.includes('wav') ? 'wav' : 'ogg'
    const file = await OpenAI.toFile(Buffer.from(audio.data), `voice.${ext}`, {
      type: mime
    })

    const result = await openai.audio.transcriptions.create({
      file,
      model: process.env.WHISPER_MODEL || 'whisper-1'
      // language left auto-detected; Nigerian English + pidgin transcribe well
    })

    const text = (result.text || '').trim()
    return text || null
  } catch (err) {
    console.error('🎙️ Voice transcription failed:', err.response?.data?.error?.message || err.message)
    return null
  }
}

export default transcribeWhatsAppAudio
