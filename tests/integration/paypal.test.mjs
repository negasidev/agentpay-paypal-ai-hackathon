import test from "node:test";
import assert from "node:assert/strict";
import {PayPalSandboxClient, assertApprovedOrder} from "../../src/server/paypal/client.mjs";
const purchase={amount:"119.00",currency:"USD",merchantId:"DEMO-MERCHANT"};
const order={id:"ORDER-1",status:"APPROVED",purchase_units:[{amount:{value:"119.00",currency_code:"USD"},payee:{merchant_id:"DEMO-MERCHANT"}}]};
test("only an exact approved single-unit order matches",()=>{
  assert.doesNotThrow(()=>assertApprovedOrder(order,"ORDER-1",purchase));
  for(const changed of [{...purchase,amount:"149.00"},{...purchase,currency:"EUR"},{...purchase,merchantId:"OTHER"}])
    assert.throws(()=>assertApprovedOrder(order,"ORDER-1",changed));
  assert.throws(()=>assertApprovedOrder({...order,status:"CREATED"},"ORDER-1",purchase));
  assert.throws(()=>assertApprovedOrder(order,"ORDER-2",purchase));
  assert.throws(()=>assertApprovedOrder({...order,purchase_units:[...order.purchase_units,...order.purchase_units]},"ORDER-1",purchase));
});
test("trusted order creation uses sandbox and stable request identity",async()=>{
  const calls=[];const client=new PayPalSandboxClient({clientId:"fixture",clientSecret:"fixture",fetchImpl:async(url,options)=>{
    calls.push({url,options});return Response.json(calls.length===1?{access_token:"fixture-token"}:{id:"ORDER-1"});
  }});
  await client.createOrder(purchase,"create-1");
  assert.ok(calls.every(call=>call.url.startsWith("https://api-m.sandbox.paypal.com/")));
  assert.equal(calls[1].options.headers["PayPal-Request-Id"],"create-1");
  assert.deepEqual(JSON.parse(calls[1].options.body).purchase_units[0].amount,{currency_code:"USD",value:"119.00"});
  assert.equal(calls[1].options.redirect,"error");
});
test("ambiguous capture never retries and returns UNKNOWN without provider body",async()=>{
  let calls=0;const client=new PayPalSandboxClient({clientId:"fixture",clientSecret:"fixture",fetchImpl:async()=>{
    if(++calls===1)return Response.json({access_token:"fixture-token"});throw new Error("sensitive payer details");
  }});
  await assert.rejects(client.captureOrder("ORDER-1","capture-1"),error=>error.code==="CAPTURE_UNKNOWN"&&!error.message.includes("sensitive"));
  assert.equal(calls,2);
});
test("invalid amount and path injection fail before provider calls",async()=>{
  const client=new PayPalSandboxClient({clientId:"fixture",clientSecret:"fixture",fetchImpl:()=>{throw new Error("must not call");}});
  await assert.rejects(client.createOrder({...purchase,amount:119},"create-1"),/INVALID_PURCHASE/);
  await assert.rejects(client.getOrder("../oauth"),/INVALID_ORDER_ID/);
});

test('oversized declared and streamed provider bodies are canceled without leaking payer data',async()=>{
  for(const declared of [true,false]) {
    let canceled=false;
    const body=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('sensitive-payer-data'.repeat(20000)));},cancel(){canceled=true;}});
    const client=new PayPalSandboxClient({clientId:'fixture',clientSecret:'fixture',fetchImpl:async()=>new Response(body,{headers:declared?{'content-length':'999999999'}:{}})});
    await assert.rejects(client.token(),e=>e.code==='PROVIDER_UNAVAILABLE'&&!e.message.includes('payer'));
    assert.equal(canceled,true);
  }
});

test('an invalid or oversized capture acknowledgement stays unknown and is never retried',async()=>{
  for(const body of ['["not an order"]','{"payer":"'+ 'x'.repeat(270000)+'"}']) {
    let calls=0;
    const client=new PayPalSandboxClient({clientId:'fixture',clientSecret:'fixture',fetchImpl:async()=>++calls===1?Response.json({access_token:'fixture-token'}):new Response(body)});
    await assert.rejects(client.captureOrder('ORDER-1','capture-1'),e=>e.code==='CAPTURE_UNKNOWN');
    assert.equal(calls,2);
  }
});
