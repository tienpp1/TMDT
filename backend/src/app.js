const express=require('express');
const cors=require('cors');
const session=require('express-session');
const path=require('path');
const crypto=require('crypto');
require('dotenv').config();
const app=express();
const appOrigin=new URL(process.env.APP_BASE_URL||'http://localhost:3000').origin;

app.disable('x-powered-by');
app.use((req,res,next)=>{
  req.id=crypto.randomUUID();
  res.set('X-Request-Id',req.id);
  res.set('X-Content-Type-Options','nosniff');
  res.set('Referrer-Policy','strict-origin-when-cross-origin');
  if(req.path.startsWith('/api/'))res.set('Cache-Control','no-store');
  next();
});
app.use(cors({origin:appOrigin,credentials:true}));
app.use('/api',(req,res,next)=>{
  const writes=['POST','PUT','PATCH','DELETE'].includes(req.method);
  // Telemetry uses its own device credential and does not authenticate with cookies.
  if(writes && req.path!=='/telemetry' && req.get('Origin') && req.get('Origin')!==appOrigin){
    return res.status(403).json({error:{code:'ORIGIN_FORBIDDEN',message:'Nguồn yêu cầu không được phép'}});
  }
  next();
});
app.use(express.json({limit:'16kb'}));
if(process.env.NODE_ENV==='production'&&!process.env.SESSION_SECRET){throw new Error('SESSION_SECRET is required in production');}
const sessionOptions={
  secret:process.env.SESSION_SECRET||crypto.randomBytes(32).toString('hex'),
  resave:false,saveUninitialized:false,
  cookie:{secure:process.env.COOKIE_SECURE==='true',httpOnly:true,sameSite:'lax',maxAge:8*60*60*1000}
};
if(process.env.NODE_ENV!=='test'){
  const SQLiteStore=require('connect-sqlite3')(session);
  sessionOptions.store=new SQLiteStore({db:'sessions.sqlite',dir:process.env.SESSION_DB_DIR||path.join(__dirname,'../../')});
}
app.use(session(sessionOptions));
app.use(express.static(path.join(__dirname,'../../frontend')));
for(const route of ['auth','telemetry','sites','devices','alerts','incidents','users','audit','reports']){
  app.use(`/api/${route}`,require(`./routes/${route}`));
}
const eventsRouter=require('./routes/events');
app.use('/api/events',eventsRouter);
app.locals.sseEmitter=eventsRouter.sseEmitter;
app.use('/api',(req,res)=>res.status(404).json({error:{code:'NOT_FOUND',message:'API không tồn tại'}}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'../../frontend/index.html')));
app.use((err,req,res,next)=>{
  if(res.headersSent)return next(err);
  const status=err.type==='entity.too.large'?413:err.type==='entity.parse.failed'?400:500;
  if(status===500)console.error(`Request ${req.id}:`,err.message);
  res.status(status).json({error:{code:status===400?'BAD_JSON':status===413?'PAYLOAD_TOO_LARGE':'INTERNAL_ERROR',message:status===400?'JSON không hợp lệ':status===413?'Dữ liệu vượt giới hạn 16KB':'Lỗi máy chủ',request_id:req.id}});
});
module.exports=app;
