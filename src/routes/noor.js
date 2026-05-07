const express = require('express')
const prisma = require('../config/db')
const noorApi = require('../utils/noorApi')

const router = express.Router()

const WEBHOOK_TOKEN = process.env.NOOR_WEBHOOK_TOKEN

// Noor stage → our OrderStatus mapping (verified from real webhooks)
// 1  = eval OK (no action)
// 2  = searching courier
// 3  = no courier found → triggers reorder
// 4  = courier accepted
// 5  = courier heading to pharmacy
// 6  = courier at pharmacy
// 7  = courier heading to pharmacy (confirmed from real webhook)
// 8  = courier picked up / heading to customer
// 9  = courier at customer
// 10 = delivered
// 22 = cancelled
// 23 = no funds (eval)
// 27 = no couriers (eval)
// 28 = out of zone (eval)
const STAGE_STATUS = {
  4: 'courier_pickup',
  5: 'courier_pickup',
  6: 'courier_pickup',
  7: 'courier_pickup',
  8: 'courier_picked',
  9: 'courier_delivery',
  10: 'delivered',
  22: 'cancelled',
}

// POST /api/noor/webhook — called by Noor on status changes
router.post('/webhook', async (req, res) => {
  try {
    console.log('[Noor webhook] headers:', JSON.stringify(req.headers))
    console.log('[Noor webhook] body:', JSON.stringify(req.body))

    const authHeader = req.headers['authorization']
    if (!authHeader || authHeader !== WEBHOOK_TOKEN) {
      console.log('[Noor webhook] Unauthorized — received token:', authHeader)
      return res.status(401).json({ success: false, message: 'Unauthorized' })
    }

    const { vendor_order_id, stage, order: noorOrder } = req.body

    if (!vendor_order_id) {
      return res.status(400).json({ success: false, message: 'vendor_order_id required' })
    }

    const order = await prisma.order.findUnique({
      where: { id: vendor_order_id },
    })
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' })
    }

    const updateData = {}

    // Map stage → our status
    const newStatus = STAGE_STATUS[stage]
    if (newStatus) {
      updateData.status = newStatus
    }

    // Save internal noorOrderId (used for API calls: reorder, cancel)
    if (noorOrder?.id && !order.noorOrderId) {
      updateData.noorOrderId = noorOrder.id
    }

    // Save display_id — the human-readable order number shown in Noor's interface
    if (noorOrder?.display_id) {
      updateData.noorDisplayId = noorOrder.display_id
    }

    // Save tracking link (field is "link" in Noor's response)
    if (noorOrder?.link) {
      updateData.trackingUrl = noorOrder.link
    }

    // Save delivery price from pricing
    if (noorOrder?.pricing?.total && noorOrder.pricing.total > 0) {
      updateData.deliveryPrice = noorOrder.pricing.total
      updateData.totalPrice = order.medicinesTotal + noorOrder.pricing.total
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.order.update({ where: { id: vendor_order_id }, data: updateData })
    }

    // Refund balance if order was paid via BALANCE and is now cancelled
    if (newStatus === 'cancelled' && order.paymentType === 'BALANCE' && order.deliveryPrice) {
      await prisma.pharmacy.update({
        where: { id: order.pharmacyId },
        data: { balance: { increment: order.deliveryPrice } },
      })
    }

    if (newStatus) {
      const courier = noorOrder?.courier
      const actorName = courier
        ? [courier.last_name, courier.first_name, courier.middle_name].filter(Boolean).join(' ')
        : null
      const actorPhone = courier?.phone || null
      await prisma.orderStatusLog.create({
        data: { orderId: order.id, status: newStatus, source: 'noor', actor: 'noor', rawStatus: String(stage), actorName, actorPhone },
      })
    }

    // Retry finding a courier when Noor couldn't find one
    if (stage === 3 && order.noorOrderId) {
      try {
        await noorApi.reorder(order.noorOrderId)
      } catch (err) {
        console.error('Noor reorder error:', err.message)
      }
    }

    res.json({ success: true })
  } catch (err) {
    console.error('Noor webhook error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

module.exports = router
