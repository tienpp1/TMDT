const fs = require('fs');
const path = require('path');
const dbModule = require('../src/db');

async function migrate() {
  const client=await dbModule.pool.connect();
  try {
    await client.query('BEGIN IMMEDIATE');
    const schema=fs.readFileSync(path.join(__dirname,'../src/db/schema.sql'),'utf8');
    const db=await dbModule.getDb();
    await db.exec(schema);
    const additions={
      devices:{demo_override_level:'NUMERIC',lat:'REAL',lng:'REAL',zone_radius_km:'REAL DEFAULT 1.5',risk_level:'INTEGER DEFAULT 1'},
      incidents:{device_id:'TEXT REFERENCES devices(id)',title:'TEXT',reported_by:'TEXT REFERENCES users(id)',manager_note:'TEXT'},
      incident_notes:{kind:"TEXT NOT NULL DEFAULT 'outcome'"}
    };
    for(const [table,columns] of Object.entries(additions)) {
      const present=new Set((await db.all(`PRAGMA table_info(${table})`)).map(c=>c.name));
      for(const [name,type] of Object.entries(columns)) {
        if(!present.has(name))await db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
      }
      if(table==='incident_notes'&&!present.has('kind')){
        await db.exec("UPDATE incident_notes SET kind=CASE WHEN note LIKE '[Báo cáo bởi:%' THEN 'report' WHEN note LIKE '[Chỉ đạo phân công%' THEN 'assignment' ELSE 'outcome' END");
      }
    }
    await client.query('COMMIT');
  } catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally {client.release();}
}
if(require.main===module){
  migrate().then(()=>console.log('SQLite migration completed (existing data preserved).'))
    .catch(error=>{console.error('Migration failed:',error.message);process.exitCode=1;})
    .finally(()=>dbModule.pool.end());
}
module.exports={migrate};
