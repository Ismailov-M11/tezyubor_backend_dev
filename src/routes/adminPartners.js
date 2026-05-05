const express = require('express')
const crypto = require('crypto')
const prisma = require('../config/db')
const { auth, requireRole, superAdminOnly } = require('../middleware/auth')

const router = express.Router()
router.use(auth)
router.use(requireRole('admin'))

function generateApiToken() {
  return 'sk_' + crypto.randomBytes(32).toString('hex')
}

// GET /api/admin/partners
router.get('/', async (req, res, next) => {
  try {
    const { type, search, isActive } = req.query
    const where = {}
    if (type) where.type = type
    if (isActive === 'true') where.isActive = true
    if (isActive === 'false') where.isActive = false
    if (search?.trim()) {
      where.OR = [
        { name: { contains: search.trim(), mode: 'insensitive' } },
        { phone: { contains: search.trim() } },
      ]
    }
    const partners = await prisma.partner.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        courierMarkups: true,
        _count: { select: { shops: true, orders: true } },
      },
    })
    res.json({ success: true, data: { partners } })
  } catch (err) { next(err) }
})

// GET /api/admin/partners/:id
router.get('/:id', async (req, res, next) => {
  try {
    const partner = await prisma.partner.findUnique({
      where: { id: req.params.id },
      include: {
        courierMarkups: true,
        shops: {
          orderBy: { createdAt: 'desc' },
          include: { pharmacy: { select: { id: true, name: true, login: true, phone: true, address: true, city: true, district: true, isActive: true } } },
        },
        _count: { select: { orders: true } },
      },
    })
    if (!partner) return res.status(404).json({ success: false, message: 'Partner not found' })
    res.json({ success: true, data: partner })
  } catch (err) { next(err) }
})

// POST /api/admin/partners
router.post('/', async (req, res, next) => {
  try {
    const { name, type, phone, address, lat, lng } = req.body
    if (!name || !type) {
      return res.status(400).json({ success: false, message: 'name and type required' })
    }
    if (!['MARKETPLACE', 'POST_SYSTEM'].includes(type)) {
      return res.status(400).json({ success: false, message: 'type must be MARKETPLACE or POST_SYSTEM' })
    }
    const apiToken = generateApiToken()
    const partner = await prisma.partner.create({
      data: {
        name,
        type,
        apiToken,
        phone: phone || null,
        address: address || null,
        lat: lat ? Number(lat) : null,
        lng: lng ? Number(lng) : null,
        courierMarkups: {
          create: [
            { courierType: 'noor',       markupPercent: 0, isEnabled: true },
            { courierType: 'millennium', markupPercent: 0, isEnabled: true },
            { courierType: 'mytaxi',     markupPercent: 0, isEnabled: true },
            { courierType: 'yandex',     markupPercent: 0, isEnabled: false },
          ],
        },
      },
      include: { courierMarkups: true },
    })
    res.status(201).json({ success: true, data: partner })
  } catch (err) { next(err) }
})

// PUT /api/admin/partners/:id
router.put('/:id', async (req, res, next) => {
  try {
    const { name, phone, address, lat, lng, isActive } = req.body
    const data = {}
    if (name !== undefined) data.name = name
    if (phone !== undefined) data.phone = phone || null
    if (address !== undefined) data.address = address || null
    if (lat !== undefined) data.lat = lat ? Number(lat) : null
    if (lng !== undefined) data.lng = lng ? Number(lng) : null
    if (isActive !== undefined) data.isActive = Boolean(isActive)
    const partner = await prisma.partner.update({
      where: { id: req.params.id },
      data,
      include: { courierMarkups: true },
    })
    res.json({ success: true, data: partner })
  } catch (err) { next(err) }
})

// POST /api/admin/partners/:id/regenerate-token
router.post('/:id/regenerate-token', superAdminOnly, async (req, res, next) => {
  try {
    const apiToken = generateApiToken()
    const partner = await prisma.partner.update({
      where: { id: req.params.id },
      data: { apiToken },
      select: { id: true, name: true, apiToken: true },
    })
    res.json({ success: true, data: partner })
  } catch (err) { next(err) }
})

