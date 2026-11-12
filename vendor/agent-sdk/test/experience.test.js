import test from 'node:test';
import assert from 'node:assert/strict';
import {createTaskContinuation, requireCurrentContinuation, validateTaskContinuation, experienceStatus} from '../src/experience.js';
const input = {id:'11111111-1111-1111-1111-111111111111', principalId:'22222222-2222-2222-2222-222222222222',
  tenantId:'33333333-3333-3333-3333-333333333333', sourceApplication:'console', destinationApplication:'agentpay',
  operation:'open_purchase_workspace', returnDestination:'https://agentpay.example/api/identity/callback', issuedAt:1000, expiresAt:301000};
test('navigation continuation binds current context and expires at the boundary', () => {
  const record = createTaskContinuation(input), current = {...input, now:1001};
  assert.equal(requireCurrentContinuation(record, current).grantsAuthority, false);
  for (const field of ['principalId','tenantId','sourceApplication','destinationApplication','operation','returnDestination'])
    assert.throws(() => requireCurrentContinuation(record, {...current, [field]:'changed'}));
  for (const now of [999,301000,Infinity]) assert.throws(() => requireCurrentContinuation(record, {...current, now}));
});
test('continuation refuses extra authority, malformed identity, unsafe destinations and unbounded lifetime', () => {
  const record = createTaskContinuation(input);
  for (const change of [{grantsAuthority:true},{grant:'forged'},{principalId:'person'},{expiresAt:301001},{version:2},
    {returnDestination:'https://user@agentpay.example/callback'},{returnDestination:'https://agentpay.example/callback?token=x'},
    {returnDestination:'http://remote.example/callback'},{returnDestination:'file://localhost/callback'}])
    assert.throws(() => validateTaskContinuation({...record,...change}));
});
test('source states never turn approval or reported execution into confirmed execution', () => {
  assert.equal(experienceStatus({kind:'Decision',status:'ALLOW'}).label,'Pending');
  const approval = experienceStatus({kind:'Approval',status:'Approved'});
  assert.equal(approval.grantsAuthority,false); assert.equal(approval.destinationConfirmed,false);
  assert.equal(experienceStatus({kind:'Receipt',status:'Succeeded'}).label,'Needs Investigation');
  assert.equal(experienceStatus({kind:'Receipt',status:'Succeeded',destinationConfirmed:true}).label,'Completed');
  assert.equal(experienceStatus({kind:'Receipt',status:'Unknown',destinationConfirmed:true}).label,'Needs Investigation');
  assert.equal(experienceStatus({kind:'Decision',status:'DENY'}).label,'Refused');
});
