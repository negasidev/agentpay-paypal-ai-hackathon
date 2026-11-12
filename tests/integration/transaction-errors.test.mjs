import test from 'node:test';
import assert from 'node:assert/strict';
import {transactionFailure} from '../../src/server/transaction-errors.mjs';

test('transaction responses distinguish access refusal from unavailable service without exposing diagnostics',()=>{
 const events=[],logger={error:event=>events.push(event)};
 assert.equal(transactionFailure(Error('UNAUTHENTICATED'),logger).status,401);
 assert.equal(transactionFailure(Error('NOT_FOUND'),logger).status,404);
 assert.deepEqual(events,[]);
 const secret='do-not-publish-this-credential';
 for(const code of ['42P01','08006',secret]){
  const result=transactionFailure({code,message:secret,detail:secret},logger);
  assert.equal(result.status,503);assert.equal(result.body.error,'Transaction unavailable');
 }
 assert.deepEqual(events.map(event=>event.category),['database_schema','database_unavailable','service_unavailable']);
 assert(!JSON.stringify(events).includes(secret));
});
