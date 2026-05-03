const express = require('express')
const bcrypt = require('bcryptjs')
const prisma = require('../config/db')
const { auth, requireRole, requirePermission } = require('../middleware/auth')

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

const router = express.Router()
router.use(auth)
router.use(requireRole('admin'))

// GET /api/admin/me — returns fresh permissions for the current admin user
router.get('/me', async (req, res, next) => {
  try {
    if (req.user?.isSuperAdmin) {
      return res.json({ success: true, data: { isSuperAdmin: true, permissions: null } })
    }
    const adminUser = await prisma.adminUser.findUnique({
      where: { id: req.user.id },
      include: {
        roles: { include: { role: { select: { permissions: true, isActive: true } } } }
      }
    })
    if (!adminUser || !adminUser.isActive) {
      return res.status(403).json({ success: false, message: 'Account inactive' })
    }
    const permissions = [...new Set(
      adminUser.roles
        .filter(ur => ur.role.isActive)
        .flatMap(ur => ur.role.permissions)
    )]
    res.json({ success: true, data: { isSuperAdmin: false, permissions } })
  } catch (err) {
    next(err)
  }
})

// GET /api/admin/orders
router.get('/orders', requirePermission('orders:view'), async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const limit = Math.min(100, parseInt(req.query.limit) || 20)
    const skip = (page - 1) * limit
    const where = {}
    if (req.query.pharmacyId) {
      const ids = String(req.query.pharmacyId).split(',').map((s) => s.trim()).filter(Boolean)
      if (ids.length === 1) where.pharmacyId = ids[0]
      else if (ids.length > 1) where.pharmacyId = { in: ids }
    }

    const { search, status, courier, dateFrom, dateTo } = req.query

    if (search && search.trim()) {
      const s = search.trim()
      where.OR = [
        { token: { contains: s, mode: 'insensitive' } },
        { customerName: { contains: s, mode: 'insensitive' } },
        { customerPhone: { contains: s } },
        { customerAddress: { contains: s, mode: 'insensitive' } },
        { pharmacyComment: { contains: s, mode: 'insensitive' } },
      ]
    }

    if (status && status.trim()) {
      const statuses = status.split(',').map((s) => s.trim()).filter(Boolean)
      if (statuses.length === 1) {
        where.status = statuses[0]
      } else if (statuses.length > 1) {
        where.status = { in: statuses }
      }
    }

    if (courier && courier.trim()) {
      const couriers = courier.split(',').map((c) => c.trim()).filter(Boolean)
      if (couriers.length === 1) {
        where.selectedCourier = couriers[0]
      } else if (couriers.length > 1) {
        where.selectedCourier = { in: couriers }
      }
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

    const [rawOrders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { pharmacy: { select: { name: true, address: true, lat: true, lng: true, phone: true } } }
      }),
      prisma.order.count({ where })
    ])
    const orders = rawOrders.map(({ pharmacy, ...order }) => ({
      ...order,
      pharmacyName: pharmacy?.name ?? null,
      pharmacyAddress: pharmacy?.address ?? null,
      pharmacyPhone: pharmacy?.phone ?? null,
      pharmacyLat: pharmacy?.lat ?? null,
      pharmacyLng: pharmacy?.lng ?? null,
    }))
    res.json({
      success: true,
      data: { orders, total, page, pages: Math.ceil(total / limit) }
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/admin/orders — create order on behalf of a pharmacy
router.post('/orders', requirePermission('orders:create'), async (req, res, next) => {
  try {
    const { pharmacyId, pharmacyComment, medicinesTotal, customerPhone, customerName } = req.body
    if (!pharmacyId) return res.status(400).json({ success: false, message: 'pharmacyId required' })
    const pharmacy = await prisma.pharmacy.findUnique({ where: { id: pharmacyId } })
    if (!pharmacy) return res.status(404).json({ success: false, message: 'Pharmacy not found' })

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
        .then(() => console.log(`[eskiz] Admin SMS dispatched for order ${token}`))
        .catch((err) => console.error(`[eskiz] Admin SMS error for order ${token}:`, err.message))
    }

    res.status(201).json({ success: true, data: { order, orderUrl } })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/admin/orders/bulk
router.delete('/orders/bulk', requirePermission('orders:delete'), async (req, res, next) => {
  try {
    const { ids } = req.body
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' })
    }
    await prisma.order.deleteMany({ where: { id: { in: ids } } })
    res.json({ success: true, count: ids.length })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/admin/orders/:id
router.delete('/orders/:id', requirePermission('orders:delete'), async (req, res, next) => {
  try {
    await prisma.order.delete({ where: { id: req.params.id } })
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

// PUT /api/admin/orders/:token/confirm — admin confirms order and dispatches courier
router.put('/orders/:token/confirm', requirePermission('orders:confirm'), async (req, res, next) => {
  try {
    const noorApi = require('../utils/noorApi')
    const millenniumApi = require('../utils/millenniumApi')
    const SKIP = process.env.SKIP_COURIER_DISPATCH === 'true'

    const order = await prisma.order.findUnique({
      where: { token: req.params.token },
      include: { pharmacy: { select: { lat: true, lng: true, address: true, phone: true, name: true, noorPaymentType: true, balance: true } } },
    })
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' })
    if (order.status !== 'awaiting_confirmation') {
      return res.status(400).json({ success: false, message: 'Order is not awaiting confirmation' })
    }

    const courier = order.selectedCourier
    let noorOrderId = order.noorOrderId
    let noorDisplayId = order.noorDisplayId
    let millenniumOrderId = order.millenniumOrderId
    let mytaxiOrderId = order.mytaxiOrderId
    let trackingUrl = order.trackingUrl
    let orderPaymentType = order.paymentType

    if (!SKIP) {
      if (courier === 'noor') {
        const evalResult = await noorApi.evaluate(order.pharmacy.lat, order.pharmacy.lng, order.customerLat, order.customerLng)
        const stage = evalResult?.evaluated_stage
        if (stage !== 1) {
          const NOOR_ERRORS = { 23: 'Недостаточно средств на балансе Noor', 27: 'Нет свободных курьеров', 28: 'Адрес вне зоны Noor' }
          return res.status(400).json({ success: false, message: NOOR_ERRORS[stage] || `Noor: ошибка (stage ${stage})` })
        }

        const noorPmtType = order.pharmacy.noorPaymentType || 'CASH'

        if (noorPmtType === 'BALANCE') {
          const deliveryCost = order.deliveryPrice || 0
          if (order.pharmacy.balance < deliveryCost) {
            return res.status(400).json({ success: false, message: 'Недостаточно средств на балансе для создания заказа' })
          }
          await prisma.pharmacy.update({
            where: { id: order.pharmacyId },
            data: { balance: { decrement: deliveryCost } },
          })
          orderPaymentType = 'BALANCE'
        }

        const noorRes = await noorApi.createOrder({ ...order, pharmacy: order.pharmacy }, 'ru', noorPmtType)
        noorOrderId = noorRes?.order?.id ?? null
        noorDisplayId = noorRes?.order?.display_id ?? null
        trackingUrl = noorRes?.order?.link ?? noorRes?.order?.tracking_url ?? null
      } else if (courier === 'millennium') {
        const tmRes = await millenniumApi.createOrder({ ...order, pharmacy: order.pharmacy })
        millenniumOrderId = tmRes?.data?.order_id ?? null
      } else if (courier === 'mytaxi') {
        const mytaxiApi = require('../utils/mytaxiApi')
        const offerResult = await mytaxiApi.getOffer(order.pharmacy.lat, order.pharmacy.lng, order.customerLat, order.customerLng)
        const deliveryOffer = offerResult?.offers?.find((o) => o.tariff_id === 'delivery')
        if (!deliveryOffer) {
          return res.status(400).json({ success: false, message: 'MyTaxi: доставка недоступна в этом районе' })
        }
        const mtRes = await mytaxiApi.createOrder({ ...order, pharmacy: order.pharmacy }, offerResult.offer_id)
        mytaxiOrderId = mtRes?.order_id ?? null
      }
    }

    const updated = await prisma.order.update({
      where: { token: req.params.token },
      data: { status: 'confirmed', noorOrderId, noorDisplayId, millenniumOrderId, mytaxiOrderId, trackingUrl, paymentType: orderPaymentType },
    })
    res.json({ success: true, data: updated })
  } catch (err) {
    next(err)
  }
})

// PUT /api/admin/orders/:token/cancel — admin cancels order
router.put('/orders/:token/cancel', requirePermission('orders:cancel'), async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({ where: { token: req.params.token } })
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' })

    if (order.paymentType === 'BALANCE' && order.selectedCourier === 'noor' && order.deliveryPrice) {
      await prisma.pharmacy.update({
        where: { id: order.pharmacyId },
        data: { balance: { increment: order.deliveryPrice } },
      })
    }

    const updated = await prisma.order.update({
      where: { token: req.params.token },
      data: { status: 'cancelled' },
    })
    res.json({ success: true, data: updated })
  } catch (err) {
    next(err)
  }
})

// GET /api/admin/orders/stats
router.get('/orders/stats', requirePermission('orders:view'), async (req, res, next) => {
  try {
    const grouped = await prisma.order.groupBy({
      by: ['status'],
      _count: { status: true },
    })
    const map = {}
    let total = 0
    for (const row of grouped) {
      map[row.status] = row._count.status
      total += row._count.status
    }
    const awaiting = map['awaiting_confirmation'] ?? 0
    const delivering =
      (map['confirmed'] ?? 0) +
      (map['courier_pickup'] ?? 0) +
      (map['courier_picked'] ?? 0) +
      (map['courier_delivery'] ?? 0)
    const delivered = map['delivered'] ?? 0
    res.json({ success: true, data: { total, awaiting, delivering, delivered } })
  } catch (err) {
    next(err)
  }
})

// GET /api/admin/pharmacies
router.get('/pharmacies', requirePermission('pharmacies:view'), async (req, res, next) => {
  try {
    // Auto-deactivate expired subscriptions
    await prisma.pharmacy.updateMany({
      where: {
        isActive: true,
        subscriptionExpiry: { lt: new Date() }
      },
      data: { isActive: false }
    })

    const pharmacyWhere = {}
    const { search, isActive, courier } = req.query

    if (search && search.trim()) {
      const s = search.trim()
      pharmacyWhere.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { phone: { contains: s } },
        { login: { contains: s, mode: 'insensitive' } },
        { ownerName: { contains: s, mode: 'insensitive' } },
        { address: { contains: s, mode: 'insensitive' } },
      ]
    }

    if (isActive === 'true') {
      pharmacyWhere.isActive = true
    } else if (isActive === 'false') {
      pharmacyWhere.isActive = false
    }

    if (courier && courier.trim()) {
      pharmacyWhere.allowedCouriers = { contains: courier.trim() }
    }

    const pharmacies = await prisma.pharmacy.findMany({
      where: pharmacyWhere,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, ownerName: true, address: true, phone: true,
        lat: true, lng: true, login: true,
        isActive: true, subscriptionExpiry: true, allowedCouriers: true, createdAt: true,
        noorPaymentType: true, balance: true,
        owners: { select: { id: true, name: true } },
        _count: { select: { orders: true } }
      }
    })
    res.json({ success: true, data: { pharmacies } })
  } catch (err) {
    next(err)
  }
})

// POST /api/admin/pharmacies
router.post('/pharmacies', requirePermission('pharmacies:create'), async (req, res, next) => {
  try {
    const { name, ownerName, address, phone, login, password, lat, lng, subscriptionExpiry, allowedCouriers } = req.body
    if (!name || !phone || !login || !password) {
      return res.status(400).json({ success: false, message: 'All fields required' })
    }
    const exists = await prisma.pharmacy.findUnique({ where: { login } })
    if (exists) {
      return res.status(409).json({ success: false, message: 'Login already taken' })
    }
    const hashed = await bcrypt.hash(password, 10)
    const pharmacy = await prisma.pharmacy.create({
      data: {
        name,
        ownerName: ownerName || null,
        address: address || null,
        phone: normalizePhone(phone) || phone,
        login,
        password: hashed,
        lat: lat ? Number(lat) : null,
        lng: lng ? Number(lng) : null,
        subscriptionExpiry: subscriptionExpiry ? new Date(subscriptionExpiry) : null,
        allowedCouriers: Array.isArray(allowedCouriers) ? allowedCouriers.join(',') : (allowedCouriers || 'yandex,noor,millennium'),
        selfRegistered: false,
        createdById: req.user?.isSuperAdmin ? null : (req.user?.id ?? null),
      }
    })
    const { password: _, ...safePharmacy } = pharmacy
    res.status(201).json({ success: true, data: safePharmacy })
  } catch (err) {
    next(err)
  }
})

// PUT /api/admin/pharmacies/:id
router.put('/pharmacies/:id', requirePermission('pharmacies:edit'), async (req, res, next) => {
  try {
    const { name, ownerName, address, phone, isActive, subscriptionExpiry, login, password, lat, lng, allowedCouriers, noorPaymentType } = req.body
    const data = {}
    if (name !== undefined) data.name = name
    if (ownerName !== undefined) data.ownerName = ownerName || null
    if (address !== undefined) data.address = address || null
    if (phone !== undefined) data.phone = normalizePhone(phone) || phone
    if (isActive !== undefined) data.isActive = Boolean(isActive)
    if (subscriptionExpiry !== undefined) data.subscriptionExpiry = subscriptionExpiry ? new Date(subscriptionExpiry) : null
    if (lat !== undefined) data.lat = lat ? Number(lat) : null
    if (lng !== undefined) data.lng = lng ? Number(lng) : null
    if (allowedCouriers !== undefined) {
      data.allowedCouriers = Array.isArray(allowedCouriers) ? allowedCouriers.join(',') : (allowedCouriers || 'yandex,noor,millennium')
    }
    if (noorPaymentType !== undefined && ['CASH', 'BALANCE'].includes(noorPaymentType)) {
      data.noorPaymentType = noorPaymentType
    }

    if (login !== undefined && login.trim()) {
      // Check login uniqueness (exclude current pharmacy)
      const exists = await prisma.pharmacy.findFirst({
        where: { login: login.trim(), NOT: { id: req.params.id } }
      })
      if (exists) {
        return res.status(409).json({ success: false, message: 'Login already taken by another pharmacy' })
      }
      data.login = login.trim()
    }

    if (password !== undefined && password.trim()) {
      data.password = await bcrypt.hash(password.trim(), 10)
    }

    const pharmacy = await prisma.pharmacy.update({
      where: { id: req.params.id },
      data,
      select: {
        id: true, name: true, ownerName: true, address: true, phone: true, login: true,
        lat: true, lng: true, isActive: true, subscriptionExpiry: true, createdAt: true
      }
    })
    res.json({ success: true, data: pharmacy })
  } catch (err) {
    next(err)
  }
})

// PUT /api/admin/pharmacies/:id/balance — superadmin sets pharmacy balance
router.put('/pharmacies/:id/balance', async (req, res, next) => {
  try {
    if (!req.user?.isSuperAdmin) {
      return res.status(403).json({ success: false, message: 'Forbidden: super admin only' })
    }
    const { balance } = req.body
    if (balance === undefined || isNaN(Number(balance)) || Number(balance) < 0) {
      return res.status(400).json({ success: false, message: 'balance must be a non-negative number' })
    }
    const pharmacy = await prisma.pharmacy.update({
      where: { id: req.params.id },
      data: { balance: Number(balance) },
      select: { id: true, name: true, balance: true, noorPaymentType: true },
    })
    res.json({ success: true, data: pharmacy })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/admin/pharmacies/:id
router.delete('/pharmacies/:id', requirePermission('pharmacies:delete'), async (req, res, next) => {
  try {
    const id = req.params.id
    await prisma.$transaction([
      prisma.subscriptionPayment.deleteMany({ where: { pharmacyId: id } }),
      prisma.order.deleteMany({ where: { pharmacyId: id } }),
      prisma.pharmacy.delete({ where: { id } }),
    ])
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

// GET /api/admin/clients
router.get('/clients', requirePermission('clients:view'), async (req, res, next) => {
  try {
    const { search, dateFrom, dateTo, pharmacyId, minOrders } = req.query
    const dbWhere = { customerPhone: { not: null } }

    if (pharmacyId) dbWhere.pharmacyId = pharmacyId

    if (search && search.trim()) {
      const s = search.trim()
      dbWhere.OR = [
        { customerName: { contains: s, mode: 'insensitive' } },
        { customerPhone: { contains: s } },
        { customerAddress: { contains: s, mode: 'insensitive' } },
        { pharmacy: { name: { contains: s, mode: 'insensitive' } } },
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
      select: {
        customerName: true,
        customerPhone: true,
        customerAddress: true,
        apartment: true,
        entrance: true,
        floor: true,
        intercom: true,
        createdAt: true,
        pharmacy: { select: { name: true } }
      },
      orderBy: { createdAt: 'desc' }
    })

    const clientsMap = new Map()
    for (const order of orders) {
      const phone = order.customerPhone
      if (!phone) continue
      if (!clientsMap.has(phone)) {
        clientsMap.set(phone, {
          phone,
          name: order.customerName,
          addresses: new Set(),
          pharmacies: new Set(),
          ordersCount: 0,
          lastOrderAt: order.createdAt,
        })
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
        const fullAddress = parts.length
          ? `${order.customerAddress}, ${parts.join(', ')}`
          : order.customerAddress
        client.addresses.add(fullAddress)
      }
      if (order.pharmacy?.name) client.pharmacies.add(order.pharmacy.name)
    }

    let clients = Array.from(clientsMap.values())
      .map(c => ({ ...c, addresses: Array.from(c.addresses), pharmacies: Array.from(c.pharmacies) }))
      .sort((a, b) => b.ordersCount - a.ordersCount)

    if (minOrders) {
      const min = parseInt(minOrders)
      if (!isNaN(min) && min > 0) clients = clients.filter(c => c.ordersCount >= min)
    }

    res.json({ success: true, data: { clients, total: clients.length } })
  } catch (err) {
    next(err)
  }
})

// GET /api/admin/analytics
router.get('/analytics', requirePermission('analytics:view'), async (req, res, next) => {
  try {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const [
      totalOrders,
      activePharmacies,
      aggregates,
      ordersByStatus,
      ordersByCourier,
      recentOrders
    ] = await Promise.all([
      prisma.order.count(),
      prisma.pharmacy.count({ where: { isActive: true } }),
      prisma.order.aggregate({
        _sum: { medicinesTotal: true, deliveryPrice: true, totalPrice: true }
      }),
      prisma.order.groupBy({ by: ['status'], _count: { id: true } }),
      prisma.order.groupBy({
        by: ['selectedCourier'],
        where: { selectedCourier: { not: null } },
        _count: { id: true }
      }),
      prisma.order.findMany({
        where: { createdAt: { gte: thirtyDaysAgo } },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' }
      })
    ])

    // Group recent orders by day
    const ordersByDay = {}
    recentOrders.forEach(o => {
      const day = o.createdAt.toISOString().split('T')[0]
      ordersByDay[day] = (ordersByDay[day] || 0) + 1
    })

    res.json({
      success: true,
      data: {
        totalOrders,
        activePharmacies,
        totalMedicinesAmount: aggregates._sum.medicinesTotal || 0,
        totalDeliveryAmount: aggregates._sum.deliveryPrice || 0,
        totalRevenue: aggregates._sum.totalPrice || 0,
        ordersByStatus: ordersByStatus.map(s => ({ status: s.status, count: s._count.id })),
        ordersByCourier: ordersByCourier.map(c => ({ courier: c.selectedCourier, count: c._count.id })),
        ordersByDay: Object.entries(ordersByDay).map(([date, count]) => ({ date, count }))
      }
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/admin/activations
router.get('/activations', requirePermission('activations:view'), async (req, res, next) => {
  try {
    const { search, creatorType, createdById, status, dateFrom, dateTo } = req.query
    const page     = Math.max(1, parseInt(req.query.page)     || 1)
    const pageSize = Math.min(200, parseInt(req.query.pageSize) || 20)

    // ── Global stats (unfiltered) ──────────────────────────────────────
    const [globalTotal, globalSelf, globalByUserRows] = await Promise.all([
      prisma.pharmacy.count(),
      prisma.pharmacy.count({ where: { selfRegistered: true } }),
      prisma.pharmacy.findMany({
        where: { selfRegistered: false, createdById: { not: null } },
        select: { createdById: true, createdBy: { select: { id: true, name: true, email: true } } },
      }),
    ])

    const superAdminCount = globalTotal - globalSelf - globalByUserRows.length
    const byUserMap = {}
    for (const p of globalByUserRows) {
      if (!byUserMap[p.createdById]) byUserMap[p.createdById] = { user: p.createdBy, count: 0 }
      byUserMap[p.createdById].count++
    }

    // ── Filtered where ─────────────────────────────────────────────────
    const where = {}

    if (search?.trim()) {
      const s = search.trim()
      where.OR = [
        { name:  { contains: s, mode: 'insensitive' } },
        { login: { contains: s, mode: 'insensitive' } },
        { phone: { contains: s } },
      ]
    }

    if (creatorType === 'self')       where.selfRegistered = true
    if (creatorType === 'superadmin') { where.selfRegistered = false; where.createdById = null }
    if (creatorType === 'user') {
      where.selfRegistered = false
      where.createdById = createdById ? createdById : { not: null }
    }

    if (status === 'active')   where.isActive = true
    if (status === 'inactive') where.isActive = false

    if (dateFrom || dateTo) {
      where.createdAt = {}
      if (dateFrom) where.createdAt.gte = new Date(dateFrom)
      if (dateTo) where.createdAt.lte = new Date(dateTo)
    }

    const [filteredTotal, pharmacies] = await Promise.all([
      prisma.pharmacy.count({ where }),
      prisma.pharmacy.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          name: true,
          login: true,
          phone: true,
          isActive: true,
          selfRegistered: true,
          createdAt: true,
          subscriptionExpiry: true,
          createdById: true,
          createdBy: { select: { id: true, name: true, email: true } },
        },
      }),
    ])

    res.json({
      success: true,
      data: {
        total: globalTotal,
        selfRegisteredCount: globalSelf,
        superAdminCount,
        byUser: Object.values(byUserMap),
        pharmacies,
        filteredTotal,
      },
    })
  } catch (err) {
    next(err)
  }
})

// PUT /api/admin/pharmacies/:id/creator
router.put('/pharmacies/:id/creator', requirePermission('pharmacies:edit'), async (req, res, next) => {
  try {
    const { createdById, selfRegistered } = req.body
    const data = {}
    if (selfRegistered !== undefined) data.selfRegistered = Boolean(selfRegistered)
    if (createdById !== undefined) data.createdById = createdById || null
    const pharmacy = await prisma.pharmacy.update({
      where: { id: req.params.id },
      data,
      select: { id: true, name: true, createdById: true, selfRegistered: true, createdBy: { select: { id: true, name: true } } },
    })
    res.json({ success: true, data: pharmacy })
  } catch (err) {
    next(err)
  }
})

module.exports = router
