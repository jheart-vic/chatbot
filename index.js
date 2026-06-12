// index.js — Chuvi WhatsApp bot
// Routes: /api/whatsapp (Meta webhook) and /api/internal (payment-event pushes
// from chuvibackend). All business logic lives in the chuvibackend API.

import express from 'express'
import mongoose from 'mongoose'
import dotenv from 'dotenv'
import cors from 'cors'

import whatsappRoutes from './routes/whatsappRoutes.js'
import internalRoutes from './routes/internalRoutes.js'
import { startJourneyEngine } from './helpers/journeys.js'

dotenv.config()

const app = express()

app.use(cors())
app.use(express.json())

app.use('/api/whatsapp', whatsappRoutes)
app.use('/api/internal', internalRoutes)

// Health check
app.get('/health', (req, res) => {
  res.send('Chuvi WhatsApp Bot running ✅')
})

mongoose
  .connect(process.env.MONGO_URL)
  .then(() => {
    console.log('MongoDB connected')
    startJourneyEngine()
    app.listen(process.env.PORT || 5000, () => {
      console.log(`Bot running on port ${process.env.PORT || 5000}`)
    })
  })
  .catch(err => console.error('MongoDB connection error:', err))
