const router=require('express').Router();
const bcrypt=require('bcryptjs');
const db=require('../db');
const {requireAuth}=require('../middleware/auth');
const failures=new Map();
const failureWindow=15*60*1000;

async function userData(userId){
  const result=await db.query('SELECT id,email,display_name FROM users WHERE id=$1 AND is_active=1',[userId]);
  if(!result.rows.length)return null;
  const sites=await db.query('SELECT s.id,s.name,su.role FROM sites s JOIN site_users su ON s.id=su.site_id WHERE su.user_id=$1 AND s.is_active=1',[userId]);
  return {...result.rows[0],sites:sites.rows};
}
router.post('/login',async(req,res,next)=>{
  const {email,password}=req.body||{};
  if(typeof email!=='string'||typeof password!=='string'||!email.trim()||!password||email.length>254||password.length>128){
    return res.status(400).json({error:{code:'BAD_REQUEST',message:'Email và mật khẩu không hợp lệ'}});
  }
  const normalized=email.trim().toLowerCase();
  const limitKey=`${req.ip}|${normalized}`;
  const now=Date.now();
  for(const [key,value] of failures){if(value.expires<=now)failures.delete(key);}
  const attempts=failures.get(limitKey);
  if(attempts?.count>=10){
    res.set('Retry-After',String(Math.ceil((attempts.expires-now)/1000)));
    return res.status(429).json({error:{code:'TOO_MANY_REQUESTS',message:'Đăng nhập sai quá nhiều lần, vui lòng thử lại sau'}});
  }
  try{
    const result=await db.query('SELECT id,password_hash FROM users WHERE email=$1 AND is_active=1',[normalized]);
    if(!result.rows.length||!await bcrypt.compare(password,result.rows[0].password_hash)){
      if(failures.size>=5000)failures.delete(failures.keys().next().value);
      failures.set(limitKey,{count:(attempts?.count||0)+1,expires:attempts?.expires||now+failureWindow});
      return res.status(401).json({error:{code:'UNAUTHORIZED',message:'Sai email hoặc mật khẩu'}});
    }
    failures.delete(limitKey);
    await new Promise((resolve,reject)=>req.session.regenerate(error=>error?reject(error):resolve()));
    req.session.userId=result.rows[0].id;
    const data=await userData(req.session.userId);
    await new Promise((resolve,reject)=>req.session.save(error=>error?reject(error):resolve()));
    res.json({data});
  }catch(error){next(error);}
});
router.post('/logout',(req,res,next)=>req.session.destroy(error=>{
  if(error)return next(error);
  res.clearCookie('connect.sid');res.json({data:{success:true}});
}));
router.get('/me',requireAuth,async(req,res,next)=>{
  try{res.json({data:await userData(req.session.userId)});}catch(error){next(error);}
});
module.exports=router;
