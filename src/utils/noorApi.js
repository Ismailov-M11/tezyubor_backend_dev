const NOOR_HOST       = process.env.NOOR_HOST       // https://back.noor.uz
const NOOR_TOKEN      = process.env.NOOR_TOKEN
const NOOR_ACCOUNT_ID = process.env.NOOR_ACCOUNT_ID || null

function normalizePhone(phone) {
  if (!phone) return ''
  return phone.startsWith('+998') ? phone : `+998${phone}`
}

function noorHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${NOOR_TOKEN}`,
    ...extra,
  }
}

function noorDelivery() {
  return { door_to_door: true, equipment_id: 1, type: 'EXPRESS', send_link: true, product_paid: true, time: null }
}

/**
 * Evaluate delivery feasibility + price.
 * evaluated_stage: 1 = ok, 23 = no funds, 27 = no couriers, 28 = out of zone
 */
async function evaluate(orgLat, orgLon, destLat, destLon) {
  const url = `${NOOR_HOST}/api/v1/orders/eval`

  const body = {
    vendor_order_id: '0',
    is_business: true,
    origin: [{
      location: { long: orgLon, lat: orgLat },
      order: 1,
      address: '',
      entrance: '',
      door_phone: '',
      floor: null,
      apartment: '',
      comment: '',
      client: { phone: '', name: 'Отправитель', email: '' },
      products: { type_id: 1, description: 'Медикаменты', items: [] },
    }],
    destination: [{
      location: { long: destLon, lat: destLat },
      order: 2,
      address: '',
      entrance: '',
      door_phone: '',
      floor: null,
      apartment: '',
      comment: '',
      client: { phone: '', name: 'Получатель', email: '' },
      products: { type_id: 1, description: 'Медикаменты', items: [] },
    }],
    payment_type: 'CASH',
    delivery: noorDelivery(),
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: noorHeaders({ 'Accept-Language': 'ru' }),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Noor evaluate failed ${res.status}: ${text}`)
  }
  return res.json()
}

/**
 * Create a Noor Express delivery order.
 */
async function createOrder(order, acceptLanguage = 'ru', paymentType = 'CASH') {
  const url = `${NOOR_HOST}/api/v1/orders`

  const floor = order.floor && /^\d+$/.test(order.floor) ? parseInt(order.floor) : null

  const productName = order.pharmacyComment || 'Медикаменты'

  const body = {
    vendor_order_id: String(order.id),
    is_business: true,
    is_paid: true,
    ...(NOOR_ACCOUNT_ID && { accountId: NOOR_ACCOUNT_ID }),
    payment_type: paymentType,
    origin: [{
      location: { long: order.pharmacy.lng, lat: order.pharmacy.lat },
      order: 1,
      address: order.pharmacy.address,
      entrance: '',
      door_phone: '',
      floor: null,
      apartment: '',
      comment: '',
      client: {
        phone: normalizePhone(order.pharmacy.phone),
        name: order.pharmacy.name,
        email: '',
      },
      products: { type_id: 1, description: productName, items: [] },
    }],
    destination: [{
      location: { long: order.customerLng, lat: order.customerLat },
      order: 2,
      address: order.customerAddress,
      entrance: order.entrance || '',
      door_phone: order.intercom || '',
      floor,
      apartment: order.apartment || '',
      comment: order.customerComment || '',
      client: {
        phone: normalizePhone(order.customerPhone),
        name: order.customerName,
        email: '',
      },
      products: {
        type_id: 1,
        description: productName,
        items: [{
          name: productName,
          price_per_unit: Math.round(order.medicinesTotal),
          quantity: 1,
          weight: null,
          height: null,
          width: null,
          length: null,
        }],
      },
    }],
    delivery: noorDelivery(),
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: noorHeaders({ 'Accept-Language': acceptLanguage }),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Noor createOrder failed ${res.status}: ${text}`)
  }
  return res.json()
}

/**
 * Re-order (retry finding a courier).
 */
async function reorder(noorOrderId) {
  const url = `${NOOR_HOST}/api/v1/orders/${noorOrderId}/re-order`
  const res = await fetch(url, { method: 'POST', headers: noorHeaders() })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Noor reorder failed ${res.status}: ${text}`)
  }
}

/**
 * Cancel a Noor order.
 */
async function cancelOrder(noorOrderId) {
  const url = `${NOOR_HOST}/api/v1/orders/${noorOrderId}/cancel`
  const res = await fetch(url, { method: 'PATCH', headers: noorHeaders() })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Noor cancel failed ${res.status}: ${text}`)
  }
}

module.exports = { evaluate, createOrder, reorder, cancelOrder }
