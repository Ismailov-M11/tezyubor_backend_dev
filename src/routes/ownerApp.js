const express = require('express')
const { customAlphabet } = require('nanoid')
const bcrypt = require('bcryptjs')
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

// GET /api/owner/analytics?pharmacyId=optional
router.get('/analytics', async (req, res, next) => {
  try {
    const myStores = await prisma.pharmacy.findMany({
      where: { owners: { some: { id: req.user.id } } },
      select: { id: true },
    })
    const storeIds = myStores.map((p) => p.id)
    if (storeIds.length === 0) {
      return res.json({ success: true, data: { totalOrders: 0, totalMedicinesAmount: 0, totalDeliveryAmount: 0, totalRevenue: 0, ordersByStatus: [], ordersByCourier: [], ordersByDay: [] } })
    }

    const pharmacyId = req.query.pharmacyId && storeIds.includes(req.query.pharmacyId)
      ? req.query.pharmacyId
      : { in: storeIds }

    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const [totalOrders, aggregates, ordersByStatus, ordersByCourier, recentOrders] = await Promise.all([
      prisma.order.count({ where: { pharmacyId } }),
      prisma.order.aggregate({ where: { pharmacyId }, _sum: { medicinesTotal: true, deliveryPrice: true, totalPrice: true } }),
      prisma.order.groupBy({ by: ['status'], where: { pharmacyId }, _count: { id: true } }),
      prisma.order.groupBy({ by: ['selectedCourier'], where: { pharmacyId, selectedCourier: { not: null } }, _count: { id: true } }),
      prisma.order.findMany({ where: { pharmacyId, createdAt: { gte: thirtyDaysAgo } }, select: { createdAt: true }, orderBy: { createdAt: 'asc' } }),
    ])

    const ordersByDayMap = {}
    recentOrders.forEach((o) => {
      const day = o.createdAt.toISOString().split('T')[0]
      ordersByDayMap[day] = (ordersByDayMap[day] || 0) + 1
    })

    res.json({
      success: true,
      data: {
        totalOrders,
        totalMedicinesAmount: aggregates._sum.medicinesTotal || 0,
        totalDeliveryAmount: aggregates._sum.deliveryPrice || 0,
        totalRevenue: aggregates._sum.totalPrice || 0,
        ordersByStatus: ordersByStatus.map((s) => ({ status: s.status, count: s._count.id })),
        ordersByCourier: ordersByCourier.map((c) => ({ courier: c.selectedCourier, count: c._count.id })),
        ordersByDay: Object.entries(ordersByDayMap).map(([date, count]) => ({ date, count })),
      },
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/owner/clients?pharmacyId=optional
router.get('/clients', async (req, res, next) => {
  try {
    const myStores = await prisma.pharmacy.findMany({
      where: { owners: { some: { id: req.user.id } } },
      select: { id: true },
    })
    const storeIds = myStores.map((p) => p.id)
    if (storeIds.length === 0) {
      return res.json({ success: true, data: { clients: [], total: 0 } })
    }

    const pharmacyId = req.query.pharmacyId && storeIds.includes(req.query.pharmacyId)
      ? req.query.pharmacyId
      : { in: storeIds }

    const { search, dateFrom, dateTo, minOrders } = req.query
    const dbWhere = { pharmacyId, customerPhone: { not: null } }

    if (search && search.trim()) {
      const s = search.trim()
      dbWhere.OR = [
        { customerName: { contains: s, mode: 'insensitive' } },
        { customerPhone: { contains: s } },
        { customerAddress: { contains: s, mode: 'insensitive' } },
      ]
    }
    if (dateFrom || dateTo) {
      dbWhere.createdAt = {}
      if (dateFrom) dbWhere.createdAt.gte = new Date(dateFrom)
      if (dateTo) {
        const end = new Date(dateTo)
        end.setHours(23, 59, 59, 999)
        dbWhere.createdAt.lte = end
      }
    }

    const orders = await prisma.order.findMany({
      where: dbWhere,
      select: { customerName: true, customerPhone: true, customerAddress: true, apartment: true, entrance: true, floor: true, intercom: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })

    const clientsMap = new Map()
    for (const order of orders) {
      const phone = normalizePhone(order.customerPhone)
      if (!phone) continue
      if (!clientsMap.has(phone)) {
        clientsMap.set(phone, { phone, name: order.customerName, addresses: new Set(), ordersCount: 0, lastOrderAt: order.createdAt })
      }
      const client = clientsMap.get(phone)
      client.ordersCount++
      if (order.customerAddress) {
        const parts = [
          order.apartment ? `кв. ${order.apartment}` : null,
          order.entrance  ? `п. ${order.entrance}`   : null,
          order.floor     ? `эт. ${order.floor}`     : null,
          order.intercom  ? `домофон ${order.intercom}` : null,
        ].filter(Boolean)
        client.addresses.add(parts.length ? `${order.customerAddress}, ${parts.join(', ')}` : order.customerAddress)
      }
    }

    let clients = Array.from(clientsMap.values())
      .map((c) => ({ ...c, addresses: Array.from(c.addresses) }))
      .sort((a, b) => b.ordersCount - a.ordersCount)

    if (minOrders) {
      const min = parseInt(minOrders)
      if (!isNaN(min) && min > 0) clients = clients.filter((c) => c.ordersCount >= min)
    }

    res.json({ success: true, data: { clients, total: clients.length } })
  } catch (err) {
    next(err)
  }
})

// GET /api/owner/stores/:id — get store settings
router.get('/stores/:id', async (req, res, next) => {
  try {
    const pharmacy = await prisma.pharmacy.findFirst({
      where: { id: req.params.id, owners: { some: { id: req.user.id } } },
      select: {
        id: true, name: true, ownerName: true, address: true, phone: true,
        email: true, lat: true, lng: true, login: true,
        isActive: true, subscriptionExpiry: true, allowedCouriers: true,
        noorPaymentType: true, balance: true, city: true, district: true, createdAt: true,
      },
    })
    if (!pharmacy) return res.status(404).json({ success: false, message: 'Store not found' })
    res.json({ success: true, data: pharmacy })
  } catch (err) {
    next(err)
  }
})

// PUT /api/owner/stores/:id — update store settings
router.put('/stores/:id', async (req, res, next) => {
  try {
    const pharmacy = await prisma.pharmacy.findFirst({
      where: { id: req.params.id, owners: { some: { id: req.user.id } } },
      select: { id: true, password: true },
    })
    if (!pharmacy) return res.status(404).json({ success: false, message: 'Store not found' })

    const { name, ownerName, phone, address, city, district, currentPassword, newPassword, noorPaymentType } = req.body
    const data = {}
    if (name !== undefined && name.trim()) data.name = name.trim()
    if (ownerName !== undefined) data.ownerName = ownerName || null
    if (phone !== undefined && phone.trim()) data.phone = normalizePhone(phone) || phone.trim()
    if (address !== undefined) data.address = address || null
    if (city !== undefined) data.city = city || null
    if (district !== undefined) data.district = district || null
    if (noorPaymentType !== undefined && ['CASH', 'BALANCE'].includes(noorPaymentType)) {
      data.noorPaymentType = noorPaymentType
    }

    if (newPassword && newPassword.trim()) {
      if (!currentPassword) {
        return res.status(400).json({ success: false, message: 'Current password is required' })
      }
      const valid = await bcrypt.compare(currentPassword, pharmacy.password)
      if (!valid) {
        return res.status(400).json({ success: false, message: 'Current password is incorrect' })
      }
      if (newPassword.trim().length < 6) {
        return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' })
      }
      data.password = await bcrypt.hash(newPassword.trim(), 10)
    }

    const updated = await prisma.pharmacy.update({
      where: { id: req.params.id },
      data,
      select: {
        id: true, name: true, ownerName: true, address: true, phone: true,
        email: true, lat: true, lng: true, login: true,
        isActive: true, subscriptionExpiry: true, city: true, district: true,
        noorPaymentType: true, balance: true,
      },
    })
    res.json({ success: true, data: updated })
  } catch (err) {
    next(err)
  }
})

module.exports = router
