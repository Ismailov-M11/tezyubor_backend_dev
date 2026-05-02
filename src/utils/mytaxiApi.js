const MYTAXI_HOST  = process.env.MYTAXI_API_HOST || 'https://external.mytaxi.uz'
const MYTAXI_TOKEN = process.env.MYTAXI_TOKEN
const DELIVERY_TARIFF_ID = 22

function mytaxiHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${MYTAXI_TOKEN}`,
    'Accept-Language': 'ru',
  }
}

/**
 * Get delivery offer (price estimate) for a route.
 * Returns offer_id + array of offers per tariff.
 */
async function getOffer(fromLat, fromLon, toLat, toLon) {
  const url = `${MYTAXI_HOST}/v1/offers`
  const body = {
    route_points: [
      { lat: fromLat, lon: fromLon },
      { lat: toLat, lon: toLon },
    ],
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: mytaxiHeaders(),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`MyTaxi getOffer failed ${res.status}: ${text}`)
  }
  return res.json()
}

/**
 * Create a delivery order using the offer_id obtained from getOffer().
 * Returns { order_id, expires_at }.
 */
async function createOrder(order, offerId) {
  const url = `${MYTAXI_HOST}/v1/orders`
  const commentParts = [
    order.customerAddress,
    order.apartment   ? `кв. ${order.apartment}`   : null,
    order.entrance    ? `п. ${order.entrance}`      : null,
    order.floor       ? `эт. ${order.floor}`        : null,
    order.customerComment || null,
  ].filter(Boolean)

  const body = {
    offer_id: offerId,
    tariff_id: DELIVERY_TARIFF_ID,
    user_name: order.customerName || 'Клиент',
    user_phone: order.customerPhone,
    comment: commentParts.join(', ') || undefined,
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: mytaxiHeaders(),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`MyTaxi createOrder failed ${res.status}: ${text}`)
  }
  return res.json()
}

/**
 * Cancel a MyTaxi order.
 */
async function cancelOrder(mytaxiOrderId) {
  const url = `${MYTAXI_HOST}/v1/orders/${mytaxiOrderId}/cancel`
  const res = await fetch(url, {
    method: 'POST',
    headers: mytaxiHeaders(),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`MyTaxi cancelOrder failed ${res.status}: ${text}`)
  }
}

module.exports = { getOffer, createOrder, cancelOrder }
