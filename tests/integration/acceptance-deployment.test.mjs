import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const cwd=new URL('../../',import.meta.url);
function run(script,args=[],env={}){return spawnSync(process.execPath,[script,...args],{cwd,encoding:'utf8',windowsHide:true,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,...env}});}
test('canonical acceptance preflight does not demand a static bearer or claim a checked session',()=>{
 const legacy=run('scripts/m2-preflight.mjs');assert.equal(legacy.status,1);
 assert.ok(JSON.parse(legacy.stdout).missing.authority.includes('AUTHORITY_ACCESS_TOKEN'));
 const canonical=run('scripts/m2-preflight.mjs',[],{AGENTPAY_CANONICAL_REQUIRED:'true'});
 const report=JSON.parse(canonical.stdout);assert.equal(canonical.status,1);
 assert.equal(report.authorityCredential,'VALIDATED_CANONICAL_SESSION_REQUIRED');
 assert.ok(!report.missing.authority.includes('AUTHORITY_ACCESS_TOKEN'));
 assert.ok(report.invalid.includes('CANONICAL_IDENTITY_CONFIGURATION'));assert.equal(report.configured,false);
 const reference=JSON.parse(run('scripts/m2-preflight.mjs',['--reference'],{AGENTPAY_CANONICAL_REQUIRED:'true'}).stdout);
 assert.deepEqual(reference.missing.ai,[]);assert.ok(!reference.invalid.includes('AGENTPAY_AI_PROVIDER_OR_MODEL'));
 assert.equal(reference.configured,false);
});
test('acceptance verifier refuses absent human session without capture and retains a failed evidence record',()=>{
 const directory=mkdtempSync(join(tmpdir(),'agentpay-acceptance-test-'));
 if(!directory.startsWith(join(tmpdir(),'agentpay-acceptance-test-')))throw Error('TEMP_CLEANUP_BOUNDARY');
 try{
  const output=join(directory,'evidence.json');
  const result=run('scripts/verify-acceptance.mjs',['11111111-1111-1111-1111-111111111111',output],{APP_ORIGIN:'http://127.0.0.1:3516'});
  assert.equal(result.status,1);const report=JSON.parse(readFileSync(output,'utf8'));
  assert.equal(report.passed,false);assert.equal(report.providerEffect,'NOT_OBSERVED');
  assert.equal(report.observations[0].result,'FAIL');
  assert.equal(report.physicalPresenceIndependentlyVerified,false);
 }finally{rmSync(directory,{recursive:true});}
});
test('release packager refuses branch names instead of exporting mutable source',()=>{
 const result=run('scripts/package-acceptance.mjs',['main','main','unused']);
 assert.equal(result.status,1);assert.match(result.stderr,/EXACT_COMMITS_AND_NEW_DESTINATION_REQUIRED/);
});
