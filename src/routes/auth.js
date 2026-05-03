const express = require('express')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const prisma = require('../config/db')

const router = express.Router()

// POST /api/auth/pharmacy/login
router.post('/pharmacy/login', async (req, res, next) => {
  try {
    const { login, password } = req.body
    if (!login || !password) {
      return res.status(400).json({ success: false, message: 'Login and password required' })
    }
    const pharmacy = await prisma.pharmacy.findUnique({ where: { login } })
    if (!pharmacy) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' })
    }
    const subscriptionExpired = pharmacy.subscriptionExpiry && pharmacy.subscriptionExpiry < new Date()
    // Block only if manually deactivated by admin (not because of subscription expiry)
    if (!pharmacy.isActive && !subscriptionExpired) {
      return res.status(403).json({ success: false, message: 'Account inactive' })
    }
    const valid = await bcrypt.compare(password, pharmacy.password)
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' })
    }
    const token = jwt.sign(
      { id: pharmacy.id, role: 'pharmacy', name: pharmacy.name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    )
    res.json({
      success: true,
      data: {
        token,
        user: {
          id: pharmacy.id,
          role: 'pharmacy',
          name: pharmacy.name,
          lat: pharmacy.lat,
          lng: pharmacy.lng,
          requiresLocation: pharmacy.requiresLocation,
          subscriptionExpiry: pharmacy.subscriptionExpiry,
        }
      }
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/auth/admin/login
router.post('/admin/login', async (req, res, next) => {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password required' })
    }

    // Check super admin (Admin model) first
    const admin = await prisma.admin.findUnique({ where: { email } })
    if (admin) {
      const valid = await bcrypt.compare(password, admin.password)
      if (!valid) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' })
      }
      const token = jwt.sign(
        { id: admin.id, role: 'admin', isSuperAdmin: true },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
      )
      return res.json({
        success: true,
        data: {
          token,
          user: { id: admin.id, role: 'admin', isSuperAdmin: true, name: admin.email }
        }
      })
    }

    // Check admin user (AdminUser model)
    const adminUser = await prisma.adminUser.findUnique({
      where: { email },
      include: {
        roles: { include: { role: { select: { permissions: true, isActive: true } } } }
      }
    })
    if (!adminUser) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' })
    }
    if (!adminUser.isActive) {
      return res.status(403).json({ success: false, message: 'Account inactive' })
    }
    const valid = await bcrypt.compare(password, adminUser.password)
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' })
    }

    const permissions = [...new Set(
      adminUser.roles
        .filter(ur => ur.role.isActive)
        .flatMap(ur => ur.role.permissions)
    )]
    const token = jwt.sign(
      { id: adminUser.id, role: 'admin', permissions },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    )
    res.json({
      success: true,
      data: {
        token,
        user: { id: adminUser.id, role: 'admin', name: adminUser.name, permissions }
      }
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/auth/owner/login
router.post('/owner/login', async (req, res, next) => {
  try {
    const { login, password } = req.body
    if (!login || !password) {
      return res.status(400).json({ success: false, message: 'Login and password required' })
    }
    const owner = await prisma.owner.findUnique({ where: { login } })
    if (!owner) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' })
    }
    if (!owner.isActive) {
      return res.status(403).json({ success: false, message: 'Account inactive' })
    }
    const valid = await bcrypt.compare(password, owner.password)
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' })
    }
    const token = jwt.sign(
      { id: owner.id, role: 'owner', name: owner.name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    )
    res.json({
      success: true,
      data: {
        token,
        user: {
          id: owner.id,
          role: 'owner',
          name: owner.name,
        }
      }
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/auth/signup — creates pharmacy account with 7-day trial
router.post('/signup', async (req, res, next) => {
  try {
    const { name, ownerName, phone, email, password } = req.body
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email and password are required' })
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' })
    }

    // Use email as login
    const login = email.trim().toLowerCase()
    if (!login.includes('@')) {
      return res.status(400).json({ success: false, message: 'Invalid email address' })
    }

    const exists = await prisma.pharmacy.findUnique({ where: { login } })
    if (exists) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists' })
    }

    // Block reuse of phone number for another free trial
    if (phone && phone.trim()) {
      const cleanPhone = phone.replace(/\D/g, '')
      const phoneExists = await prisma.pharmacy.findFirst({
        where: {
          phone: { in: [phone.trim(), cleanPhone, `+${cleanPhone}`] }
        }
      })
      if (phoneExists) {
        return res.status(409).json({ success: false, message: 'An account with this phone number already exists' })
      }
    }

    const hashed = await bcrypt.hash(password, 10)
    const subscriptionExpiry = new Date()
    subscriptionExpiry.setDate(subscriptionExpiry.getDate() + 7)

    const pharmacy = await prisma.pharmacy.create({
      data: {
        name,
        ownerName: ownerName || null,
        email: login,
        phone: phone || '',
        login,
        password: hashed,
        isActive: true,
        requiresLocation: true,
        subscriptionExpiry,
        selfRegistered: true,
      }
    })

    res.status(201).json({
      success: true,
      data: {
        login,
        message: 'Account created successfully. You have a 7-day free trial.'
      }
    })
  } catch (err) {
    next(err)
  }
})

module.exports = router
