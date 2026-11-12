import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalizeEnvelope} from '../src/index.js';
const envelope={schemaVersion:'1.0',agentId:'agent-1',tool:'paypal',action:'capture',environment:'development',predicates:[{type:'resource_version',versionType:'record_version',value:'3'}]};
test('resource version uses canonical platform keys and preserves opaque case',()=>{
 assert.ok(canonicalizeEnvelope(envelope).includes('{"type":"resource_version","version":"3","version_type":"record_version"}'));
 assert.equal(canonicalizeEnvelope(envelope),canonicalizeEnvelope({...envelope,predicates:[{type:'resource_version',version_type:'record_version',version:'3'}]}));
 assert.notEqual(canonicalizeEnvelope(envelope),canonicalizeEnvelope({...envelope,predicates:[{type:'resource_version',versionType:'record_version',value:'4'}]}));
 for(const predicate of [{type:'resource_version',versionType:'unknown',value:'3'},{type:'resource_version',versionType:'record_version',value:3},{type:'resource_version',versionType:'record_version',value:'3',version:'4'}])assert.throws(()=>canonicalizeEnvelope({...envelope,predicates:[predicate]}));
});
