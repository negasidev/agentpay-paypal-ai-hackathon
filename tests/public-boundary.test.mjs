import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {auditPublicFiles} from '../scripts/public-boundary.mjs';

test('release audit rejects leaked inputs without echoing their contents',()=>{
 const root=mkdtempSync(join(tmpdir(),'public-boundary-'));
 try{
  const secret='sk_live_'+ 'x'.repeat(28);
  const files={'.env.local':'TOKEN='+secret,'notes.md':'See '+['C:','Users','developer','project'].join('\\'),
   'package.json':JSON.stringify({dependencies:{sdk:'file:../private-sdk'}}),
   'module.mjs':"import '../private-project/server.mjs';\nconst fixture=new URL('../private-project/fixture.json',import.meta.url);"};
  for(const [path,content] of Object.entries(files))writeFileSync(join(root,path),content);
  const findings=auditPublicFiles(root,Object.keys(files));
  for(const rule of ['PRIVATE_RELEASE_FILE','PROVIDER_TOKEN','WORKSTATION_PATH','EXTERNAL_PACKAGE_DEPENDENCY','EXTERNAL_SOURCE_IMPORT','EXTERNAL_SOURCE_RESOURCE'])assert(findings.some(f=>f.rule===rule),rule);
  assert(!JSON.stringify(findings).includes(secret));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('public SDK files and documented local evaluation need no sibling checkout',()=>{
 const root=mkdtempSync(join(tmpdir(),'public-boundary-'));
 try{
  mkdirSync(join(root,'vendor','sdk'),{recursive:true});
  const files={'package.json':JSON.stringify({dependencies:{sdk:'file:./vendor/sdk'}}),
   'module.mjs':"import './vendor/sdk/index.mjs'; const vectors=new URL('./vectors.json',import.meta.url);",
   'vendor/sdk/index.mjs':'export const ready=true;', 'vectors.json':'{}',
   '.env.example':'DATABASE_URL=postgresql://demo:local-only@127.0.0.1:5432/evaluation',
   'patterns.mjs':String.raw`const controls=/[\u0000-\u001f]/;`,
   'README.md':'Run the application at http://localhost:3006.'};
  for(const [path,content] of Object.entries(files))writeFileSync(join(root,path),content);
  assert.deepEqual(auditPublicFiles(root,Object.keys(files)),[]);
  writeFileSync(join(root,'module.mjs'),"import './missing.mjs';");
  assert(auditPublicFiles(root,['module.mjs']).some(f=>f.rule==='MISSING_SOURCE_IMPORT'));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('public docs cannot link outside the download or silently carry private diagnostics',()=>{
 const root=mkdtempSync(join(tmpdir(),'public-boundary-'));
 try{
  const files={'README.md':'[operator notes](../operations/report.md)\n[missing](missing.md)',
   'AI_CONTEXT.json':JSON.stringify({entrypoints:{guide:'../operations/guide.md'}}),
   'operator.private.env':'TOKEN=synthetic', 'runtime.log':'synthetic log',
   'package.json':JSON.stringify({dependencies:{sdk:'git+'+'ssh://git@example.test/sdk.git'}})};
  for(const [path,content] of Object.entries(files))writeFileSync(join(root,path),content);
  const findings=auditPublicFiles(root,Object.keys(files));
  for(const rule of ['EXTERNAL_DOCUMENT_LINK','MISSING_DOCUMENT_LINK','PRIVATE_RELEASE_FILE','AUTHENTICATED_PACKAGE_DEPENDENCY'])assert(findings.some(f=>f.rule===rule),rule);
  writeFileSync(join(root,'README.md'),'[guide](guide.md)\n[public provider](https://example.test/docs)');
  writeFileSync(join(root,'guide.md'),'Independent guide.');
  writeFileSync(join(root,'AI_CONTEXT.json'),JSON.stringify({entrypoints:{guide:'guide.md'}}));
  assert.deepEqual(auditPublicFiles(root,['README.md','guide.md','AI_CONTEXT.json']),[]);
  writeFileSync(join(root,'notes.md'),['D:','scratch','operator.txt'].join('\\'));
  assert(auditPublicFiles(root,['notes.md']).some(f=>f.rule==='WORKSTATION_PATH'));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('credential examples refuse unprefixed secrets and remote database credentials',()=>{
 const root=mkdtempSync(join(tmpdir(),'public-boundary-'));
 try{
  for(const content of ['PAYPAL_SANDBOX_CLIENT_SECRET=unprefixed-secret',
   'DATABASE_URL=postgresql://operator:unprefixed-secret@database.example.test/demo']){
   writeFileSync(join(root,'.env.example'),content);
   assert(auditPublicFiles(root,['.env.example']).some(f=>f.rule==='POPULATED_CREDENTIAL_TEMPLATE'));
  }
  writeFileSync(join(root,'.env.example'),'PAYPAL_SANDBOX_CLIENT_SECRET=\nDATABASE_URL=postgresql://agentpay:change-me@127.0.0.1:5454/agentpay_hackathon_judges');
  assert.deepEqual(auditPublicFiles(root,['.env.example']),[]);
 }finally{rmSync(root,{recursive:true,force:true});}
});
