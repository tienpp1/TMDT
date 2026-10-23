const { sampleFor, SCENARIOS }=require('./index');
const device={id:'11111111-1111-4111-8111-111111111111'};
test('rise-fall produces three qualifying warning and critical samples followed by clear',()=>{
 const levels=Array.from({length:13},(_,tick)=>sampleFor(device,0,'rise-fall',tick,1700000000000+tick*5000).level_cm);
 expect(levels).toEqual([5,5,5,12,12,12,22,22,22,22,5,5,5]);
});
test('sensor errors and disconnect remain distinct',()=>{
 expect(sampleFor(device,0,'sensor-error',3,1700000000000)).toMatchObject({quality:'sensor_error',level_cm:null});
 expect(sampleFor(device,0,'disconnect',3,1700000000000)).toBeNull();
 expect(sampleFor(device,1,'disconnect',3,1700000000000)).toMatchObject({quality:'ok',level_cm:5});
});
test('late-data has an older timestamp and duplicate reuses the original payload',()=>{
 const previous=sampleFor(device,0,'normal',2,1700000000000);
 expect(sampleFor(device,0,'duplicate',3,1700000005000,previous)).toEqual(previous);
 expect(Date.parse(sampleFor(device,0,'late-data',3,1700000005000).measured_at)).toBe(1699999975000);
 expect(SCENARIOS).toContain('invalid-key');
});
test('HTTP failures persist samples without credentials; a restarted simulator retries the same message IDs',async()=>{
 const http=require('http'),fs=require('fs'),os=require('os'),path=require('path');
 const {promisify}=require('util');const execFile=promisify(require('child_process').execFile);
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'simulator-queue-test-'));
 const filename=path.join(directory,'queue.json');let failing=true;const accepted=[];
 const server=http.createServer((req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{if(!failing)accepted.push(JSON.parse(body));res.writeHead(failing?500:201,{'Content-Type':'application/json'});res.end('{}');});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const env={...process.env,SIMULATOR_BASE_URL:`http://127.0.0.1:${server.address().port}`,SIMULATOR_QUEUE_PATH:filename,SIMULATOR_DEVICE_1_KEY:'test-secret-one',SIMULATOR_DEVICE_2_KEY:'test-secret-two',SIMULATOR_DEVICE_3_KEY:'test-secret-three'};
 try {
  await execFile(process.execPath,[path.join(__dirname,'index.js'),'--once'],{env,timeout:10000});
  const pending=JSON.parse(fs.readFileSync(filename,'utf8'));expect(pending).toHaveLength(3);
  expect(fs.readFileSync(filename,'utf8')).not.toContain('test-secret');
  // Model elapsed backoff; restarting must retain the original message identity.
  expect(pending.every(item=>item.nextAt>Date.parse(item.payload.measured_at))).toBe(true);
  fs.writeFileSync(filename,JSON.stringify(pending.map(item=>({...item,nextAt:0}))));
  failing=false;
  await execFile(process.execPath,[path.join(__dirname,'index.js'),'--once'],{env,timeout:10000});
  expect(JSON.parse(fs.readFileSync(filename,'utf8'))).toEqual([]);
  for(const item of pending)expect(accepted.some(sample=>sample.message_id===item.payload.message_id)).toBe(true);
 } finally {await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});}
},25000);
