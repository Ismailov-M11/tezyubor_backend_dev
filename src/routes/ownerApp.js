const express = require('express')
const { customAlphabet } = require('nanoid')
const prisma = require('../config/db')
const { auth, requireRole } = require('../middleware/auth')

const router = express.Router()

function normalizePhone(phone) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('998') && digits.length === 12) return `+${digits}`
  if (digits.length === 9) return `+998${digits}`
  return digits.length > 0 ? `+${digits}` : null
}

async function generateOrderToken() {
  while (true) {
    const digits = Math.floor(1000000 + Math.random() * 9000000).toString()
    const token = `ORD${digits}`
    const existing = await prisma.order.findUnique({ where: { token } })
    if (!existing) return token
  }
}

router.use(auth, requireRole('owner'))

// GET /api/owner/stores — all stores belonging to this owner
router.get('/stores', async (req, res, next) => {
  try {
    const pharmacies = await prisma.pharmacy.findMany({
      where: { owners: { some: { id: req.user.id } } },
      select: {
        id: true, name: true, ownerName: true, address: true, phone: true,
        email: true, lat: true, lng: true, login: true,
        isActive: true, subscriptionExpiry: true, allowedCouriers: true,
        noorPaymentType: true, balance: true, city: true, district: true, createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    })
    res.json({ success: true, data: { pharmacies, total: pharmacies.length } })
  } catch (err) {
    next(err)
  }
})

// GET /api/owner/orders — all orders from all owner's stores
router.get('/orders', async (req, res, next) => {
  try {
    const myStores = await prisma.pharmacy.findMany({
      where: { owners: { some: { id: req.user.id } } },
      select: { id: true },
    })
    const storeIds = myStores.map((p) => p.id)
    if (storeIds.length === 0) {
      return res.json({ success: true, data: { orders: [], total: 0, page: 1, pageSize: 20 } })
    }

    const page = Math.max(1, parseInt(req.query.page) || 1)
    const pageSize = Math.min(500, Math.max(1, parseInt(req.query.pageSize) || 20))
    const where = { pharmacyId: { in: storeIds } }

    const { search, status, courier, dateFrom, dateTo, pharmacyId } = req.query

    if (pharmacyId && storeIds.includes(pharmacyId)) {
      where.pharmacyId = pharmacyId
    }

    if (search && search.trim()) {
      const s = search.trim()
      where.OR = [
        { token: { contains: s, mode: 'insensitive' } },
        { customerName: { contains: s, mode: 'insensitive' } },
        { customerPhone: { contains: s } },
        { customerAddress: { contains: s, mode: 'insensitive' } },
      ]
    }

    if (status && status.trim()) {
      const statuses = status.split(',').map((s) => s.trim()).filter(Boolean)
      where.status = statuses.length === 1 ? statuses[0] : { in: statuses }
    }

    if (courier && courier.trim()) {
      const couriers = courier.split(',').map((c) => c.trim()).filter(Boolean)
      where.selectedCourier = couriers.length === 1 ? couriers[0] : { in: couriers }
    }

    if (dateFrom || dateTo) {
      where.createdAt = {}
      if (dateFrom) where.createdAt.gte = new Date(dateFrom)
      if (dateTo) {
        const end = new Date(dateTo)
        end.setHours(23, 59, 59, 999)
        where.createdAt.lte = end
      }
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          pharmacy: { select: { id: true, name: true } },
        },
      }),
      prisma.order.count({ where }),
    ])

    res.json({ success: true, data: { orders, total, page, pageSize } })
  } catch (err) {
    next(err)
  }
})

// POST /api/owner/orders — create order on behalf of one of owner's stores
router.post('/orders', async (req, res, next) => {
  try {
    const { pharmacyId, pharmacyComment, medicinesTotal, customerPhone, customerName } = req.body
    if (!pharmacyId) {
      return res.status(400).json({ success: false, message: 'pharmacyId is required' })
    }

    const pharmacy = await prisma.pharmacy.findFirst({
      where: { id: pharmacyId, owners: { some: { id: req.user.id } } },
      select: { id: true, name: true, isActive: true },
    })
    if (!pharmacy) {
      return res.status(403).json({ success: false, message: 'Store not found or not owned by you' })
    }
    if (!pharmacy.isActive) {
      return res.status(403).json({ success: false, message: 'Store is inactive' })
    }

    const token = await generateOrderToken()
    const cleanPhone = normalizePhone(customerPhone)
    const order = await prisma.order.create({
      data: {
        token,
        pharmacyId,
        pharmacyComment: pharmacyComment || null,
        medicinesTotal: medicinesTotal != null ? Number(medicinesTotal) : 0,
        customerPhone: cleanPhone,
        customerName: customerName || null,
      },
    })

    const baseUrl = process.env.CLIENT_URL || 'https://tezyubor.uz'
    const orderUrl = `${baseUrl}/order/${token}`

    if (cleanPhone) {
      const { sendSms } = require('../utils/eskizApi')
      const message = `${pharmacy.name}\nSsylka dlya zakaza / Buyurtma havolasi:\n${orderUrl}`
      sendSms(cleanPhone, message)
        .then(() => console.log(`[eskiz] SMS dispatched for order ${token}`))
        .catch((err) => console.error(`[eskiz] SMS error for order ${token}:`, err.message))
    }

    res.status(201).json({ success: true, data: { order, orderUrl } })
  } catch (err) {
    next(err)
  }
})

module.exports = router
