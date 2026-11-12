import test from 'node:test';
import assert from 'node:assert/strict';
import {aiConfiguration,configuredModel,createCatalogAgent} from '../../src/server/ai/agent.mjs';
import {products} from '../../src/server/ai/catalog.mjs';

test('direct OpenAI selection is server controlled and never falls back to another provider',()=>{
 const env={OPENAI_API_KEY:'fixture-key',AGENTPAY_AI_MODEL:'openai/fixture-model'};
 assert.deepEqual(aiConfiguration(env),{provider:'openai',model:'openai/fixture-model'});
 assert.throws(()=>aiConfiguration({...env,AGENTPAY_AI_MODEL:'anthropic/fixture'}),/AI_NOT_CONFIGURED/);
 assert.throws(()=>aiConfiguration({...env,AGENTPAY_AI_PROVIDER:'unknown'}),/AI_NOT_CONFIGURED/);
 assert.throws(()=>aiConfiguration({...env,AGENTPAY_AI_PROVIDER:'vercel-ai-gateway'}),/AI_NOT_CONFIGURED/);
 assert.equal(aiConfiguration({...env,AI_GATEWAY_API_KEY:'fixture-gateway'}).provider,'vercel-ai-gateway');
});

test('real OpenAI adapter uses bounded Responses transport and structured output without live network',async()=>{
 const env={OPENAI_API_KEY:'fixture-key',AGENTPAY_AI_MODEL:'openai/fixture-model'};let calls=0;
 const proposal={recommendedProductId:'keyboard',quantity:1,reason:'Within budget.',alternatives:[],requiresUserApproval:true};
 const model=configuredModel(aiConfiguration(env),env,async(url,options)=>{
  calls++;assert.equal(String(url),'https://api.openai.com/v1/responses');
  assert.equal(new Headers(options.headers).get('authorization'),'Bearer fixture-key');assert.equal(options.redirect,'error');
  const body=JSON.parse(options.body);assert.equal(body.model,'fixture-model');assert.equal(body.store,false);
  assert.equal(body.max_output_tokens,1200);if(calls===2)assert.equal(body.text.format.type,'json_schema');else assert.equal(body.tool_choice.name,'compareProducts');
  assert.ok((body.tools??[]).every(tool=>tool.name==='compareProducts'));
  return Response.json({id:'resp_fixture',created_at:1,model:'fixture-model',status:'completed',
   output:calls===1?[{type:'function_call',id:'fc_fixture',call_id:'call_compare',name:'compareProducts',arguments:JSON.stringify({productIds:['keyboard','wired-keyboard']}),status:'completed'}]:[{type:'message',id:'msg_fixture',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(proposal),annotations:[]}]}],
   usage:{input_tokens:10,output_tokens:20,total_tokens:30}});
 });
 const result=await createCatalogAgent(model,products,'150.00',[],{openai:{store:false}}).generate({prompt:'Find a keyboard.'});
 assert.equal(calls,2);assert.deepEqual(result.output,proposal);
});

test('OpenAI adapter failure does not retry',async()=>{
 let calls=0;const env={OPENAI_API_KEY:'fixture-key',AGENTPAY_AI_MODEL:'openai/fixture-model'};
 const model=configuredModel(aiConfiguration(env),env,async()=>{calls++;return Response.json({error:{message:'fixture rejection',type:'invalid_request_error',code:'invalid_api_key'}},{status:401});});
 await assert.rejects(createCatalogAgent(model,products,'150.00').generate({prompt:'Find a keyboard.'}));
 assert.equal(calls,1);
});
