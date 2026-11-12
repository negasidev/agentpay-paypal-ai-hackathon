import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../../src/shared/workflow-catalog.json' with {type:'json'};
import {validateCatalog,visibleWorkflows,preparationPath} from '../../src/shared/workflow-contract.mjs';
test('standalone AgentPay package validates its included manifests and never starts a planned provider or enterprise workflow',()=>{
 validateCatalog(catalog);
 for(const w of visibleWorkflows(catalog,{audience:'consumer'}))assert.equal(preparationPath(w,'consumer'),w.id==='social-shopping'?'/shopping':null);
 for(const w of visibleWorkflows(catalog,{audience:'enterprise'}))assert.equal(preparationPath(w,'enterprise'),null);
});
