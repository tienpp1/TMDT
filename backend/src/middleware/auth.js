const db=require('../db');

async function activeSession(req,res){
  if(req.authChecked)return true;
  if(!req.session?.userId){res.status(401).json({error:{code:'UNAUTHORIZED',message:'Yêu cầu đăng nhập'}});return false;}
  const result=await db.query('SELECT id FROM users WHERE id=$1 AND is_active=1',[req.session.userId]);
  if(!result.rows.length){
    req.session.destroy(()=>{});
    res.status(401).json({error:{code:'UNAUTHORIZED',message:'Tài khoản không tồn tại hoặc đã bị khóa'}});
    return false;
  }
  req.authChecked=true;
  return true;
}
async function requireAuth(req,res,next){
  try{if(await activeSession(req,res))next();}catch(error){next(error);}
}
function siteGuard(manager){return async(req,res,next)=>{
  try{
    if(!await activeSession(req,res))return;
    const siteId=req.params.siteId||req.params.id;
    if(!siteId)return res.status(400).json({error:{code:'BAD_REQUEST',message:'Thiếu site_id'}});
    const result=await db.query('SELECT su.role FROM site_users su JOIN sites s ON s.id=su.site_id WHERE su.user_id=$1 AND su.site_id=$2 AND s.is_active=1',[req.session.userId,siteId]);
    if(!result.rows.length||(manager&&result.rows[0].role!=='manager')){
      return res.status(403).json({error:{code:'FORBIDDEN',message:manager?'Yêu cầu quyền quản lý cơ sở':'Không có quyền truy cập cơ sở'}});
    }
    req.userRole=result.rows[0].role;
    next();
  }catch(error){next(error);}
};}
module.exports={requireAuth,requireSiteMember:siteGuard(false),requireSiteManager:siteGuard(true)};
