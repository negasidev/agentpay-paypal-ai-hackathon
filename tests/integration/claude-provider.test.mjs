import test from 'node:test';
import assert from 'node:assert/strict';
import {aiConfiguration,configuredModel,createCatalogAgent} from '../../src/server/ai/agent.mjs';
import {products} from '../../src/server/ai/catalog.mjs';
const env={AGENTPAY_AI_PROVIDER:'anthropic',ANTHROPIC_API_KEY:'fixture-key',ANTHROPIC_WORKSPACE_ID:'wrkspc_fixture',AGENTPAY_AI_MODEL:'anthropic/claude-haiku-5-5'};

test('Claude selection requires its own key and model without fallback to saved OpenAI credentials',()=>{
 assert.equal(aiConfiguration(env).provider,'anthropic');assert.throws(()=>aiConfiguration({...env,ANTHROPIC_WORKSPACE_ID:'bad\r\nheader'}),/AI_NOT_CONFIGURED/);
 assert.throws(()=>aiConfiguration({...env,ANTHROPIC_API_KEY:'',OPENAI_API_KEY:'fixture-openai'}),/AI_NOT_CONFIGURED/);
 assert.throws(()=>aiConfiguration({...env,AGENTPAY_AI_MODEL:'openai/fixture'}),/AI_NOT_CONFIGURED/);
});

test('Claude adapter sends bounded read-only structured requests through mocked transport',async()=>{
 let calls=0;const proposal={recommendedProductId:'keyboard',quantity:1,reason:'Within budget.',alternatives:[],requiresUserApproval:true};
 const model=configuredModel(aiConfiguration(env),env,async(url,options)=>{
  calls++;assert.equal(String(url),'https://api.anthropic.com/v1/messages');
  assert.equal(new Headers(options.headers).get('x-api-key'),'fixture-key');assert.equal(new Headers(options.headers).get('anthropic-workspace-id'),'wrkspc_fixture');assert.equal(options.redirect,'error');
  const body=JSON.parse(options.body);assert.equal(body.model,'claude-haiku-5-5');assert.equal(body.max_tokens,1200);
  assert.equal(body.thinking.type,'disabled');if(calls===1){assert.equal(body.tool_choice.name,'compareProducts');assert.equal(body.output_config?.format,undefined);}else assert.equal(body.output_config.format.type,'json_schema');
  if(calls===2)assert.deepEqual(body.output_config.format.schema.properties.recommendedProductId.enum,['keyboard','compact-keyboard','wired-keyboard']);
  assert.ok((body.tools??[]).every(t=>t.name==='compareProducts'));
  return Response.json({id:'msg_fixture',type:'message',role:'assistant',model:'claude-haiku-5-5',content:calls===1?[{type:'tool_use',id:'tool_compare',name:'compareProducts',input:{productIds:['keyboard','wired-keyboard']}}]:[{type:'text',text:JSON.stringify(proposal)}],stop_reason:calls===1?'tool_use':'end_turn',stop_sequence:null,usage:{input_tokens:10,output_tokens:20}});
 });
 const generated=await createCatalogAgent(model,products,'150.00',[],{anthropic:{thinking:{type:'disabled'},effort:'low',structuredOutputMode:'outputFormat'}}).generate({prompt:'Find a keyboard.'});
 assert.deepEqual(generated.output,proposal);assert.equal(calls,2);
});
