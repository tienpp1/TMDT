const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
require('dotenv').config({ quiet: true });

let dbPromise;
let tail = Promise.resolve();
const filename = process.env.SQLITE_PATH || path.join(__dirname, '../../database.sqlite');
if (process.env.NODE_ENV === 'test' && !process.env.SQLITE_PATH) {
  throw new Error('Tests must set SQLITE_PATH to an isolated database before importing the app.');
}
async function getDb() {
  if (!dbPromise) {
    dbPromise = open({ filename, driver: sqlite3.Database }).then(async db => {
      await db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
      return db;
    }).catch(error => { dbPromise = null; throw error; });
  }
  return dbPromise;
}
async function acquireLock() {
  const previous = tail;
  let release;
  tail = new Promise(resolve => { release = resolve; });
  await previous;
  return release;
}
function bind(params) {
  if (!Array.isArray(params)) return params;
  return Object.fromEntries(params.map((value,index) => [`$${index+1}`,value === undefined ? null : value]));
}
async function execute(db,sql,params) {
  if (/^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) {
    const rows = await db.all(sql, bind(params));
    return {rows,rowCount:rows.length};
  }
  const result = await db.run(sql,bind(params));
  return {rows:[],rowCount:result.changes,lastID:result.lastID};
}
async function query(sql,params) {
  const release = await acquireLock();
  try { return await execute(await getDb(),sql,params); }
  finally { release(); }
}
const pool = {
  async connect() {
    const unlock=await acquireLock();
    try {
      const db=await getDb();
      let released=false;
      return {query:(sql,params)=>execute(db,sql,params),release(){if(!released){released=true;unlock();}}};
    } catch(error){unlock();throw error;}
  },
  async end(){
    const release=await acquireLock();
    try {if(dbPromise){const db=await dbPromise;await db.close();dbPromise=null;}}
    finally {release();}
  }
};
module.exports={getDb,query,pool};
