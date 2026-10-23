const bcrypt=require('bcryptjs');
const db=require('../src/db');
const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const {migrate}=require('./migrate');
const demoDevices=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];

async function seed({writeSimulatorEnv=true}={}){
  await migrate();
  const envPath=process.env.SIMULATOR_ENV_PATH||path.join(__dirname,'../../.env.simulator');
  const original=writeSimulatorEnv&&fs.existsSync(envPath)?fs.readFileSync(envPath,'utf8'):'';
  const simulatorConfig=require('dotenv').parse(original);
  const additions=[];
  const client=await db.pool.connect();
  try{
    await client.query('BEGIN');
    const existingDevice=(await client.query('SELECT site_id FROM devices WHERE id=$1',[demoDevices[0]])).rows[0];
    const existingSite=(await client.query('SELECT id FROM sites WHERE name=$1 ORDER BY created_at LIMIT 1',['Bãi xe mô phỏng A'])).rows[0];
    const siteId=existingDevice?.site_id||existingSite?.id||'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await client.query('INSERT OR IGNORE INTO sites(id,name,location) VALUES($1,$2,$3)',[siteId,'Bãi xe mô phỏng A','Một bãi xe giả lập phục vụ đồ án']);
    for(const [email,name,role,password] of [
      ['manager@example.com','Quản lý demo','manager',process.env.DEMO_MANAGER_PASSWORD||'manager123'],
      ['staff@example.com','Nhân viên demo','staff',process.env.DEMO_STAFF_PASSWORD||'staff123']
    ]){
      let user=(await client.query('SELECT id FROM users WHERE email=$1',[email])).rows[0];
      if(!user){
        if(password.length<8||Buffer.byteLength(password)>72)throw new Error('Mật khẩu demo mới cần ít nhất 8 ký tự và tối đa 72 byte');
        user={id:crypto.randomUUID()};
        await client.query('INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',[user.id,email,name,await bcrypt.hash(password,10)]);
      }
      await client.query('INSERT OR IGNORE INTO site_users(site_id,user_id,role) VALUES($1,$2,$3)',[siteId,user.id,role]);
    }
    for(let i=0;i<demoDevices.length;i++){
      const id=demoDevices[i],envName=`SIMULATOR_DEVICE_${i+1}_KEY`;
      const existing=(await client.query('SELECT id,key_hash FROM devices WHERE id=$1',[id])).rows[0];
      if(!existing){
        const key=simulatorConfig[envName]||`${id}.${crypto.randomBytes(16).toString('hex')}`;
        if(Buffer.byteLength(key)>72)throw new Error(`Khóa cấu hình thiết bị ${i+1} vượt giới hạn 72 byte bcrypt`);
        await client.query('INSERT INTO devices(id,site_id,name,point_label,key_hash,lat,lng) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,siteId,`Điểm đo ${i+1}`,['Lối vào','Khu vực thấp','Rãnh thoát nước'][i],await bcrypt.hash(key,10),10.776+i*0.0001,106.701+i*0.0001]);
        if(!simulatorConfig[envName])additions.push(`${envName}=${key}`);
      }
      await client.query('INSERT OR IGNORE INTO alert_rules(device_id,warning_cm,critical_cm,clear_cm,sample_count) VALUES($1,10,20,7,3)',[id]);
    }
    await client.query('COMMIT');
    if(writeSimulatorEnv&&additions.length){
      fs.writeFileSync(envPath,original+(original&&!original.endsWith('\n')?'\n':'')+additions.join('\n')+'\n',{mode:0o600});
    }
    return {siteId,deviceIds:demoDevices};
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{client.release();}
}
if(require.main===module){
  seed().then(()=>console.log('Demo seed completed. Existing data/passwords preserved; new device keys are in .env.simulator (never commit this file).'))
    .catch(error=>{console.error('Seed failed:',error.message);process.exitCode=1;})
    .finally(()=>db.pool.end());
}
module.exports={seed};
