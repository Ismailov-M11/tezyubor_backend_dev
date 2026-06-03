require('dotenv').config()
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const morgan = require('morgan')
const swaggerUi = require('swagger-ui-express')
const swaggerSpec = require('./src/swagger')
const prisma = require('./src/config/db')
const { deactivateExpiredPharmacies } = require('./src/utils/subscriptionCheck')
const { seedAdmin } = require('./src/utils/seedAdmin')

const authRoutes = require('./src/routes/auth')
const pharmacyRoutes = require('./src/routes/pharmacy')
const ordersRoutes = require('./src/routes/orders')
const adminRoutes = require('./src/routes/admin')
const rolesRoutes = require('./src/routes/roles')
const adminUsersRoutes = require('./src/routes/adminUsers')
const ownersRoutes = require('./src/routes/owners')
const ownerAppRoutes = require('./src/routes/ownerApp')
const adminPartnersRoutes = require('./src/routes/adminPartners')
const noorRoutes = require('./src/routes/noor')
const millenniumRoutes = require('./src/routes/millennium')
const mytaxiRoutes = require('./src/routes/mytaxi')
const yandexRoutes = require('./src/routes/yandex')
const webhooksRoutes = require('./src/routes/webhooks')

const app = express()

const ALLOWED_ORIGINS = [
  process.env.CLIENT_URL,
  'https://tezyubor.uz',
  'https://www.tezyubor.uz',
  'https://app.tezyubor.uz',
  'https://admin.tezyubor.uz',
  'https://api.tezyubor.uz',
  'https://dev.tezyubor.uz',
  'https://dev-app.tezyubor.uz',
  'https://dev-admin.tezyubor.uz',
  'https://dev-api.tezyubor.uz',
  'http://localhost:5173',
  'https://tezyubor.netlify.app',
  'https://admin-tezyubor.netlify.app',
  'https://app-tezyubor.netlify.app',
  'https://tezyubor-web.netlify.app',
].filter(Boolean)

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true)
    callback(new Error(`CORS: origin ${origin} not allowed`))
  },
  credentials: true,
}

app.use(helmet({ crossOriginResourcePolicy: false, contentSecurityPolicy: false }))
app.use(morgan('combined'))
app.use(express.json())

// Courier webhooks are server-to-server — mount before CORS so the
// Origin header from delivery services doesn't get rejected.
app.use('/api/noor', noorRoutes)
app.use('/api/millennium', millenniumRoutes)
app.use('/api/mytaxi', mytaxiRoutes)
app.use('/api/yandex', yandexRoutes)
app.use('/api/webhooks', webhooksRoutes)

// CORS for browser clients
app.use(cors(corsOptions))
app.options('*', cors(corsOptions))

// Browser-facing routes
app.use('/api/auth', authRoutes)
app.use('/api/pharmacy', pharmacyRoutes)
app.use('/api/orders', ordersRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/admin/roles', rolesRoutes)
app.use('/api/admin/users', adminUsersRoutes)
app.use('/api/admin/owners', ownersRoutes)
app.use('/api/admin/partners', adminPartnersRoutes)
app.use('/api/owner', ownerAppRoutes)

app.get('/health', (req, res) => res.json({ status: 'ok' }))
app.get('/backend-api/openapi.json', (req, res) => res.json(swaggerSpec))
app.use('/backend-api', swaggerUi.serve, swaggerUi.setup(null, {
  customSiteTitle: 'Tezyubor Backend API',
  swaggerOptions: { url: '/backend-api/openapi.json' },
}))

// Error handler
app.use((err, req, res, _next) => {
  console.error(err)
  const origin = req.headers.origin
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  }
  res.status(500).json({ success: false, message: err.message || 'Server error' })
})

async function start() {
  try {
    // Verify DB connection
    await prisma.$connect()
    console.log('PostgreSQL connected')

    // Seed default admin if needed
    await seedAdmin()

    // Deactivate expired subscriptions
    await deactivateExpiredPharmacies()

    // Auto-cancel awaiting_confirmation orders older than 3 hours
    async function cancelStaleOrders() {
      const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000)
      const result = await prisma.order.updateMany({
        where: { status: 'awaiting_confirmation', updatedAt: { lt: cutoff } },
        data: { status: 'cancelled' },
      })
      if (result.count > 0) console.log(`[auto-cancel] Cancelled ${result.count} stale order(s)`)
    }
    await cancelStaleOrders()
    setInterval(cancelStaleOrders, 10 * 60 * 1000)

    const PORT = process.env.PORT || 5000
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`))
  } catch (err) {
    console.error('Startup error:', err)
    process.exit(1)
  }
}

start()
