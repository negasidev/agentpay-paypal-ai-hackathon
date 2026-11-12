import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {createPool} from '../../src/server/persistence/db.mjs';

export async function aiDatabase(){
 const admin=createPool();const schema='ai_test_'+randomUUID().replaceAll('-','');
 await admin.query(`CREATE SCHEMA ${schema}`);
 const url=new URL(process.env.DATABASE_URL);url.searchParams.set('options',`-c search_path=${schema}`);
 const connect=()=>createPool(url.href);const db=connect();
 try{
  for(const name of (await readdir(new URL('../../migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort())
   await db.query(await readFile(new URL('../../migrations/'+name,import.meta.url),'utf8'));
 }catch(error){await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();throw error;}
 finally{await db.end();}
 return {connect,connectionString:url.href,async close(){try{await admin.query(`DROP SCHEMA ${schema} CASCADE`);}finally{await admin.end();}}};
}
