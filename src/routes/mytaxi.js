const express = require('express')
const prisma = require('../config/db')

const router = express.Router()

// MyTaxi status → our OrderStatus
const STATUS_MAP = {
  driver_searching: 'courier_pickup',
  driver_arriving:  'courier_pickup',
  driver_arrived:   'courier_pickup',
  in_progress:      'courier_picked',
  finished:         'delivered',
  canceled:         'cancelled',
  driver_not_found: 'cancelled',
}

// PUT /api/mytaxi/webhook — called by MyTaxi on status changes
router.put('/webhook', async (req, res) => {
  try {
    console.log('[MyTaxi webhook] body:', JSON.stringify(req.body))

    const { id, status } = req.body
    if (!id) {
      return res.status(400).json({ success: false, message: 'id required' })
    }

    const order = await prisma.order.findFirst({
      where: { mytaxiOrderId: Number(id) },
    })
    if (!order) {
      return res.status(404).json({ success: false, message: `Order not found for mytaxiOrderId ${id}` })
    }

    const newStatus = STATUS_MAP[status]
    if (!newStatus) {
      return res.json({ success: true })
    }

    await prisma.order.update({
      where: { id: order.id },
      data: { status: newStatus },
    })

    await prisma.orderStatusLog.create({
      data: {
        orderId:   order.id,
        status:    newStatus,
        source:    'mytaxi',
        rawStatus: status,
      },
    })

    res.json({ success: true })
  } catch (err) {
    console.error('MyTaxi webhook error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

module.exports = router
