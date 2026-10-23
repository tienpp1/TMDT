const {setup,cleanup}=require('../helpers/fixture');
const {randomUUID}=require('crypto');
let ctx;
beforeAll(async()=>{ctx=await setup();});
afterAll(cleanup);
async function incident(){
  const res=await ctx.staff.post(`/api/incidents/site/${ctx.siteId}/report`).send({title:'Kiểm tra thoát nước',device_id:ctx.deviceId,note:'Báo cáo ban đầu'});
  expect(res.status).toBe(200);
  return res.body.data.id;
}
test('O01 manager cannot assign an incident to a foreign-site account',async()=>{
  const id=await incident();
  const res=await ctx.manager.post(`/api/incidents/${id}/assign-staff`).send({assignee_id:ctx.otherManagerId});
  expect([403,404]).toContain(res.status);
});
test('O02 only one concurrent self-assignment succeeds',async()=>{
  const id=await incident();
  const results=await Promise.all([ctx.staff.post(`/api/incidents/${id}/assign`).send({}),ctx.manager.post(`/api/incidents/${id}/assign`).send({})]);
  expect(results.map(r=>r.status).sort()).toEqual([200,409]);
});
test('O03 report and assignment notes do not substitute for an outcome note',async()=>{
  const id=await incident();
  await ctx.staff.post(`/api/incidents/${id}/assign`).send({});
  expect((await ctx.staff.post(`/api/incidents/${id}/complete`).send({})).status).toBe(400);
  expect((await ctx.staff.post(`/api/incidents/${id}/notes`).send({note:'Đã kiểm tra và khơi thông rãnh thoát nước trong mô phỏng.'})).status).toBe(200);
  expect((await ctx.staff.post(`/api/incidents/${id}/complete`).send({})).status).toBe(200);
});
test('O04 completing an already completed incident is a conflict',async()=>{
  const id=await incident();
  await ctx.staff.post(`/api/incidents/${id}/assign`).send({});
  await ctx.staff.post(`/api/incidents/${id}/notes`).send({note:'Đã kiểm tra'});
  expect((await ctx.staff.post(`/api/incidents/${id}/complete`).send({})).status).toBe(200);
  expect((await ctx.staff.post(`/api/incidents/${id}/complete`).send({})).status).toBe(409);
});
test('O05 alert acknowledgement is idempotent and audited once with valid JSON',async()=>{
  const id=randomUUID(),episodeId=randomUUID();
  await ctx.db.query('INSERT INTO alerts(id,episode_id,device_id,level,rule_version) VALUES($1,$2,$3,$4,1)',[id,episodeId,ctx.deviceId,'warning']);
  const responses=await Promise.all([ctx.staff.post(`/api/alerts/${id}/ack`).send({}),ctx.manager.post(`/api/alerts/${id}/ack`).send({})]);
  expect(responses.every(r=>r.status===200)).toBe(true);
  const logs=(await ctx.db.query("SELECT new_values FROM audit_logs WHERE entity_id=$1 AND action='ACK_ALERT'",[id])).rows;
  expect(logs).toHaveLength(1);
  expect(JSON.parse(logs[0].new_values).acked).toBe(true);
});

// Preserve the actual SQLite read/write behavior; the gate controls only request ordering.
function pauseFirstIncidentRead(id){
  const original=ctx.db.query;
  let release,reached;
  const gate=new Promise(resolve=>{release=resolve;});
  const ready=new Promise(resolve=>{reached=resolve;});
  let paused=false;
  ctx.db.query=async(sql,params)=>{
    const result=await original(sql,params);
    if(!paused&&sql==='SELECT * FROM incidents WHERE id = $1'&&params[0]===id){paused=true;reached();await gate;}
    return result;
  };
  return {ready,release,restore(){ctx.db.query=original;release();}};
}
test('O06 a former assignee cannot complete after a concurrent reassignment',async()=>{
  const id=await incident();
  await ctx.staff.post(`/api/incidents/${id}/assign`).send({});
  await ctx.staff.post(`/api/incidents/${id}/notes`).send({note:'Đã xử lý trong mô phỏng'});
  const gate=pauseFirstIncidentRead(id);
  try{
    const pending=ctx.staff.post(`/api/incidents/${id}/complete`).send({}).then(r=>r);
    await gate.ready;
    expect((await ctx.manager.post(`/api/incidents/${id}/assign-staff`).send({assignee_id:ctx.managerId})).status).toBe(200);
    gate.release();
    expect((await pending).status).toBe(403);
  }finally{gate.restore();}
});
test('O07 a concurrent assignment cannot reopen an incident already completed',async()=>{
  const id=await incident();
  await ctx.staff.post(`/api/incidents/${id}/assign`).send({});
  await ctx.staff.post(`/api/incidents/${id}/notes`).send({note:'Đã xử lý trong mô phỏng'});
  const gate=pauseFirstIncidentRead(id);
  try{
    const pending=ctx.manager.post(`/api/incidents/${id}/assign/${ctx.managerId}`).send({}).then(r=>r);
    await gate.ready;
    expect((await ctx.staff.post(`/api/incidents/${id}/complete`).send({})).status).toBe(200);
    gate.release();
    expect((await pending).status).toBe(409);
    expect((await ctx.db.query('SELECT status FROM incidents WHERE id=$1',[id])).rows[0].status).toBe('completed');
  }finally{gate.restore();}
});
