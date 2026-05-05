const express = require('express')
const bcrypt = require('bcryptjs')
const prisma = require('../config/db')
const { auth, requireRole, superAdminOnly } = require('../middleware/auth')

const router = express.Router()

const PHARMACY_SELECT = {
  id: true,
  name: true,
  phone: true,
  login: true,
  isActive: true,
  subscriptionExpiry: true,
  address: true,
  city: true,
  district: true,
}

const OWNER_SELECT = {
  id: true,
  name: true,
  phone: true,
  email: true,
  login: true,
  isActive: true,
  createdAt: true,
}

// GET /api/admin/owners — list all owners with their pharmacies
router.get('/', auth, requireRole('admin'), async (req, res, next) => {
  try {
    const { search } = req.query
    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { login: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}

    const [owners, partners] = await Promise.all([
      prisma.owner.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: { ...OWNER_SELECT, pharmacies: { select: PHARMACY_SELECT } },
      }),
      prisma.partner.findMany({
        where: search
          ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { phone: { contains: search, mode: 'insensitive' } }] }
          : {},
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, name: true, phone: true, type: true, isActive: true, createdAt: true,
          shops: {
            where: { pharmacyId: { not: null } },
            include: { pharmacy: { select: PHARMACY_SELECT } },
          },
        },
      }),
    ])
    // Партнёры отдаём как отдельный список — фронт решает как их показать
    res.json({ success: true, data: { owners, partners, total: owners.length + partners.length } })
  } catch (err) {
    next(err)
  }
})

// POST /api/admin/owners — create owner
router.post('/', auth, requireRole('admin'), async (req, res, next) => {
  try {
    const { name, phone, email, login, password } = req.body
    if (!name || !login || !password) {
      return res.status(400).json({ success: false, message: 'name, login and password are required' })
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' })
    }
    const [ownerExists, pharmacyExists] = await Promise.all([
      prisma.owner.findUnique({ where: { login } }),
      prisma.pharmacy.findUnique({ where: { login } }),
    ])
    if (ownerExists || pharmacyExists) {
      return res.status(409).json({ success: false, message: 'Login already in use' })
    }
    const hashed = await bcrypt.hash(password, 10)
    const owner = await prisma.owner.create({
      data: { name, phone: phone || null, email: email || null, login, password: hashed },
      select: { ...OWNER_SELECT, pharmacies: { select: PHARMACY_SELECT } },
    })
    res.status(201).json({ success: true, data: owner })
  } catch (err) {
    next(err)
  }
})

// PUT /api/admin/owners/:id — update owner
router.put('/:id', auth, requireRole('admin'), async (req, res, next) => {
  try {
    const { name, phone, email, login, newPassword, isActive } = req.body
    const data = {}
    if (name !== undefined && name.trim()) data.name = name.trim()
    if (phone !== undefined) data.phone = phone || null
    if (email !== undefined) data.email = email || null
    if (isActive !== undefined) data.isActive = Boolean(isActive)
    if (login !== undefined && login.trim()) {
      const trimmed = login.trim()
      const [ownerConflict, pharmacyConflict] = await Promise.all([
        prisma.owner.findUnique({ where: { login: trimmed } }),
        prisma.pharmacy.findUnique({ where: { login: trimmed } }),
      ])
      if ((ownerConflict && ownerConflict.id !== req.params.id) || pharmacyConflict) {
        return res.status(409).json({ success: false, message: 'Login already in use' })
      }
      data.login = trimmed
    }
    if (newPassword && newPassword.trim()) {
      if (newPassword.trim().length < 6) {
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' })
      }
      data.password = await bcrypt.hash(newPassword.trim(), 10)
    }
    const owner = await prisma.owner.update({
      where: { id: req.params.id },
      data,
      select: { ...OWNER_SELECT, pharmacies: { select: PHARMACY_SELECT } },
    })
    res.json({ success: true, data: owner })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/admin/owners/:id — delete owner (many-to-many links cascade via Prisma)
router.delete('/:id', auth, superAdminOnly, async (req, res, next) => {
  try {
    await prisma.owner.delete({ where: { id: req.params.id } })
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})

// POST /api/admin/owners/:id/assign/:pharmacyId — assign store to owner
router.post('/:id/assign/:pharmacyId', auth, requireRole('admin'), async (req, res, next) => {
  try {
    const owner = await prisma.owner.findUnique({ where: { id: req.params.id } })
    if (!owner) return res.status(404).json({ success: false, message: 'Owner not found' })

    const pharmacy = await prisma.pharmacy.update({
      where: { id: req.params.pharmacyId },
      data: { owners: { connect: { id: req.params.id } } },
      select: PHARMACY_SELECT,
    })
    res.json({ success: true, data: pharmacy })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/admin/owners/:id/assign/:pharmacyId — remove store from owner
router.delete('/:id/assign/:pharmacyId', auth, requireRole('admin'), async (req, res, next) => {
  try {
    const pharmacy = await prisma.pharmacy.update({
      where: { id: req.params.pharmacyId },
      data: { owners: { disconnect: { id: req.params.id } } },
      select: PHARMACY_SELECT,
    })
    res.json({ success: true, data: pharmacy })
  } catch (err) {
    next(err)
  }
})

module.exports = router
