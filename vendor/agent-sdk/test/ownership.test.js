import test from 'node:test';
import assert from 'node:assert/strict';
import {VeridAgentClient} from '../src/index.js';

test('ownership lifecycle methods use the canonical guarded routes and fixed client tenant', async()=>{
 const calls=[];
 const client=new VeridAgentClient({baseUrl:'https://api.example.test',tenantId:'my-tenant',accessToken:'test-token',fetchImpl:async(url,init)=>{
  calls.push({url,...init});return {ok:true,json:async()=>({status:'Active'})};
 }});
 await client.agentOwnership('agent/id');
 await client.transferAgentOwnership('agent/id',{tenantId:'forged',actorId:'actor',newOwnerPrincipalId:'next',reason:'Reviewed handover',expectedOwnershipVersion:1});
 await client.suspendAgentOwnership('agent/id',{tenantId:'forged',actorId:'actor',reason:'Investigation',expectedOwnershipVersion:2});
 await client.withdrawAgentOwnership('agent/id',{tenantId:'forged',actorId:'actor',reason:'Retired',expectedOwnershipVersion:3});
 assert.equal(calls[0].url,'https://api.example.test/v1/agents/agent%2Fid/ownership?tenantId=my-tenant');
 assert.deepEqual(calls.slice(1).map(x=>new URL(x.url).pathname),['transfer','suspend','withdraw'].map(x=>'/v1/agents/agent%2Fid/ownership/'+x));
 for(const call of calls)assert.equal(call.headers.authorization,'Bearer test-token');
 for(const call of calls.slice(1))assert.equal(JSON.parse(call.body).tenantId,'my-tenant');
 assert.equal(JSON.parse(calls[1].body).newOwnerPrincipalId,'next');
 assert.deepEqual(calls.slice(1).map(x=>JSON.parse(x.body).expectedOwnershipVersion),[1,2,3]);
 for(const version of [undefined,0,-1,1.5,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>client.suspendAgentOwnership('agent',{actorId:'actor',reason:'test',expectedOwnershipVersion:version}));
});
