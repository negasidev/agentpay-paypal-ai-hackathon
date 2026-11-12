import {cpSync,existsSync} from 'node:fs';
if(existsSync('.env.local'))process.loadEnvFile('.env.local');
process.env.NODE_ENV='production';process.env.HOSTNAME='127.0.0.1';process.env.PORT='3006';
cpSync('.next/static','.next/standalone/.next/static',{recursive:true});
if(existsSync('public'))cpSync('public','.next/standalone/public',{recursive:true});
await import('../.next/standalone/server.js');
