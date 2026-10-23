const fs=require('fs');
const os=require('os');
const path=require('path');
const {fork}=require('child_process');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tmdt-session-'));
process.env.NODE_ENV='test';
process.env.SQLITE_PATH=path.join(temp,'app.sqlite');
const db=require('../../backend/src/db');
let running;
async function start(){
  const child=fork(path.join(__dirname,'../helpers/persistent-server.js'),[],{env:{...process.env,NODE_ENV:'development',SESSION_DB_DIR:temp,SESSION_SECRET:'temporary-test-secret',APP_BASE_URL:'http://127.0.0.1:3000'},stdio:['ignore','pipe','pipe','ipc']});
  running=child;
  let errors='';
  child.stderr.on('data',chunk=>{errors+=chunk;});
  const port=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{child.kill();reject(new Error(`Server startup timeout: ${errors}`));},10000);
    child.once('message',message=>{clearTimeout(timeout);resolve(message.port);});
    child.once('error',error=>{clearTimeout(timeout);reject(error);});
    child.once('exit',code=>{clearTimeout(timeout);if(code)reject(new Error(`Server exited: ${errors}`));});
  });
  return `http://127.0.0.1:${port}`;
}
async function stop(){
  if(!running||running.exitCode!==null)return;
  const child=running;
  await new Promise(resolve=>{child.once('exit',resolve);child.send('stop');});
  running=null;
}
afterAll(async()=>{
  await stop();await db.pool.end();
  if(path.dirname(path.resolve(temp))!==path.resolve(os.tmpdir())||!path.basename(temp).startsWith('tmdt-session-'))throw new Error('Unsafe cleanup');
  fs.rmSync(temp,{recursive:true,force:true});
});
test('SQLite sessions survive server restart and logout revokes the persisted cookie',async()=>{
  const {seed}=require('../../backend/scripts/seed');
  await seed({writeSimulatorEnv:false});await db.pool.end();
  let base=await start();
  const login=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'manager@example.com',password:process.env.DEMO_MANAGER_PASSWORD||'manager123'})});
  expect(login.status).toBe(200);await login.json();
  const cookie=login.headers.get('set-cookie').split(';')[0];
  await stop();
  base=await start();
  const me=await fetch(`${base}/api/auth/me`,{headers:{Cookie:cookie}});
  expect(me.status).toBe(200);
  expect((await me.json()).data.email).toBe('manager@example.com');
  expect((await fetch(`${base}/api/auth/logout`,{method:'POST',headers:{Cookie:cookie}})).status).toBe(200);
  expect((await fetch(`${base}/api/auth/me`,{headers:{Cookie:cookie}})).status).toBe(401);
},30000);
