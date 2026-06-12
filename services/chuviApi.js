// services/chuviApi.js
// Per-user client for the Chuvi backend (chuvibackend).
// The backend uses httpOnly cookie auth (accessToken / refreshToken set on login),
// so this client captures Set-Cookie headers, persists tokens on the bot's User doc,
// and replays them as a Cookie header. On jwt_expired it refreshes once and retries.

import axios from 'axios'
import User from '../models/User.js'

const BASE_URL = (process.env.CHUVI_API_BASE_URL || 'http://localhost:5000/api').replace(/\/$/, '')

// ---------- cookie helpers ----------
function parseSetCookies (setCookieHeaders = []) {
  const out = {}
  for (const raw of setCookieHeaders) {
    const [pair] = raw.split(';')
    const idx = pair.indexOf('=')
    if (idx === -1) continue
    const name = pair.slice(0, idx).trim()
    const value = pair.slice(idx + 1).trim()
    if (name === 'accessToken' || name === 'refreshToken') out[name] = value
  }
  return out
}

export class ChuviApiError extends Error {
  constructor (message, status, data) {
    super(message)
    this.name = 'ChuviApiError'
    this.status = status
    this.data = data
  }
}

function extractError (err) {
  const data = err.response?.data
  const inner = data?.data?.error || data?.data?.message || data?.error || data?.message
  if (typeof inner === 'string') return inner
  if (inner && typeof inner === 'object') {
    // validation errors come back as { field: ["msg"] }
    return Object.values(inner).flat().join(' ')
  }
  return err.message || 'Request failed'
}

export class ChuviClient {
  /**
   * @param {object} botUser - the chatbot's Mongo User document (must have .chuvi subdoc)
   */
  constructor (botUser) {
    this.botUser = botUser
    this.http = axios.create({ baseURL: BASE_URL, timeout: 25000, withCredentials: true })
  }

  get isLinked () {
    return Boolean(this.botUser?.chuvi?.accessToken && this.botUser?.chuvi?.refreshToken)
  }

  _cookieHeader () {
    const { accessToken, refreshToken } = this.botUser.chuvi || {}
    const parts = []
    if (accessToken) parts.push(`accessToken=${accessToken}`)
    if (refreshToken) parts.push(`refreshToken=${refreshToken}`)
    return parts.join('; ')
  }

  async _saveTokens (cookies) {
    if (!cookies.accessToken && !cookies.refreshToken) return
    this.botUser.chuvi = this.botUser.chuvi || {}
    if (cookies.accessToken) this.botUser.chuvi.accessToken = cookies.accessToken
    if (cookies.refreshToken) this.botUser.chuvi.refreshToken = cookies.refreshToken
    this.botUser.markModified('chuvi')
    await this.botUser.save()
  }

  async _refresh () {
    const res = await this.http.post('/auth/refresh-token', {}, {
      headers: { Cookie: this._cookieHeader() }
    })
    const cookies = parseSetCookies(res.headers['set-cookie'] || [])
    await this._saveTokens(cookies)
    return Boolean(cookies.accessToken)
  }

  async request (method, url, { body, params } = {}, _retried = false) {
    try {
      const res = await this.http.request({
        method,
        url,
        data: body,
        params,
        headers: this.isLinked ? { Cookie: this._cookieHeader() } : {}
      })
      // capture rotated cookies if any
      const cookies = parseSetCookies(res.headers['set-cookie'] || [])
      if (Object.keys(cookies).length) await this._saveTokens(cookies)

      const payload = res.data
      // backend convention: { success, data } — sendFailedResponse can still be 200 in places
      if (payload && payload.success === false) {
        throw new ChuviApiError(extractError({ response: { data: payload } }), res.status, payload)
      }
      return payload?.data ?? payload
    } catch (err) {
      if (err instanceof ChuviApiError) throw err
      const status = err.response?.status
      const msg = extractError(err)
      const expired = status === 401 && /jwt_expired/i.test(JSON.stringify(err.response?.data || ''))

      if (expired && !_retried && this.isLinked) {
        try {
          const ok = await this._refresh()
          if (ok) return this.request(method, url, { body, params }, true)
        } catch (_) { /* fall through to unlink */ }
        // refresh failed → session is dead
        await this.unlinkLocal()
        throw new ChuviApiError('SESSION_EXPIRED', 401, null)
      }
      throw new ChuviApiError(msg, status, err.response?.data)
    }
  }

