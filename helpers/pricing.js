// helpers/pricing.js

/**
 * 🔹 Laundry Pricing Rules
 */
const PRICES = {
  everyday: { washIron: 500, washFold: 500, ironOnly: 300 }, // T-shirts, polos, basic shirts, shorts
  corporateShirt: { washIron: 800, ironOnly: 500 },
  trousersJeans: { washIron: 500, ironOnly: 300 },
  nativeTwoPiece: { washIron: 600, ironOnly: 300 },
  agbada: { flat: 1500 },
  dress: { basic: 1500, delicate: 2500 },
  premiumCare: { flat: 700 }, // lace, silk, etc.
  bedding: {
    bedsheet: 1500,
    pillowcase: 300,
    duvet: 3000,
  },
  curtains: {
    light: 1500,
    heavy: 3000,
  },
  dryClean: { inspection: true },
}

/**
 * 🔹 Turnaround multipliers
 */
const TURNAROUND_MULTIPLIERS = {
  standard: 1,
  express: 1.4, // +40%
  "same-day": 1.8, // +80%
}

/**
 * 🔹 Calculate Price
 */
export function calculatePrice(items, turnaround = "standard", distanceKm = 0) {
  let subtotal = 0
  let warnings = []
  let missingServices = [] // 👈 Track items without service

  const enrichedItems = items.map((item) => {
    const name = item.name.toLowerCase()
    const qty = item.quantity || 1
    const service = item.service?.toLowerCase()

    if (!service) {
      missingServices.push(item.name)
      return { ...item, unitPrice: 0, lineTotal: 0 }
    }

    let unitPrice = 0

    // Everyday items
    if (/t-?shirt|polo|shirt|short/.test(name)) {
      unitPrice = PRICES.everyday[service] || PRICES.everyday.washIron
    }
    // Corporate shirts
    else if (/corporate/.test(name)) {
      unitPrice = PRICES.corporateShirt[service] || PRICES.corporateShirt.washIron
    }
    // Jeans & trousers
    else if (/jean|trouser/.test(name)) {
      unitPrice = PRICES.trousersJeans[service] || PRICES.trousersJeans.washIron
    }
    // Native two-piece
    else if (/native|senator|up.?and.?down/.test(name)) {
      unitPrice = PRICES.nativeTwoPiece[service] || PRICES.nativeTwoPiece.washIron
    }
    // Agbada
    else if (/agbada/.test(name)) {
      unitPrice = PRICES.agbada.flat
    }
    // Dresses
    else if (/dress/.test(name)) {
      if (/delicate|silk|lace/.test(name)) {
        unitPrice = PRICES.dress.delicate
      } else {
        unitPrice = PRICES.dress.basic
      }
    }
    // Premium care
    else if (/premium|lace|silk|delicate/.test(name)) {
      unitPrice = PRICES.premiumCare.flat
    }
    // Bedding
    else if (/bedsheet/.test(name)) unitPrice = PRICES.bedding.bedsheet
    else if (/pillow/.test(name)) unitPrice = PRICES.bedding.pillowcase
    else if (/duvet/.test(name)) unitPrice = PRICES.bedding.duvet
    // Curtains
    else if (/curtain.*heavy|lined/.test(name)) unitPrice = PRICES.curtains.heavy
    else if (/curtain/.test(name)) unitPrice = PRICES.curtains.light
    // Dry-clean (inspection)
    else if (/dry.?clean/.test(name)) {
      warnings.push(`${item.name} requires inspection for pricing`)
      unitPrice = 0
    }
    // Fallback
    else {
      unitPrice = PRICES.everyday[service] || PRICES.everyday.washIron
    }

    const lineTotal = unitPrice * qty
    subtotal += lineTotal

    return { ...item, service, unitPrice, lineTotal }
  })

  // ⏱ Same-day limit
  if (turnaround === "same-day") {
    const totalQty = items.reduce((s, i) => s + i.quantity, 0)
    if (totalQty > 15) {
      warnings.push("⚠️ Same-day service limited to 15 items. Some may be rescheduled.")
    }
  }

  // 🔹 Apply turnaround multiplier
  const multiplier = TURNAROUND_MULTIPLIERS[turnaround] || 1
  subtotal *= multiplier

  // 🔹 Delivery fee
  let deliveryFee = 0
  if (distanceKm > 1) {
    deliveryFee = 300 + (distanceKm - 1) * 200
  }

  const total = subtotal + deliveryFee

  return { items: enrichedItems, subtotal, deliveryFee, total, warnings, missingServices }
}
