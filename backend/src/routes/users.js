const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireSiteManager } = require('../middleware/auth');
const { randomUUID: uuidv4 } = require('crypto');

// Get all staff for a site
router.get('/site/:siteId', requireAuth, requireSiteManager, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT u.id, u.email, u.display_name, u.is_active, su.role
      FROM users u
      JOIN site_users su ON u.id = su.user_id
      WHERE su.site_id = $1
    `, [req.params.siteId]);
    res.json({ data: result.rows });
  } catch (error) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Lỗi máy chủ' } });
  }
});

// Create a new staff user
router.post('/site/:siteId', requireAuth, requireSiteManager, async (req, res) => {
  const { email, password, display_name, role } = req.body;
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.length > 254 || typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password) > 72 || typeof display_name !== 'string' || !display_name.trim() || display_name.length > 100 || !['manager','staff'].includes(role)) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Email, tên, vai trò hoặc mật khẩu không hợp lệ (mật khẩu ít nhất 8 ký tự, tối đa 72 byte)' } });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    
    // Check if user already exists
    const existing = await client.query('SELECT id FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    let userId;
    
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: { code: 'CONFLICT', message: 'Email đã được sử dụng' } });
    } else {
      userId = uuidv4();
      const hash = await bcrypt.hash(password, 10);
      await client.query(`
        INSERT INTO users (id, email, password_hash, display_name, is_active)
        VALUES ($1, $2, $3, $4, 1)
      `, [userId, email.trim().toLowerCase(), hash, display_name.trim()]);
    }

    await client.query(`
      INSERT INTO site_users (user_id, site_id, role)
      VALUES ($1, $2, $3)
    `, [userId, req.params.siteId, role]);

    await client.query(`
      INSERT INTO audit_logs (site_id, actor_user_id, action, entity_type, entity_id, new_values)
      VALUES ($1, $2, 'CREATE_USER', 'users', $3, $4)
    `, [req.params.siteId, req.session.userId, userId, JSON.stringify({ email:email.trim().toLowerCase(), role })]);

    await client.query('COMMIT');
    res.json({ data: { id: userId, email, display_name, role, is_active: 1 } });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Lỗi máy chủ' } });
  } finally {
    client.release();
  }
});

// Update staff status (disable/enable) or role
router.patch('/:id/site/:siteId', requireAuth, requireSiteManager, async (req, res) => {
  const targetUserId = req.params.id;
  const { is_active, role } = req.body;
  const siteId = req.params.siteId;

  if ((role !== undefined && !['manager','staff'].includes(role)) || (is_active !== undefined && ![true,false,0,1].includes(is_active)) || (role === undefined && is_active === undefined)) {
    return res.status(400).json({error:{code:'BAD_REQUEST',message:'Vai trò hoặc trạng thái không hợp lệ'}});
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const target=await client.query('SELECT u.id,u.is_active,su.role FROM users u JOIN site_users su ON su.user_id=u.id WHERE u.id=$1 AND su.site_id=$2',[targetUserId,siteId]);
    if(!target.rows.length){
      await client.query('ROLLBACK');
      return res.status(404).json({error:{code:'NOT_FOUND',message:'Tài khoản không thuộc cơ sở'}});
    }
    if(is_active !== undefined){
      const memberships=await client.query('SELECT site_id,role FROM site_users WHERE user_id=$1',[targetUserId]);
      for(const membership of memberships.rows){
        const caller=await client.query('SELECT role FROM site_users WHERE user_id=$1 AND site_id=$2',[req.session.userId,membership.site_id]);
        if(!caller.rows.length||caller.rows[0].role!=='manager'){
          await client.query('ROLLBACK');
          return res.status(403).json({error:{code:'FORBIDDEN',message:'Không thể đổi trạng thái tài khoản được dùng tại cơ sở khác'}});
        }
        if((is_active===0||is_active===false)&&membership.role==='manager'&&target.rows[0].is_active){
          const others=await client.query("SELECT COUNT(*) AS n FROM site_users su JOIN users u ON u.id=su.user_id WHERE su.site_id=$1 AND su.role='manager' AND u.is_active=1 AND u.id<>$2",[membership.site_id,targetUserId]);
          if(others.rows[0].n===0){
            await client.query('ROLLBACK');
            return res.status(403).json({error:{code:'FORBIDDEN',message:'Không thể khóa người quản lý hoạt động cuối cùng của một cơ sở'}});
          }
        }
      }
    }

    // Prevent disabling the last manager
    if (is_active === 0 || is_active === false || role === 'staff') {
      const managers = await client.query(`
        SELECT su.user_id 
        FROM site_users su 
        JOIN users u ON su.user_id = u.id 
        WHERE su.site_id = $1 AND su.role = 'manager' AND u.is_active = 1
      `, [siteId]);
      
      if (managers.rows.length <= 1 && managers.rows[0]?.user_id === targetUserId) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Không thể vô hiệu hoá hoặc giáng cấp người quản lý duy nhất' } });
      }
    }

    if (is_active !== undefined) {
      const isActiveNum = is_active ? 1 : 0;
      await client.query('UPDATE users SET is_active = $1 WHERE id = $2', [isActiveNum, targetUserId]);
    }

    if (role) {
      await client.query('UPDATE site_users SET role = $1 WHERE user_id = $2 AND site_id = $3', [role, targetUserId, siteId]);
    }

    await client.query(`
      INSERT INTO audit_logs (site_id, actor_user_id, action, entity_type, entity_id, new_values)
      VALUES ($1, $2, 'UPDATE_USER', 'users', $3, $4)
    `, [siteId, req.session.userId, targetUserId, JSON.stringify({ is_active, role })]);

    await client.query('COMMIT');
    res.json({ data: { success: true } });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Lỗi máy chủ' } });
  } finally {
    client.release();
  }
});

module.exports = router;
