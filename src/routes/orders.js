const express = require('express')
const prisma = require('../config/db')
const { auth } = require('../middleware/auth')
const noorApi = require('../utils/noorApi')
const millenniumApi = require('../utils/millenniumApi')
const mytaxiApi = require('../utils/mytaxiApi')

const NOOR_EVAL_ERRORS = {
  23: 'Недостаточно средств на балансе Noor',
  27: 'Нет свободных курьеров в вашем районе',
  28: 'Адрес доставки вне зоны обслуживания Noor',
}

const router = express.Router()

// GET /api/orders/:token/saved-addresses — public, returns saved addresses for this customer+pharmacy
router.get('/:token/saved-addresses', async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({ where: { token: req.params.token } })
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' })
    if (order.status !== 'pending') return res.status(403).json({ success: false, message: 'Forbidden' })
    if (!order.customerPhone) return res.json({ success: true, data: { addresses: [] } })

    // Build phone variants to handle both +998... and 998... stored formats
    const rawDigits = order.customerPhone.replace(/\D/g, '')
    const fullDigits = rawDigits.startsWith('998') && rawDigits.length === 12 ? rawDigits : `998${rawDigits}`
    const phoneVariants = Array.from(new Set([fullDigits, `+${fullDigits}`, rawDigits].filter(Boolean)))

    const pastOrders = await prisma.order.findMany({
      where: {
        pharmacyId: order.pharmacyId,
        customerPhone: { in: phoneVariants },
        customerAddress: { not: null },
        token: { not: order.token },
        status: { in: ['awaiting_confirmation', 'confirmed', 'courier_pickup', 'courier_picked', 'courier_delivery', 'delivered'] },
      },
      select: {
        customerAddress: true,
        apartment: true,
        entrance: true,
        floor: true,
        intercom: true,
        customerLat: true,
        customerLng: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    const seen = new Set()
    const addresses = []
    for (const o of pastOrders) {
      if (!o.customerAddress || seen.has(o.customerAddress)) continue
      seen.add(o.customerAddress)
      addresses.push({
        customerAddress: o.customerAddress,
        apartment: o.apartment,
        entrance: o.entrance,
        floor: o.floor,
        intercom: o.intercom,
        customerLat: o.customerLat,
        customerLng: o.customerLng,
      })
    }

    res.json({ success: true, data: { addresses } })
  } catch (err) {
    next(err)
  }
})

// GET /api/orders/:token/check — lightweight status check, always accessible
router.get('/:token/check', async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({
      where: { token: req.params.token },
      select: { token: true, status: true },
    })
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' })
    res.json({ success: true, data: { token: order.token, status: order.status } })
  } catch (err) {
    next(err)
  }
})

// GET /api/orders/:token — public, blocked for terminal orders
router.get('/:token', async (req, res, next) => {
  try {
    const raw = await prisma.order.findUnique({
      where: { token: req.params.token },
      include: {
        pharmacy: { select: { name: true, address: true, phone: true, lat: true, lng: true, allowedCouriers: true } },
        partner: { select: { name: true, type: true, phone: true, address: true, lat: true, lng: true, courierMarkups: { select: { courierType: true, markupPercent: true, isEnabled: true } } } },
        partnerShop: { select: { name: true, phone: true, address: true, lat: true, lng: true } },
      }
    })
    if (!raw) {
      return res.status(404).json({ success: false, message: 'Order not found' })
    }
    if (raw.status === 'cancelled' || raw.status === 'delivered') {
      return res.status(403).json({ success: false, message: 'Order is closed' })
    }
    const { pharmacy, partner, partnerShop, ...order } = raw
    const response = {
      ...order,
      pharmacyName: pharmacy?.name ?? null,
      pharmacyAddress: pharmacy?.address ?? null,
      pharmacyPhone: pharmacy?.phone ?? null,
      pharmacyLat: pharmacy?.lat ?? null,
      pharmacyLng: pharmacy?.lng ?? null,
      pharmacyAllowedCouriers: partner
        ? (partner.courierMarkups?.filter(m => m.isEnabled).map(m => m.courierType).join(',') || null)
        : (pharmacy?.allowedCouriers ?? null),
      senderName: order.senderName ?? pharmacy?.name ?? partnerShop?.name ?? partner?.name ?? null,
      senderPhone: order.senderPhone ?? pharmacy?.phone ?? partnerShop?.phone ?? partner?.phone ?? null,
      senderAddress: order.senderAddress ?? pharmacy?.address ?? partnerShop?.address ?? partner?.address ?? null,
      senderLat: order.senderLat ?? pharmacy?.lat ?? partnerShop?.lat ?? partner?.lat ?? null,
      senderLng: order.senderLng ?? pharmacy?.lng ?? partnerShop?.lng ?? partner?.lng ?? null,
      partnerName: partner?.name ?? null,
      partnerType: partner?.type ?? null,
      partnerShopName: partnerShop?.name ?? null,
    }
    res.json({ success: true, data: response })
  } catch (err) {
    next(err)
  }
})

