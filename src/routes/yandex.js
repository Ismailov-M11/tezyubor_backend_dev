const express = require('express')
const prisma = require('../config/db')
const { getClaimInfo, CLAIM_STATUS_MAP } = require('../utils/yandexApi')

const router = express.Router()

// GET /api/yandex/webhook?claim_id=...&updated_ts=...
// Yandex sends GET with params appended directly to the callback_url.
router.get('/webhook', async (req, res) => {
  try {
    const { claim_id } = req.query
    console.log('[Yandex webhook] received claim_id:', claim_id)

    if (!claim_id) {
      return res.status(400).json({ success: false, message: 'claim_id required' })
    }

    const order = await prisma.order.findFirst({ where: { yandexClaimId: claim_id } })
    if (!order) {
      // Unknown claim — still respond 200 so Yandex doesn't retry indefinitely
      console.log('[Yandex webhook] order not found for claim_id:', claim_id)
      return res.json({ success: true })
    }

    // Fetch current status from Yandex
    let claimInfo
    try {
      claimInfo = await getClaimInfo(claim_id)
    } catch (err) {
      console.error('[Yandex webhook] getClaimInfo error:', err.message)
      return res.json({ success: true })
    }

    console.log('[Yandex webhook] claim status:', claimInfo?.status)

    const yandexStatus = claimInfo?.status
    const newStatus = CLAIM_STATUS_MAP[yandexStatus]

    const updateData = {}
    if (newStatus && newStatus !== order.status) {
      updateData.status = newStatus
    }

    // Capture tracking URL when courier is found
    const trackingUrl = claimInfo?.matched_cars?.[0]?.tracking_url
      ?? claimInfo?.matched_cars?.[0]?.link
      ?? null
    if (trackingUrl && !order.trackingUrl) {
      updateData.trackingUrl = trackingUrl
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.order.update({ where: { id: order.id }, data: updateData })
    }

    if (newStatus && newStatus !== order.status) {
      const performer = claimInfo?.matched_cars?.[0]?.performer_info
      await prisma.orderStatusLog.create({
        data: {
          orderId:   order.id,
          status:    newStatus,
          source:    'yandex',
          rawStatus: yandexStatus,
          actorName: performer
            ? [performer.last_name, performer.first_name].filter(Boolean).join(' ')
            : null,
          actorPhone: performer?.phone ?? null,
        },
      })
    }

    res.json({ success: true })
  } catch (err) {
    console.error('[Yandex webhook] error:', err)
    // Always return 200 so Yandex doesn't keep retrying on our internal errors
    res.json({ success: true })
  }
})

module.exports = router