// PUT /api/admin/partners/:id/courier-markups
router.put('/:id/courier-markups', async (req, res, next) => {
  try {
    const { markups } = req.body
    if (!Array.isArray(markups)) {
      return res.status(400).json({ success: false, message: 'markups array required' })
    }
    const updates = await Promise.all(
      markups.map(m =>
        prisma.partnerCourierMarkup.upsert({
          where: { partnerId_courierType: { partnerId: req.params.id, courierType: m.courierType } },
          create: { partnerId: req.params.id, courierType: m.courierType, markupPercent: Number(m.markupPercent) || 0, isEnabled: Boolean(m.isEnabled) },
          update: { markupPercent: Number(m.markupPercent) || 0, isEnabled: Boolean(m.isEnabled) },
        })
      )
    )
    res.json({ success: true, data: { markups: updates } })
  } catch (err) { next(err) }
})

// PUT /api/admin/partners/:id/balance
router.put('/:id/balance', superAdminOnly, async (req, res, next) => {
  try {
    const { balance, operation } = req.body
    const value = Number(balance)
    if (isNaN(value) || value < 0) {
      return res.status(400).json({ success: false, message: 'balance must be non-negative number' })
    }
    const data = {}
    if (operation === 'increment') data.balance = { increment: value }
    else if (operation === 'decrement') data.balance = { decrement: value }
    else data.balance = value
    const partner = await prisma.partner.update({
      where: { id: req.params.id },
      data,
      select: { id: true, name: true, balance: true },
    })
    res.json({ success: true, data: partner })
  } catch (err) { next(err) }
})

// DELETE /api/admin/partners/:id
router.delete('/:id', superAdminOnly, async (req, res, next) => {
  try {
    await prisma.partner.delete({ where: { id: req.params.id } })
    res.json({ success: true })
  } catch (err) { next(err) }
})

// GET /api/admin/partners/:id/shops
router.get('/:id/shops', async (req, res, next) => {
  try {
    const shops = await prisma.partnerShop.findMany({
      where: { partnerId: req.params.id },
      orderBy: { createdAt: 'desc' },
      include: { pharmacy: { select: { id: true, name: true, login: true, phone: true, address: true, city: true, district: true, isActive: true } } },
    })
    res.json({ success: true, data: { shops } })
  } catch (err) { next(err) }
})

// POST /api/admin/partners/:id/shops
router.post('/:id/shops', async (req, res, next) => {
  try {
    const { name, phone, address, lat, lng, externalShopId } = req.body
    if (!name) return res.status(400).json({ success: false, message: 'name required' })
    const shop = await prisma.partnerShop.create({
      data: {
        partnerId: req.params.id,
        name,
        phone: phone || null,
        address: address || null,
        lat: lat ? Number(lat) : null,
        lng: lng ? Number(lng) : null,
        externalShopId: externalShopId || null,
      },
    })
    res.status(201).json({ success: true, data: shop })
  } catch (err) { next(err) }
})

// PUT /api/admin/partners/:id/shops/:shopId
router.put('/:id/shops/:shopId', async (req, res, next) => {
  try {
    const { name, phone, address, lat, lng, isActive, externalShopId } = req.body
    const data = {}
    if (name !== undefined) data.name = name
    if (phone !== undefined) data.phone = phone || null
    if (address !== undefined) data.address = address || null
    if (lat !== undefined) data.lat = lat ? Number(lat) : null
    if (lng !== undefined) data.lng = lng ? Number(lng) : null
    if (isActive !== undefined) data.isActive = Boolean(isActive)
    if (externalShopId !== undefined) data.externalShopId = externalShopId || null
    const shop = await prisma.partnerShop.update({
      where: { id: req.params.shopId },
      data,
      include: { pharmacy: { select: { id: true, name: true, login: true, phone: true, address: true, city: true, district: true, isActive: true } } },
    })
    res.json({ success: true, data: shop })
  } catch (err) { next(err) }
})