  /* ============================ AUTH / LINKING ============================ */

  async login (email, password) {
    const res = await this.http.post('/auth/login', { email, password, userType: 'user' })
    const payload = res.data
    if (payload?.success === false) {
      throw new ChuviApiError(extractError({ response: { data: payload } }), res.status, payload)
    }
    const cookies = parseSetCookies(res.headers['set-cookie'] || [])
    if (!cookies.accessToken) {
      throw new ChuviApiError('Login succeeded but no session was returned. Please try again.', 500)
    }
    await this._saveTokens(cookies)
    const user = payload?.data?.user || payload?.user
    if (user) {
      this.botUser.chuvi.userId = user._id
      this.botUser.chuvi.email = user.email
      this.botUser.chuvi.linkedAt = new Date()
      this.botUser.knownEmail = user.email // remembered even after unlink
      this.botUser.markModified('chuvi')
      await this.botUser.save()
    }
    return user
  }

  async register ({ fullName, email, password, phoneNumber }) {
    const res = await this.http.post('/auth/register', {
      fullName, email, password, phoneNumber, userType: 'user'
    })
    const payload = res.data
    if (payload?.success === false) {
      throw new ChuviApiError(extractError({ response: { data: payload } }), res.status, payload)
    }
    return payload?.data ?? payload
  }

  // NOTE: backend looks users up with { email, userType } — userType is required
  verifyOtp (email, otp) { return this.request('post', '/auth/verify-otp', { body: { email, otp, userType: 'user' } }) }
  resendOtp (email) { return this.request('post', '/auth/resend-otp', { body: { email, userType: 'user' } }) }
  forgotPassword (email) { return this.request('post', '/auth/forgot-password', { body: { email, userType: 'user' } }) }

