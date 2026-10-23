const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireSiteMember } = require('../middleware/auth');

// Helper to check alert membership
const checkAlertMembership = async (req, res, next) => {
  const alertId = req.params.id;
  try {
    const alertRes = await db.query(`
      SELECT d.site_id, a.ack_by 
      FROM alerts a 
      JOIN devices d ON a.device_id = d.id 
      WHERE a.id = $1
    `, [alertId]);
    
    if (alertRes.rows.length === 0) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy cảnh báo' } });
    
    req.params.siteId = alertRes.rows[0].site_id;
    req.alertInfo = alertRes.rows[0];
    next();
  } catch (error) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Lỗi máy chủ' } });
  }
};

router.post('/:id/ack', requireAuth, checkAlertMembership, requireSiteMember, async (req, res) => {
  const alertId = req.params.id;
  
  // If already acked, return success without changing
  if (req.alertInfo.ack_by) {
    return res.json({ data: { success: true, message: 'Đã xác nhận trước đó' } });
  }

  try {
    const client=await db.pool.connect();
    try {
    await client.query('BEGIN');
    const updated=await client.query(`
      UPDATE alerts 
      SET ack_by = $1, ack_at = CURRENT_TIMESTAMP 
      WHERE id = $2 AND ack_by IS NULL
    `, [req.session.userId, alertId]);
    
    // Log audit
    if(updated.rowCount)await client.query(`
      INSERT INTO audit_logs (site_id, actor_user_id, action, entity_type, entity_id, new_values)
      VALUES ($1, $2, 'ACK_ALERT', 'alerts', $3, $4)
    `, [req.params.siteId, req.session.userId, alertId, JSON.stringify({ acked: true })]);
    await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
    finally{client.release();}

    res.json({ data: { success: true } });
  } catch (error) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Lỗi máy chủ' } });
  }
});

// Get alerts for site
router.get('/site/:siteId', requireAuth, requireSiteMember, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT a.id, a.episode_id, a.level, a.opened_at, a.ack_at, a.resolved_at, u.display_name AS ack_by_name, d.name as device_name, d.id as device_id,
        CASE WHEN d.is_active=1 AND d.latest_quality='ok' AND d.latest_level_cm IS NOT NULL AND d.latest_level_cm>=r.critical_cm AND a.level='critical' AND a.episode_id=d.active_episode_id AND a.resolved_at IS NULL THEN 1 ELSE 0 END AS is_current
      FROM alerts a
      JOIN devices d ON a.device_id = d.id
      LEFT JOIN alert_rules r ON r.device_id=d.id
      LEFT JOIN users u ON u.id=a.ack_by
      WHERE d.site_id = $1
      ORDER BY is_current DESC,a.opened_at DESC
      LIMIT 100
    `, [req.params.siteId]);
    res.json({ data: result.rows.map(alert => ({ ...alert, is_current: Boolean(alert.is_current) })) });
  } catch (error) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Lỗi máy chủ' } });
  }
});

module.exports = router;