// PUT /api/orders/:token/confirm — fill customer details
router.put('/:token/confirm', async (req, res, next) => {
  try {
    const {
      customerName, customerPhone, customerAddress, customerComment,
      customerLat, customerLng,
      apartment, entrance, floor, intercom,
    } = req.body
    if (!customerName || !customerPhone || !customerAddress) {
      return res.status(400).json({ success: false, message: 'customerName, customerPhone, customerAddress required' })
    }
    const order = await prisma.order.findUnique({ where: { token: req.params.token } })
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' })
    if (order.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Order already confirmed' })
    }
    const updated = await prisma.order.update({
      where: { token: req.params.token },
      data: {
        customerName,
        customerPhone,
        customerAddress,
        apartment:  apartment  || null,
        entrance:   entrance   || null,
        floor:      floor      || null,
        intercom:   intercom   || null,
        customerComment: customerComment || null,
        customerLat: customerLat ?? null,
        customerLng: customerLng ?? null,
      }
    })
    res.json({ success: true, data: updated })
  } catch (err) {
    next(err)
  }
})

// POST /api/orders/:token/noor/evaluate — get Noor price & availability before confirming
router.post('/:token/noor/evaluate', async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({
      where: { token: req.params.token },
      include: {
        pharmacy: { select: { lat: true, lng: true, noorPaymentType: true, balance: true } },
        partner: { select: { courierMarkups: { where: { courierType: 'noor' }, select: { markupPercent: true } } } },
      },
    })
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' })
    if (!order.customerLat || !order.customerLng) {
      return res.status(400).json({ success: false, message: 'Координаты клиента не указаны' })
    }
    const senderLat = order.pharmacy?.lat ?? order.senderLat
    const senderLng = order.pharmacy?.lng ?? order.senderLng
    if (!senderLat || !senderLng) {
      return res.status(400).json({ success: false, message: 'Координаты отправителя не указаны' })
    }

    // If pharmacy uses balance payment — block immediately if balance is zero
    if (order.pharmacy?.noorPaymentType === 'BALANCE' && order.pharmacy?.balance <= 0) {
      return res.json({ success: true, data: { available: false, stage: null, price: null, error: 'Недостаточно средств на балансе' } })
    }

    console.log(`[Noor] evaluate coords: sender(${senderLat},${senderLng}) -> customer(${order.customerLat},${order.customerLng})`)

    const result = await noorApi.evaluate(
      senderLat, senderLng,
      order.customerLat, order.customerLng,
    )

    console.log('[Noor] evaluate response:', JSON.stringify(result))

    const stage = result?.evaluated_stage
    let available = stage === 1
    let price = result?.total_delivery_price ?? null
    const noorMarkup = order.partner?.courierMarkups?.[0]?.markupPercent ?? 0
    if (available && price !== null && noorMarkup > 0) price = Math.round(price * (1 + noorMarkup / 100))
    let errorMessage = available ? null : (NOOR_EVAL_ERRORS[stage] || `Ошибка оценки (stage ${stage})`)

    // If pharmacy uses balance — also check price fits in balance
    if (available && order.pharmacy?.noorPaymentType === 'BALANCE' && price !== null && order.pharmacy?.balance < price) {
      available = false
      errorMessage = 'Недостаточно средств на балансе'
    }

    console.log(`[Noor] result: available=${available}, stage=${stage}, price=${price}, error=${errorMessage}`)

    res.json({ success: true, data: { available, stage, price, error: errorMessage } })
  } catch (err) {
    next(err)
  }
})

// POST /api/orders/:token/millennium/evaluate — get Millennium price before confirming
router.post('/:token/millennium/evaluate', async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({
      where: { token: req.params.token },
      include: {
        pharmacy: { select: { lat: true, lng: true } },
        partner: { select: { courierMarkups: { where: { courierType: 'millennium' }, select: { markupPercent: true } } } },
      },
    })
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' })
    if (!order.customerLat || !order.customerLng) {
      return res.status(400).json({ success: false, message: 'Координаты клиента не указаны' })
    }
    const senderLat = order.pharmacy?.lat ?? order.senderLat
    const senderLng = order.pharmacy?.lng ?? order.senderLng
    if (!senderLat || !senderLng) {
      return res.status(400).json({ success: false, message: 'Координаты отправителя не указаны' })
    }

    console.log(`[Millennium] evaluate coords: sender(${senderLat},${senderLng}) -> customer(${order.customerLat},${order.customerLng})`)

    let price = await millenniumApi.calcOrderCost(
      senderLat, senderLng,
      order.customerLat, order.customerLng,
    )

    const millenniumMarkup = order.partner?.courierMarkups?.[0]?.markupPercent ?? 0
    if (millenniumMarkup > 0 && price !== null) price = Math.round(price * (1 + millenniumMarkup / 100))

    console.log(`[Millennium] result: available=true, price=${price}`)

    res.json({ success: true, data: { available: true, price } })
  } catch (err) {
    console.log('[Millennium] error:', err.message)
    res.json({ success: true, data: { available: false, price: null, error: err.message } })
  }
})

