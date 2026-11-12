import test from 'node:test';import assert from 'node:assert/strict';
import {completedCapture} from '../../src/server/paypal/client.mjs';
const purchase={amount:'119.00',currency:'USD',merchantId:'MERCHANT-1'};
const capture={id:'CAPTURE-FIXTURE',status:'COMPLETED',final_capture:true,amount:{value:'119.00',currency_code:'USD'}};
const order={id:'ORDER-FIXTURE',status:'COMPLETED',purchase_units:[{amount:{value:'119.00',currency_code:'USD'},payee:{merchant_id:'MERCHANT-1'},payments:{captures:[capture]}}]};
test('confirmed completed capture preserves provider identity',()=>{
  assert.equal(completedCapture(order,order.id,purchase).captureId,capture.id);
  assert.equal(completedCapture({...order,status:'APPROVED'},order.id,purchase),null);
  const pending=structuredClone(order);pending.purchase_units[0].payments.captures[0].status='PENDING';
  assert.equal(completedCapture(pending,order.id,purchase),null);
});
test('changed payee, amount, order, partial or multiple captures never become confirmed evidence',()=>{
  for(const modify of [o=>o.id='OTHER',o=>o.purchase_units[0].payee.merchant_id='OTHER',
    o=>o.purchase_units[0].amount.currency_code='EUR',
    o=>o.purchase_units[0].payments.captures[0].amount.currency_code='EUR',
    o=>o.purchase_units[0].payments.captures[0].amount.value='149.00',
    o=>o.purchase_units[0].payments.captures[0].final_capture=false,
    o=>o.purchase_units[0].payments.captures.push(capture)]){
    const changed=structuredClone(order);modify(changed);assert.throws(()=>completedCapture(changed,order.id,purchase));
  }
});
