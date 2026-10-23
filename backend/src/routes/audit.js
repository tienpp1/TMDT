const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireSiteManager } = require('../middleware/auth');

function safeAudit(value){
  if(!value)return value;
  try{
    return JSON.stringify(JSON.parse(value),(key,entry)=>/^(key|key_hash|password|password_hash|secret|session|session_id|token)$/i.test(key)?'[ĐÃ ẨN]':entry);
  }catch{return JSON.stringify({legacy_record:'Nhật ký cũ không có JSON hợp lệ'});}
}

router.get('/site/:siteId', requireAuth, requireSiteManager, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT a.*, u.display_name as actor_name
      FROM audit_logs a
      LEFT JOIN users u ON a.actor_user_id = u.id
      WHERE a.site_id = $1
      ORDER BY a.created_at DESC
      LIMIT 100
    `, [req.params.siteId]);
    res.json({ data: result.rows.map(row=>({...row,old_values:safeAudit(row.old_values),new_values:safeAudit(row.new_values)})) });
  } catch (error) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Lỗi máy chủ' } });
  }
});

module.exports = router;
