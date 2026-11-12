import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('judge provider command refuses implicit provider calls, other databases and enabled capture',()=>{
 for(const [args,environment,expected] of [
  [[],{},'EXPLICIT_PROVIDERS_FLAG_REQUIRED'],
  [['--providers'],{DATABASE_URL:'postgresql://localhost/production'},'ISOLATED_HACKATHON_DATABASE_REQUIRED'],
  [['--providers'],{DATABASE_URL:'postgresql://localhost/agentpay_hackathon_test',AGENTPAY_PROTECTED_CAPTURE_ENABLED:'true'},'CAPTURE_MUST_REMAIN_DISABLED'],
 ]){
  const result=spawnSync(process.execPath,['scripts/verify-hackathon.mjs',...args],{encoding:'utf8',env:{...process.env,...environment},windowsHide:true});
  assert.notEqual(result.status,0);assert.match(result.stderr,new RegExp(expected));
 }
});
