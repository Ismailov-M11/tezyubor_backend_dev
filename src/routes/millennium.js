const express = require('express')
const prisma = require('../config/db')

const router = express.Router()

// Map Millennium state_id → our OrderStatus
// Based on TaxiMaster state list from Millennium
const STATE_MAP = {
  7:  'courier_pickup',    // Принял / Водитель принял заказ
  10: 'courier_pickup',    // На месте (водитель у аптеки)
  13: 'courier_pickup',    // Заказ отправлен водителю
  14: 'courier_picked',    // Заказ получен водителем
  11: 'courier_picked',    // В машине
  4:  'delivered',         // Выполнен
  17: 'delivered',         // Завершение (финальный)
  26: 'delivered',         // Заказ выполнен (ЦОЗ)
}

// POST /api/millennium/webhook — called by Millennium on status changes
router.post('/webhook', async (req, res) => {
  try {
    console.log('[Millennium webhook] headers:', JSON.stringify(req.headers))
    console.log('[Millennium webhook] body:', JSON.stringify(req.body))

    const {
      order_id,
      state_id,
      state_kind,
      driver_name,
      driver_phone,
      total_sum,
      crew_coords,
    } = req.body

    if (!order_id) {
      return res.status(400).json({ success: false, message: 'order_id required' })
    }

    const order = await prisma.order.findFirst({
      where: { millenniumOrderId: Number(order_id) },
    })

    if (!order) {
      return res.status(404).json({ success: false, message: `Order not found for millenniumOrderId ${order_id}` })
    }

    const updateData = {}

    // Map to our status
    const newStatus = STATE_MAP[state_id]
    if (newStatus) {
      updateData.status = newStatus
    } else if (state_kind === 'finished') {
      updateData.status = 'delivered'
    }

    // Save delivery price if provided
    if (total_sum && total_sum > 0) {
      updateData.deliveryPrice = Number(total_sum)
      updateData.totalPrice = order.medicinesTotal + Number(total_sum)
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.order.update({
        where: { id: order.id },
        data: updateData,
      })
    }

    if (updateData.status) {
      await prisma.orderStatusLog.create({
        data: {
          orderId:   order.id,
          status:    updateData.status,
          source:    'millennium',
          rawStatus: state_id != null ? String(state_id) : state_kind,
        },
      })
    }

    res.json({ success: true })
  } catch (err) {
    console.error('Millennium webhook error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

module.exports = router