// POST /api/orders/:token/mytaxi/evaluate — get MyTaxi price & availability before confirming
router.post('/:token/mytaxi/evaluate', async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({
      where: { token: req.params.token },
      include: {
        pharmacy: { select: { lat: true, lng: true } },
        partner: { select: { courierMarkups: { where: { courierType: 'mytaxi' }, select: { markupPercent: true } } } },
      },
    })
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' })
    if (!order.customerLat || !order.customerLng) {
      return res.status(400).json({ success: false, message: 'Координаты клиента не указаны' })
    }
    const senderLat = order.pharmacy?.lat ?? order.senderLat
    const senderLng = order.pharmacy?.lng ?? order.senderLng
    if (!senderLat || !senderLng) {
      return res.status(400).json({ success: false, message: 'Координаты отправителя не указаны' })
    }

    console.log(`[MyTaxi] evaluate coords: sender(${senderLat},${senderLng}) -> customer(${order.customerLat},${order.customerLng})`)

    const result = await mytaxiApi.getOffer(
      senderLat, senderLng,
      order.customerLat, order.customerLng,
    )

    console.log('[MyTaxi] offer response:', JSON.stringify(result))

    const deliveryOffer = result?.offers?.find((o) => o.tariff_id === 'delivery')
    if (!deliveryOffer) {
      return res.json({ success: true, data: { available: false, price: null, eta: null, error: 'Доставка недоступна в этом районе' } })
    }

    const mytaxiMarkup = order.partner?.courierMarkups?.[0]?.markupPercent ?? 0
    const mytaxiPrice = mytaxiMarkup > 0
      ? Math.round(deliveryOffer.total_price * (1 + mytaxiMarkup / 100))
      : deliveryOffer.total_price

    res.json({
      success: true,
      data: {
        available: true,
        price: mytaxiPrice,
        eta: result?.route?.duration ?? null,
        error: null,
      },
    })
  } catch (err) {
    console.log('[MyTaxi] evaluate error:', err.message)
    res.json({ success: true, data: { available: false, price: null, eta: null, error: err.message } })
  }
})

// GET /api/orders/:token/status-logs — status change history (public, token-gated)
router.get('/:token/status-logs', async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({ where: { token: req.params.token } })
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' })

    const logs = await prisma.orderStatusLog.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
    })
    res.json({ success: true, data: { logs } })
  } catch (err) {
    next(err)
  }
})

// PUT /api/orders/:token/courier — customer selects courier, sets awaiting_confirmation
router.put('/:token/courier', async (req, res, next) => {
  try {
    const { courier, selectedCourier, deliveryPrice } = req.body
    const courierValue = courier || selectedCourier
    if (!courierValue) {
      return res.status(400).json({ success: false, message: 'courier required' })
    }

    const order = await prisma.order.findUnique({ where: { token: req.params.token } })
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' })

    const delivery = Number(deliveryPrice) || 0

    const updated = await prisma.order.update({
      where: { token: req.params.token },
      data: {
        selectedCourier: courierValue,
        deliveryPrice: delivery,
        totalPrice: (order.medicinesTotal || 0) + delivery,
        status: 'awaiting_confirmation',
      },
    })
    await prisma.orderStatusLog.create({
      data: { orderId: order.id, status: 'awaiting_confirmation', actor: 'customer', actorName: order.customerName || null },
    })
    res.json({ success: true, data: updated })
  } catch (err) {
    next(err)
  }
})

// PUT /api/orders/:token/status — update status (pharmacy auth)
router.put('/:token/status', auth, async (req, res, next) => {
  try {
    const { status } = req.body
    const validStatuses = ['pending', 'confirmed', 'courier_pickup', 'courier_picked', 'courier_delivery', 'delivered']
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' })
    }
    const order = await prisma.order.findUnique({ where: { token: req.params.token } })
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' })
    // Pharmacy can only update their own orders
    if (req.user.role === 'pharmacy' && order.pharmacyId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Forbidden' })
    }
    const updated = await prisma.order.update({
      where: { token: req.params.token },
      data: { status }
    })
    res.json({ success: true, data: updated })
  } catch (err) {
    next(err)
  }
})

module.exports = router
