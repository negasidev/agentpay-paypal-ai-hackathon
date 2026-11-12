import pg from 'pg';
import {assertHostingIsolation} from '../hackathon-hosting.mjs';
export function createPool(connectionString=process.env.DATABASE_URL){assertHostingIsolation({...process.env,DATABASE_URL:connectionString});if(!connectionString)throw new Error('DATABASE_NOT_CONFIGURED');return new pg.Pool({connectionString,max:10});}
let pool;export function database(){return pool??=createPool();}
export async function transaction(pool,work){const client=await pool.connect();try{await client.query('BEGIN');const result=await work(client);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
