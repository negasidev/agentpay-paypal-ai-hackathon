import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyPageSession} from '../../src/server/page-session.mjs';
const token='a'.repeat(64),endpoint='https://api.example.test/agentpay/api/session';
test('private page admission rejects missing, forged, expired and revoked sessions',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return new Response('{}',{status:401});};
 assert.equal(await verifyPageSession(undefined,{endpoint,fetcher}),false);
 assert.equal(await verifyPageSession('forged',{endpoint,fetcher}),false);
 assert.equal(calls,0);
 assert.equal(await verifyPageSession(token,{endpoint,fetcher}),false);
 assert.equal(calls,1);
});
test('private page admission verifies the existing service without caching or following redirects',async()=>{
 assert.equal(await verifyPageSession(token,{endpoint,fetcher:async(url,options)=>{
  assert.equal(url.href,endpoint);assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');
  assert.equal(options.headers.cookie,`__Host-agentpay_session=${token}`);
  return Response.json({authenticated:true,purchasingAuthorityGranted:false});
 }}),true);
});
test('private page admission fails closed on outages, malformed responses and unsafe service URLs',async()=>{
 for(const response of [new Response('{}',{status:503}),Response.json({authenticated:false}),new Response('invalid')])
  await assert.rejects(verifyPageSession(token,{endpoint,fetcher:async()=>response}));
 await assert.rejects(verifyPageSession(token,{endpoint:'http://api.example.test/session'}));
 await assert.rejects(verifyPageSession(token,{endpoint,fetcher:async()=>{throw Error('network');}}));
 assert.equal(await verifyPageSession(token,{endpoint:'',localAuthenticate:async()=>{throw Error('UNAUTHENTICATED');}}),false);
 await assert.rejects(verifyPageSession(token,{endpoint:'',localAuthenticate:async()=>{throw Error('database');}}));
});
