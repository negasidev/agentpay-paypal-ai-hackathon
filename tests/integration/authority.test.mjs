import test from 'node:test';import assert from 'node:assert/strict';
import {TwoayeAuthorityAdapter,purchaseEnvelope} from '../../src/server/authorization/twoaye.mjs';
const config={baseUrl:'https://authority.example.test',tenantId:'tenant-1',agentId:'agent-1',intentId:'intent-1',tool:'paypal',action:'capture',accessToken:'fixture-not-live'};
const binding={tenantId:'tenant-1',localTenantId:'local-tenant',principalId:'local-user',purchaseVersion:3,purchaseId:'purchase-1',providerOrderId:'order-1',executionId:'attempt-1',merchantId:'merchant-1',amount:'119.00',currency:'USD'};
test('purchase authority includes exact purchase, provider order and execution identity',()=>{
  const envelope=purchaseEnvelope(binding,config);
  assert.equal(envelope.predicates.find(p=>p.type==='amount').value,'119.00');
  assert.deepEqual(envelope.predicates.filter(p=>p.type==='resource_reference').map(p=>p.resourceId),['order-1','purchase-1','attempt-1','local-user','local-tenant']);
  assert.equal(envelope.predicates.find(p=>p.type==='resource_version').value,'3');
  for(const changed of [{...binding,tenantId:'tenant-2'},{...binding,amount:119},{...binding,providerOrderId:''}])assert.throws(()=>purchaseEnvelope(changed,config));
});
test('unregistered predicates still refuse evaluation before network',async()=>{
  let calls=0;const adapter=new TwoayeAuthorityAdapter({...config,fetchImpl:async()=>{calls++;throw new Error('must not contact service');}});
  await assert.rejects(adapter.evaluateEnvelope({...purchaseEnvelope(binding,config),predicates:[{type:'unknown'}]}),/SDK_RESOURCE_BINDING_UNSUPPORTED/);
  await assert.rejects(adapter.consume({...binding,purchaseVersion:0},'grant-1'),/INVALID_AUTHORITY_BINDING/);
  assert.equal(calls,0);
});