// PUT /api/admin/partners/:id/shops/:shopId/balance
router.put('/:id/shops/:shopId/balance', superAdminOnly, async (req, res, next) => {
  try {
    const { balance, operation } = req.body
    const value = Number(balance)
    if (isNaN(value) || value < 0) {
      return res.status(400).json({ success: false, message: 'balance must be non-negative number' })
    }
    const data = {}
    if (operation === 'increment') data.balance = { increment: value }
    else if (operation === 'decrement') data.balance = { decrement: value }
    else data.balance = value
    const shop = await prisma.partnerShop.update({
      where: { id: req.params.shopId },
      data,
      select: { id: true, name: true, balance: true },
    })
    res.json({ success: true, data: shop })
  } catch (err) { next(err) }
})

// DELETE /api/admin/partners/:id/shops/:shopId
router.delete('/:id/shops/:shopId', superAdminOnly, async (req, res, next) => {
  try {
    await prisma.partnerShop.delete({ where: { id: req.params.shopId } })
    res.json({ success: true })
  } catch (err) { next(err) }
})

// GET /api/admin/partners/:id/available-pharmacies — аптеки, не привязанные ни к одному партнёру
router.get('/:id/available-pharmacies', async (req, res, next) => {
  try {
    const { search } = req.query
    const where = {
      partnerShop: null,
      isActive: true,
    }
    if (search?.trim()) {
      where.OR = [
        { name: { contains: search.trim(), mode: 'insensitive' } },
        { login: { contains: search.trim(), mode: 'insensitive' } },
      ]
    }
    const pharmacies = await prisma.pharmacy.findMany({
      where,
      select: { id: true, name: true, login: true, phone: true, address: true, city: true, district: true, lat: true, lng: true, isActive: true },
      orderBy: { name: 'asc' },
      take: 100,
    })
    res.json({ success: true, data: { pharmacies } })
  } catch (err) { next(err) }
})

// POST /api/admin/partners/:id/assign/:pharmacyId — привязать аптеку к партнёру
router.post('/:id/assign/:pharmacyId', async (req, res, next) => {
  try {
    const partner = await prisma.partner.findUnique({ where: { id: req.params.id } })
    if (!partner) return res.status(404).json({ success: false, message: 'Partner not found' })

    const pharmacy = await prisma.pharmacy.findUnique({ where: { id: req.params.pharmacyId } })
    if (!pharmacy) return res.status(404).json({ success: false, message: 'Pharmacy not found' })

    const existing = await prisma.partnerShop.findUnique({ where: { pharmacyId: req.params.pharmacyId } })
    if (existing) return res.status(409).json({ success: false, message: 'Pharmacy already assigned to a partner' })

    const externalShopId = crypto.randomBytes(6).toString('hex')
    const shop = await prisma.partnerShop.create({
      data: {
        partnerId: req.params.id,
        pharmacyId: req.params.pharmacyId,
        name: pharmacy.name,
        phone: pharmacy.phone || null,
        address: pharmacy.address || null,
        lat: pharmacy.lat || null,
        lng: pharmacy.lng || null,
        externalShopId,
      },
      include: { pharmacy: { select: { id: true, name: true, login: true, phone: true, address: true, city: true, district: true, isActive: true } } },
    })
    res.status(201).json({ success: true, data: shop })
  } catch (err) { next(err) }
})

// DELETE /api/admin/partners/:id/assign/:pharmacyId — отвязать аптеку от партнёра
router.delete('/:id/assign/:pharmacyId', async (req, res, next) => {
  try {
    const shop = await prisma.partnerShop.findUnique({ where: { pharmacyId: req.params.pharmacyId } })
    if (!shop || shop.partnerId !== req.params.id) {
      return res.status(404).json({ success: false, message: 'Assignment not found' })
    }
    await prisma.partnerShop.delete({ where: { id: shop.id } })
    res.json({ success: true })
  } catch (err) { next(err) }
})

module.exports = router
