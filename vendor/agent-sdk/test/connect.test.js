import test from 'node:test';
import assert from 'node:assert/strict';
import {VeridConnectClient} from '../src/index.js';
const id='11111111-1111-4111-8111-111111111111';
test('connection diagnostics are a single tenant-scoped read without provider credentials or grant creation',async()=>{
 const {client,calls}=fixture();await client.connectionDiagnostics();
 assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.example.test/v1/tenants/tenant-1/marketplace/diagnostics');
 assert.equal(calls[0].init.method,undefined);assert.equal(calls[0].init.body,undefined);
});
function fixture(fetcher){const calls=[];const client=new VeridConnectClient({baseUrl:'https://api.example.test',tenantId:'tenant-1',accessToken:'platform-token',fetchImpl:async(url,init)=>{calls.push({url,init});return fetcher?fetcher(url,init):new Response('{}',{headers:{'content-type':'application/json'}});}});return {client,calls};}
test('connector discovery cannot supply arbitrary provider destinations',async()=>{
 const {client,calls}=fixture();await client.connector('google-ads');
 assert.equal(calls[0].url,'https://api.example.test/v1/tenants/tenant-1/marketplace/connectors/google-ads');
 assert.throws(()=>client.connector('../credentials'),/identifier/);assert.equal(calls.length,1);
});
test('budget micros retain exact string form and unsafe values never leave the SDK',async()=>{
 const {client,calls}=fixture();await client.prepareBudgetChange({amountMicros:'15000000'});
 assert.equal(JSON.parse(calls[0].init.body).amountMicros,'15000000');
 for(const amountMicros of [15,'015000000','-1','9223372036854775808'])assert.throws(()=>client.prepareBudgetChange({amountMicros}),/int64/);
 assert.equal(calls.length,1);
});
test('unknown execution is never replayed and reconciliation reads without authority minting',async()=>{
 const {client,calls}=fixture(async()=>{throw new Error('Lost response');});
 await assert.rejects(client.executeBudgetChange(id,id),/Lost response/);assert.equal(calls.length,1);
 const reads=fixture();await reads.client.reconcileBudgetChange(id);assert.match(reads.calls[0].url,/\/reconcile$/);assert.equal(reads.calls[0].init.method,undefined);
});
