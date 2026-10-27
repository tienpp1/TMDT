const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireSiteMember, requireSiteManager } = require('../middleware/auth');

// Get incidents for a site
router.get('/site/:siteId', requireAuth, requireSiteMember, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT i.*, 
             u.display_name as assignee_name,
             rep.display_name as reporter_name,
             d.name as device_name,
             d.point_label as device_point_label
      FROM incidents i
      LEFT JOIN users u ON i.assignee_id = u.id
      LEFT JOIN users rep ON i.reported_by = rep.id
      LEFT JOIN devices d ON i.device_id = d.id
      WHERE i.site_id = $1
      ORDER BY i.created_at DESC
      LIMIT 100
    `, [req.params.siteId]);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching incidents:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Lỗi máy chủ' } });
  }
});

// Staff or Manager report a new incident
router.post('/site/:siteId/report', requireAuth, requireSiteMember, async (req, res) => {
  const { device_id, title, note, reported_at } = req.body;
  if (typeof title!=='string'||!title.trim()||title.length>200||(note!==undefined&&(typeof note!=='string'||note.length>4000))||(reported_at!==undefined&&(!Number.isFinite(Date.parse(reported_at))||Date.parse(reported_at)>Date.now()+60000))) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Vui lòng nhập tiêu đề sự cố' } });
  }

  const { randomUUID: uuidv4 } = require('crypto');
  const incidentId = uuidv4();
  const episodeId = uuidv4();
  const createdAt = reported_at || new Date().toISOString();

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    if(device_id){
      const target=await client.query('SELECT id FROM devices WHERE id=$1 AND site_id=$2 AND deleted_at IS NULL',[device_id,req.params.siteId]);
      if(!target.rows.length){await client.query('ROLLBACK');return res.status(404).json({error:{code:'NOT_FOUND',message:'Điểm đo không thuộc cơ sở'}});}
    }

    // Get current user display name
    const userRes = await client.query('SELECT display_name FROM users WHERE id = $1', [req.session.userId]);
    const userName = userRes.rows[0]?.display_name || 'Nhân viên';

    await client.query(`
      INSERT INTO incidents (id, episode_id, site_id, device_id, title, reported_by, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'new', $7, $7)
    `, [incidentId, episodeId, req.params.siteId, device_id || null, title, req.session.userId, createdAt]);

    const initialNote = `[Báo cáo bởi: ${userName}] ${note ? note : 'Đã tạo báo cáo sự cố.'}`;
    await client.query(`
      INSERT INTO incident_notes (incident_id, author_id, note, created_at, kind)
      VALUES ($1, $2, $3, $4, 'report')
    `, [incidentId, req.session.userId, initialNote, createdAt]);

    await client.query(`
      INSERT INTO audit_logs (site_id, actor_user_id, action, entity_type, entity_id, new_values)
      VALUES ($1, $2, 'REPORT_INCIDENT', 'incidents', $3, $4)
    `, [req.params.siteId, req.session.userId, incidentId, JSON.stringify({ title, device_id, reported_by: userName })]);

    await client.query('COMMIT');

    const eventsRouter = require('./events');
    if (eventsRouter.sseEmitter) {
      eventsRouter.sseEmitter.emit('update');
    }

    res.json({ data: { success: true, id: incidentId, episode_id: episodeId } });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    console.error('Error reporting incident:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Lỗi máy chủ' } });
  } finally {
    client.release();
  }
});

// Helper to check incident membership
const checkIncidentMembership = async (req, res, next) => {
  const incidentId = req.params.id;
  try {
    const result = await db.query('SELECT * FROM incidents WHERE id = $1', [incidentId]);
    if (result.rows.length === 0) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy hồ sơ sự cố' } });
    
    req.params.siteId = result.rows[0].site_id;
    req.incident = result.rows[0];
    next();
  } catch (error) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Lỗi máy chủ' } });
  }
};

// Staff self-assign
router.post('/:id/assign', requireAuth, checkIncidentMembership, requireSiteMember, async (req, res) => {
  if (req.incident.assignee_id || req.incident.status !== 'new') {
    return res.status(409).json({ error: { code: 'CONFLICT', message: 'Hồ sơ đã có người phụ trách' } });
  }
  try {
    const updated=await db.query(`
      UPDATE incidents 
      SET assignee_id = $1, status = 'in_progress', assigned_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND assignee_id IS NULL AND status = 'new'
    `, [req.session.userId, req.params.id]);
    if(!updated.rowCount)return res.status(409).json({error:{code:'CONFLICT',message:'Hồ sơ đã được tiếp nhận hoặc hoàn tất'}});
    res.json({ data: { success: true } });
  } catch (error) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Lỗi máy chủ' } });
  }
});

// Manager assign to someone else
router.post('/:id/assign/:userId', requireAuth, checkIncidentMembership, requireSiteManager, async (req, res) => {
  try {
    const member=await db.query('SELECT u.id FROM users u JOIN site_users su ON su.user_id=u.id WHERE u.id=$1 AND su.site_id=$2 AND u.is_active=1',[req.params.userId,req.params.siteId]);
    if(!member.rows.length)return res.status(404).json({error:{code:'NOT_FOUND',message:'Người xử lý không thuộc cơ sở hoặc đã khóa'}});
    if(req.incident.status==='completed')return res.status(409).json({error:{code:'CONFLICT',message:'Hồ sơ đã hoàn tất'}});
    const updated=await db.query(`
      UPDATE incidents 
      SET assignee_id = $1, status = 'in_progress', assigned_at = CURRENT_TIMESTAMP 
      WHERE id = $2 AND status <> 'completed'
    `, [req.params.userId, req.params.id]);
    if(!updated.rowCount)return res.status(409).json({error:{code:'CONFLICT',message:'Hồ sơ đã hoàn tất'}});
    res.json({ data: { success: true } });
  } catch (error) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Lỗi máy chủ' } });
  }
});

// Manager assign staff with note
router.post('/:id/assign-staff', requireAuth, checkIncidentMembership, requireSiteManager, async (req, res) => {
  const { assignee_id, manager_note } = req.body;
  if (typeof assignee_id!=='string'||!assignee_id||(manager_note!==undefined&&(typeof manager_note!=='string'||manager_note.length>4000))) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Vui lòng chọn nhân viên xử lý' } });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const eligible=await client.query('SELECT u.id FROM users u JOIN site_users su ON su.user_id=u.id WHERE u.id=$1 AND su.site_id=$2 AND u.is_active=1',[assignee_id,req.params.siteId]);
    if(!eligible.rows.length){await client.query('ROLLBACK');return res.status(404).json({error:{code:'NOT_FOUND',message:'Người xử lý không thuộc cơ sở hoặc đã khóa'}});}
    const current=await client.query('SELECT status FROM incidents WHERE id=$1',[req.params.id]);
    if(current.rows[0].status==='completed'){await client.query('ROLLBACK');return res.status(409).json({error:{code:'CONFLICT',message:'Hồ sơ đã hoàn tất'}});}

    // Get manager and staff names
    const mgrRes = await client.query('SELECT display_name FROM users WHERE id = $1', [req.session.userId]);
    const mgrName = mgrRes.rows[0]?.display_name || 'Quản lý';
    const staffRes = await client.query('SELECT display_name FROM users WHERE id = $1', [assignee_id]);
    const staffName = staffRes.rows[0]?.display_name || 'Nhân viên';

    await client.query(`
      UPDATE incidents 
      SET assignee_id = $1, status = 'in_progress', assigned_at = CURRENT_TIMESTAMP, manager_note = $2, updated_at = CURRENT_TIMESTAMP 
      WHERE id = $3
    `, [assignee_id, manager_note || null, req.params.id]);

    if (manager_note && manager_note.trim()) {
      const noteContent = `[Chỉ đạo phân công bởi Quản lý ${mgrName} cho ${staffName}]: ${manager_note.trim()}`;
      await client.query(`
        INSERT INTO incident_notes (incident_id, author_id, note, kind)
        VALUES ($1, $2, $3, 'assignment')
      `, [req.params.id, req.session.userId, noteContent]);
    }

    await client.query(`
      INSERT INTO audit_logs (site_id, actor_user_id, action, entity_type, entity_id, new_values)
      VALUES ($1, $2, 'ASSIGN_INCIDENT', 'incidents', $3, $4)
    `, [req.params.siteId, req.session.userId, req.params.id, JSON.stringify({ assignee_id, staffName, manager_note })]);

    await client.query('COMMIT');

    const eventsRouter = require('./events');
    if (eventsRouter.sseEmitter) {
      eventsRouter.sseEmitter.emit('update');
    }

    res.json({ data: { success: true, assignee_name: staffName } });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    console.error('Error assigning staff to incident:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Lỗi máy chủ' } });
  } finally {
    client.release();
  }
});

// Complete incident
router.post('/:id/complete', requireAuth, checkIncidentMembership, requireSiteMember, async (req, res, next) => {
  const incidentId=req.params.id;
  const client=await db.pool.connect();
  const reject=(status,message)=>{throw Object.assign(new Error(message),{status});};
  try{
    await client.query('BEGIN IMMEDIATE');
    // Re-read both ownership and status while holding the write transaction.
    const current=(await client.query('SELECT * FROM incidents WHERE id=$1',[incidentId])).rows[0];
    if(!current)reject(404,'Không tìm thấy hồ sơ sự cố');
    if(current.status==='completed')reject(409,'Hồ sơ đã hoàn tất');
    if(current.assignee_id!==req.session.userId&&req.userRole!=='manager')reject(403,'Chỉ người phụ trách hoặc quản lý được hoàn tất');
    if(current.status!=='in_progress')reject(400,'Cần tiếp nhận hồ sơ trước khi hoàn tất');
    const active=await client.query('SELECT id FROM alerts WHERE episode_id=$1 AND resolved_at IS NULL LIMIT 1',[current.episode_id]);
    if(active.rows.length)reject(400,'Chưa thể hoàn tất vì đợt cảnh báo chưa kết thúc');
    const notes=await client.query("SELECT COUNT(*) AS n FROM incident_notes WHERE incident_id=$1 AND kind='outcome'",[incidentId]);
    if(!notes.rows[0].n)reject(400,'Cần ghi chú kết quả trước khi hoàn tất');
    await client.query("UPDATE incidents SET status='completed',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND status='in_progress'",[incidentId]);
    await client.query("INSERT INTO audit_logs(site_id,actor_user_id,action,entity_type,entity_id,new_values) VALUES($1,$2,'COMPLETE_INCIDENT','incidents',$3,$4)",[current.site_id,req.session.userId,incidentId,JSON.stringify({status:'completed'})]);
    await client.query('COMMIT');
    req.app.locals.sseEmitter?.emit('update');
    res.json({data:{success:true}});
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    if(error.status)return res.status(error.status).json({error:{code:error.status===403?'FORBIDDEN':error.status===409?'CONFLICT':'BAD_REQUEST',message:error.message}});
    next(error);
  }finally{client.release();}
});

// Add note
router.post('/:id/notes', requireAuth, checkIncidentMembership, requireSiteMember, async (req, res) => {
  const { note } = req.body;
  if (typeof note!=='string'||!note.trim()||note.length>4000) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Ghi chú cần từ 1 đến 4000 ký tự' } });
  
  try {
    await db.query(`
      INSERT INTO incident_notes (incident_id, author_id, note)
      VALUES ($1, $2, $3)
    `, [req.params.id, req.session.userId, note.trim()]);
    res.json({ data: { success: true } });
  } catch (error) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Lỗi máy chủ' } });
  }
});

// Get notes
router.get('/:id/notes', requireAuth, checkIncidentMembership, requireSiteMember, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT n.*, u.display_name as author_name
      FROM incident_notes n
      JOIN users u ON n.author_id = u.id
      WHERE n.incident_id = $1
      ORDER BY n.created_at ASC
    `, [req.params.id]);
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Lỗi máy chủ' } });
  }
});

module.exports = router;
