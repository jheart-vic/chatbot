// helpers/companyInfo.js
// Single source of truth for CHUVI's website and branch locations.
// Edit ONLY this file to update them — the agent reads from here.

export const WEBSITE_URL = process.env.CHUVI_WEBSITE_URL || 'https://www.chuvilaundry.com'

// Add every branch here. lat/lng are optional — if present, the bot can drop a
// map pin; if absent, it just gives the address.
export const BRANCHES = [
  {
    name: 'CHUVI Agulu',
    area: 'Agulu',
    address: '12 Ekwulobia Rd, Agulu',
    hours: 'Tue–Sat 9am–7pm, Sun 12pm–7pm',
    phone: '+234 808 129 9759',
    lat: null,
    lng: null
  }
  // More branches coming later — add them here in the same shape.
]

export function locationsForPrompt () {
  if (!BRANCHES.length) return 'No branch list configured yet.'
  return BRANCHES.map(b =>
    `- ${b.name}${b.area ? ` (${b.area})` : ''}: ${b.address}${b.hours ? ` | ${b.hours}` : ''}${b.phone ? ` | ${b.phone}` : ''}`
  ).join('\n')
}

export default { WEBSITE_URL, BRANCHES, locationsForPrompt }
