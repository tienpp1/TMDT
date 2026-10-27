const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireSiteMember } = require('../middleware/auth');
const { readingCSV } = require('../lib/reading-report');

// Get KPI: Average resolution time for incidents
router.get('/site/:siteId/kpi', requireAuth, requireSiteMember, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT AVG(
        (julianday(completed_at) - julianday(created_at)) * 24 * 60
      ) as avg_resolution_minutes
      FROM incidents
      WHERE site_id = $1 AND status = 'completed'
    `, [req.params.siteId]);
    
    res.json({ data: { avg_resolution_minutes: result.rows[0].avg_resolution_minutes || 0 } });
  } catch (error) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Lỗi máy chủ' } });
  }
});

// Export CSV for device history
router.get('/site/:siteId/device/:id/csv', requireAuth, requireSiteMember, async (req, res, next) => {
  let client;
  try {
    const exportedAt = new Date().toISOString();
    const parseBound = value => value === undefined ? null : typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
    const from = parseBound(req.query.from), suppliedTo = parseBound(req.query.to);
    const to = suppliedTo === null ? Date.parse(exportedAt) : suppliedTo;
    if ((from !== null && !Number.isFinite(from)) || !Number.isFinite(to) || (from !== null && from > to)) {
      return res.status(400).json({error:{code:'BAD_REQUEST',message:'Khoảng thời gian không hợp lệ'}});
    }
    client = await db.pool.connect();
    await client.query('BEGIN');
    // Archived bays still have historical records available to their members.
    const device = (await client.query(`SELECT d.id,d.name,d.point_label,d.deleted_at,r.warning_cm,r.critical_cm,r.version
      FROM devices d LEFT JOIN alert_rules r ON r.device_id=d.id WHERE d.id=$1 AND d.site_id=$2`, [req.params.id, req.params.siteId])).rows[0];
    if (!device) {
      await client.query('COMMIT');
      return res.status(404).json({error:{code:'NOT_FOUND',message:'Thiết bị không thuộc cơ sở'}});
    }
    const result = await client.query(`
      SELECT measured_at,received_at,level_cm,quality,history_only,warning_cm_snapshot,critical_cm_snapshot,rule_version_snapshot
      FROM readings
      WHERE device_id=$1
        AND ($2 IS NULL OR julianday(measured_at)>=julianday($2))
        AND julianday(measured_at)<=julianday($3)
        AND julianday(received_at)<=julianday($4)
      ORDER BY julianday(measured_at) ASC,rowid ASC
    `, [req.params.id, from === null ? null : new Date(from).toISOString(), new Date(to).toISOString(), exportedAt]);
    await client.query('COMMIT');
    client.release(); client = null;
    res.header('Content-Type', 'text/csv; charset=utf-8');
    res.header('X-Exported-At', exportedAt);
    res.header('X-Reading-Count', String(result.rows.length));
    res.header('X-Report-Timezone', 'UTC+07:00');
    res.attachment(`bao_cao_bai_${req.params.id.replace(/[^a-zA-Z0-9_-]/g, '')}.csv`);
    return res.send(readingCSV(device, result.rows));
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client?.release();
  }
});

module.exports = router;
