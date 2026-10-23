const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireSiteMember } = require('../middleware/auth');

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
router.get('/site/:siteId/device/:id/csv', requireAuth, requireSiteMember, async (req, res) => {
  try {
    const device=await db.query('SELECT id FROM devices WHERE id=$1 AND site_id=$2',[req.params.id,req.params.siteId]);
    if(!device.rows.length)return res.status(404).json({error:{code:'NOT_FOUND',message:'Thiết bị không thuộc cơ sở'}});
    const from=req.query.from ? Date.parse(req.query.from):null;
    const to=req.query.to ? Date.parse(req.query.to):null;
    if((req.query.from&&!Number.isFinite(from))||(req.query.to&&!Number.isFinite(to))||(from!==null&&to!==null&&from>to)){
      return res.status(400).json({error:{code:'BAD_REQUEST',message:'Khoảng thời gian không hợp lệ'}});
    }
    const result = await db.query(`
      SELECT measured_at, level_cm, quality
      FROM readings
      WHERE device_id = $1
        AND ($2 IS NULL OR julianday(measured_at)>=julianday($2))
        AND ($3 IS NULL OR julianday(measured_at)<=julianday($3))
      ORDER BY measured_at DESC
      LIMIT 1000
    `, [req.params.id,from===null?null:new Date(from).toISOString(),to===null?null:new Date(to).toISOString()]);
    
    let csv = 'Time,Level(cm),Quality\n';
    result.rows.forEach(r => {
      csv += [r.measured_at,r.level_cm,r.quality].map(value=>'"'+String(value??'').replace(/"/g,'""')+'"').join(',')+'\n';
    });
    
    res.header('Content-Type', 'text/csv; charset=utf-8');
    res.attachment(`device_${req.params.id.replace(/[^a-zA-Z0-9_-]/g,'')}_history.csv`);
    return res.send(csv);
  } catch (error) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Lỗi máy chủ' } });
  }
});

module.exports = router;