  /**
   * Side-effect-free existence check: attempts login with a throwaway password
   * and classifies the backend's error message. Sends NO emails.
   * Returns 'free' | 'unverified' | 'exists' | 'unknown'.
   */
  async probeEmail (email) {
    try {
      const res = await this.http.post('/auth/login', {
        email,
        password: `probe-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        userType: 'user'
      })
      const payload = res.data
      if (payload?.success !== false) return 'exists' // shouldn't happen with a random password
      const msg = JSON.stringify(payload)
      if (/user not found/i.test(msg)) return 'free'
      if (/not verified/i.test(msg)) return 'unverified'
      return 'exists' // invalid credentials → account exists with a different password
    } catch (err) {
      const msg = JSON.stringify(err.response?.data || '')
      if (/user not found/i.test(msg)) return 'free'
      if (/not verified/i.test(msg)) return 'unverified'
      if (err.response) return 'exists'
      return 'unknown' // network problem — don't block registration on it
    }
  }

  verifyResetPasswordOtp (email, otp) {
    return this.request('post', '/auth/verify-reset-password-otp', { body: { email, otp, userType: 'user' } })
  }

  resetPassword (resetToken, password) {
    return this.request('post', '/auth/reset-password', { body: { resetToken, password, userType: 'user' } })
  }

  async unlinkLocal () {
    this.botUser.chuvi = {}
    this.botUser.markModified('chuvi')
    await this.botUser.save()
  }

  /* ============================ USER / PROFILE ============================ */

  getDashboard () { return this.request('get', '/users/get-dashboard') }
  getAccount () { return this.request('get', '/users/get-account') }
  updateUser (fields) { return this.request('put', '/users/update-user', { body: fields }) }
  changePassword (body) { return this.request('patch', '/users/change-password', { body }) }
  getAddresses () { return this.request('get', '/users/get-address') }
  addAddress (body) { return this.request('post', '/users/add-address', { body }) }
  updateAddress (addressId, body) { return this.request('put', `/users/update-address/${addressId}`, { body }) }
  deleteAddress (addressId) { return this.request('delete', `/users/delete-address/${addressId}`) }

  /* ============================ ORDERS ============================ */

  /**
   * @param {object} order matches backend validation:
   * fullName, phoneNumber, serviceType, serviceTier(classic|premium|vip),
   * billingType(pay-per-item|pay-from-subscription|pay-from-wallet),
   * deliverySpeed(express|standard|same-day), isDelivery, isPickUp,
   * items: [{type, price, quantity}], plus pickup/delivery details + extraNote
   */
  createBookOrder (order) { return this.request('post', '/bookOrder/create-book-order', { body: order }) }
  orderHistory (params = {}) { return this.request('get', '/bookOrder/book-order-history', { params }) }
  getOrder (id) { return this.request('get', `/bookOrder/book-order/${id}`) }
  reportDeliveryIssue (orderId, body) { return this.request('patch', `/utils/order/${orderId}/report-issue`, { body }) }
  getHoldReasons () { return this.request('get', '/utils/hold-reasons') }

  /**
   * Live booking config — despite the /admin path this route uses regular user auth.
   * Returns: orderItems [{name, price, isHeavy}], heavyItems, serviceTypes, pickupTime slots,
   * deliveryFee, pickupFee, sameDayCharge, expressCharge,
   * premiumServiceTierCharge, vipServiceTierCharge, bankDetails, capacities.
   */
  getOrderConfig () { return this.request('get', '/admin/admin-order-details') }

  /* ============================ WALLET ============================ */

  walletBalance () { return this.request('get', '/wallet/wallet-balance') }
  walletTransactions (params = {}) { return this.request('get', '/wallet/fetch-user-transactions', { params }) }
  monthlyTransactions () { return this.request('get', '/wallet/get-monthly-transactions') }
  /** Returns Paystack init payload incl. authorization_url */
  walletTopUp (amount) { return this.request('post', '/wallet/wallet-top-up', { body: { amount } }) }
  payWithWallet (bookOrderId) { return this.request('post', '/wallet/pay-with-wallet', { body: { bookOrderId } }) }

  /* ============================ PAYMENTS (Paystack) ============================ */

  /**
   * transactionType: 'order' (requires orderId) | 'subscription' (requires planId)
   * Returns Paystack data with authorization_url + reference.
   */
  initializePayment ({ transactionType, orderId, planId }) {
    return this.request('post', '/users/initialize-payment', { body: { transactionType, orderId, planId } })
  }

  /* ============================ SUBSCRIPTIONS ============================ */

  getPlans () { return this.request('get', '/subscription/get-plans') }
  getPlan (id) { return this.request('get', `/subscription/get-plan/${id}`) }
  subscribePlan (planId) { return this.request('post', '/subscription/subscribe-plan', { body: { planId } }) }
  cancelSubscription () { return this.request('post', '/subscription/cancel-subscription', { body: {} }) }
  currentSubscription () { return this.request('get', '/subscription/current-subscription') }

  /* ============================ NOTIFICATIONS ============================ */

  getNotifications (params = {}) { return this.request('get', '/notifications/', { params }) }
  markNotificationRead (id) { return this.request('patch', `/notifications/${id}/mark-read`) }
  markAllNotificationsRead () { return this.request('patch', '/notifications/mark-all-read') }

  /* ============================ PUBLIC ============================ */

  publicPlans () { return this.request('get', '/public/get-plans') }
}

export default ChuviClient
