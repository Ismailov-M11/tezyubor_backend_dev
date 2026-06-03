const { v4: uuidv4 } = require('uuid')

const YANDEX_HOST  = 'https://b2b.taxi.yandex.net/b2b/cargo/integration/v2'
const YANDEX_TOKEN = process.env.YANDEX_TOKEN

// Yandex claim status → our OrderStatus
const CLAIM_STATUS_MAP = {
  performer_lookup:              'courier_pickup',
  performer_found:               'courier_pickup',
  performer_draft:               'courier_pickup',
  pickup_arrived:                'courier_pickup',
  ready_for_pickup_confirmation: 'courier_pickup',
  pickuped:                      'courier_picked',
  delivery_arrived:              'courier_delivery',
  ready_for_delivery_confirmation: 'courier_delivery',
  delivered:                     'delivered',
  delivered_finish:              'delivered',
  returned:                      'cancelled',
  returned_finish:               'cancelled',
  failed:                        'cancelled',
  cancelled:                     'cancelled',
  cancelled_with_payment:        'cancelled',
  estimating_failed:             'cancelled',
}

function headers() {
  return {
    'Content-Type':   'application/json',
    'Authorization':  `Bearer ${YANDEX_TOKEN}`,
    'Accept-Language': 'ru',
  }
}

function normalizePhone(phone) {
  if (!phone) return '+998000000000'
  return phone.startsWith('+998') ? phone : `+998${phone.replace(/\D/g, '')}`
}

/**
 * Calculate delivery price via offers/calculate.
 * Returns { available, price, offerId, offerTtl }
 */
async function calculate(fromLng, fromLat, toLng, toLat) {
  const body = {
    items: [{ quantity: 1, size: { height: 0.1, length: 0.1, width: 0.1 }, weight: 1 }],
    client_requirements: { assign_robot: false, pro_courier: false, cargo_options: [], taxi_class: 'courier' },
    route_points: [
      { coordinates: [fromLng, fromLat] },
      { coordinates: [toLng,   toLat]   },
    ],
    skip_door_to_door: false,
  }
  const res = await fetch(`${YANDEX_HOST}/offers/calculate`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Yandex calculate failed ${res.status}: ${text}`)
  }
  const data = await res.json()
  const offer = data?.offers?.find((o) => o.taxi_class === 'courier') ?? data?.offers?.[0]
  if (!offer) throw new Error('Yandex: no courier offer available')
  return {
    available: true,
    price:     Math.round(parseFloat(offer.price?.total_price ?? 0)),
    offerId:   offer.payload,
    offerTtl:  offer.offer_ttl,
  }
}

/**
 * Create a Yandex delivery claim.
 * offerId — payload from offers/calculate.
 * Returns { claimId, version }
 */
async function createClaim(order, offerId) {
  const requestId = uuidv4()
  const callbackUrl = process.env.YANDEX_CALLBACK_URL || 'https://api.tezyubor.uz/api/yandex/webhook?'

  const senderPhone = normalizePhone(order.pharmacy?.phone ?? order.senderPhone)
  const senderName  = order.pharmacy?.name ?? order.senderName ?? 'Отправитель'
  const senderAddr  = order.pharmacy?.address ?? order.senderAddress ?? ''

  const fromLng = order.pharmacy?.lng ?? order.senderLng
  const fromLat = order.pharmacy?.lat ?? order.senderLat
  const toLng   = order.customerLng
  const toLat   = order.customerLat

  const comment = order.pharmacyComment || 'Товары'

  const body = {
    offer: { offer_id: offerId },
    callback_properties: { callback_url: callbackUrl },
    client_requirements: { assign_robot: false, pro_courier: false, taxi_class: 'courier', cargo_options: [] },
    comment,
    emergency_contact: { name: senderName, phone: senderPhone },
    items: [{
      cost_currency: 'UZS',
      cost_value:    String(Math.round(order.medicinesTotal ?? 0)) + '.00',
      droppof_point: 2,
      extra_id:      String(order.id),
      pickup_point:  1,
      quantity:      1,
      size:          { height: 0.1, length: 0.1, width: 0.1 },
      title:         comment,
      weight:        1,
    }],
    optional_return: false,
    route_points: [
      {
        address: {
          coordinates:  [fromLng, fromLat],
          fullname:     senderAddr,
          country:      'Узбекистан',
          comment:      '',
        },
        contact:          { name: senderName, phone: senderPhone },
        external_order_id: String(order.id),
        point_id:         1,
        skip_confirmation: true,
        type:             'source',
        visit_order:      1,
      },
      {
        address: {
          coordinates:  [toLng, toLat],
          fullname:     order.customerAddress || '',
          country:      'Узбекистан',
          comment:      order.customerComment || '',
          ...(order.entrance && { porch: String(order.entrance) }),
          ...(order.apartment && { sflat: String(order.apartment) }),
          ...(order.floor && { sfloor: String(order.floor) }),
        },
        contact:          { name: order.customerName || 'Получатель', phone: normalizePhone(order.customerPhone) },
        external_order_id: String(order.id),
        point_id:         2,
        skip_confirmation: true,
        type:             'destination',
        visit_order:      2,
      },
    ],
    skip_act:              true,
    skip_client_notify:    false,
    skip_door_to_door:     false,
    skip_emergency_notify: false,
  }

  const res = await fetch(`${YANDEX_HOST}/claims/create?request_id=${requestId}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Yandex createClaim failed ${res.status}: ${text}`)
  }
  const data = await res.json()
  return { claimId: data.id, version: data.version ?? 1 }
}

/**
 * Confirm (accept) a claim so Yandex starts searching for a courier.
 */
async function acceptClaim(claimId, version = 1) {
  const res = await fetch(`${YANDEX_HOST}/claims/accept?claim_id=${claimId}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ version }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Yandex acceptClaim failed ${res.status}: ${text}`)
  }
  return res.json()
}

/**
 * Get current claim status and details.
 */
async function getClaimInfo(claimId) {
  const res = await fetch(`${YANDEX_HOST}/claims/info?claim_id=${claimId}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({}),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Yandex getClaimInfo failed ${res.status}: ${text}`)
  }
  return res.json()
}

/**
 * Cancel a claim. cancelState: 'free' | 'paid'
 */
async function cancelClaim(claimId, version = 1, cancelState = 'free') {
  const res = await fetch(`${YANDEX_HOST}/claims/cancel?claim_id=${claimId}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ version, cancel_state: cancelState }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Yandex cancelClaim failed ${res.status}: ${text}`)
  }
}

/**
 * Get customer tracking link for a claim.
 */
async function getTrackingLink(claimId) {
  const res = await fetch(`${YANDEX_HOST}/claims/tracking-links?claim_id=${claimId}`, {
    method: 'GET',
    headers: headers(),
  })
  if (!res.ok) return null
  const data = await res.json()
  return data?.links?.[0]?.url ?? null
}

module.exports = { calculate, createClaim, acceptClaim, getClaimInfo, cancelClaim, getTrackingLink, CLAIM_STATUS_MAP }
