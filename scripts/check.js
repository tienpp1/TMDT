const fs=require('fs');
const path=require('path');
const {spawnSync}=require('child_process');
const root=path.join(__dirname,'..');
const files=[];
function visit(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const name=path.join(dir,entry.name);
  if(entry.isDirectory())visit(name);else if(/\.(c?js)$/.test(entry.name))files.push(name);
}}
for(const dir of ['backend/src','backend/scripts','frontend/js','simulator/src','tests','scripts'])visit(path.join(root,dir));
for(const file of files){
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  if(result.status!==0){console.error(result.stderr);process.exit(result.status||1);}
}
console.log(`Syntax checked ${files.length} JavaScript files.`);
