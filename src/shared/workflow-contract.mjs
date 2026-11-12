const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const strings=value=>Array.isArray(value)&&value.every(x=>typeof x==='string'&&x.length>0)&&new Set(value).size===value.length;
export const workflowLifecycle=Object.freeze(['task_created','understand_request','gather_details','retrieve_options','prepare_action','check_consent_and_authority','approval_if_required','execute_supported_operation','reconcile_outcome','record_evidence','notify_user']);
export function validateCatalog(catalog){
 if(!exact(catalog,['schemaVersion','catalogVersion','categories','families','lifecycle','boundary','workflows'])||catalog.schemaVersion!=='1.0'||
 catalog.catalogVersion!=='1.0.0'||!Array.isArray(catalog.categories)||!strings(catalog.families)||catalog.families.length!==7||
 !['agentpay','finance','banking','procurement','security','it_operations','sales_support'].every(id=>catalog.families.includes(id))||
 !strings(catalog.lifecycle)||catalog.lifecycle.join('/')!==workflowLifecycle.join('/')||typeof catalog.boundary!=='string'||!Array.isArray(catalog.workflows)||
 !catalog.categories.every(c=>exact(c,['id','name'])&&typeof c.id==='string'&&typeof c.name==='string'&&c.name.length>0)||new Set(catalog.categories.map(c=>c.id)).size!==catalog.categories.length)throw Error('INVALID_WORKFLOW_CATALOG');
 const ids=new Set(),categories=new Set(catalog.categories.map(x=>x.id));
 for(const w of catalog.workflows){
  if(!exact(w,['id','version','name','owner','audience','family','category','example','inputs','agentRoles','providers','resources','consent','composition','authority','operations','recovery','evidence','maturity'])||
   !/^[a-z][a-z0-9_-]+$/.test(w.id)||ids.has(w.id)||w.version!=='1.0.0'||!['consumer','enterprise'].includes(w.audience)||!categories.has(w.category)||
   (w.audience==='enterprise'?!catalog.families.includes(w.family):w.family!=='personal_assistant')||!exact(w.owner,['kind','binding'])||w.owner.kind!==(w.audience==='consumer'?'individual':'tenant')||w.owner.binding!=='authenticated_principal'||
   !exact(w.inputs,['required','accepted','planned'])||!['required','accepted','planned'].every(key=>strings(w.inputs[key]))||
   ![...w.inputs.accepted,...w.inputs.planned].every(type=>['text','link','image','api','event'].includes(type))||
   w.inputs.accepted.some(type=>w.inputs.planned.includes(type))||
   !Array.isArray(w.agentRoles)||w.agentRoles.length===0||!w.agentRoles.every(role=>exact(role,['role','permittedTools'])&&typeof role.role==='string'&&strings(role.permittedTools))||
   !['providers','resources','evidence'].every(key=>strings(w[key])&&w[key].length>0)||!['name','example','consent','recovery'].every(key=>typeof w[key]==='string'&&w[key].length>0)||
   !exact(w.authority,['mode','approval','runtime','delegation','executionBoundary'])||!['policy_required','exact_selection_review'].includes(w.authority.approval)||
   !Array.isArray(w.composition)||
   !exact(w.maturity,['implementation','local','deployed','provider','acceptanceJourney'])||
   !['planned','local_reference','local_assisted'].includes(w.maturity.implementation)||!['tested','not_verified'].includes(w.maturity.local)||w.maturity.deployed!=='not_verified'||w.maturity.provider!=='not_verified'||
   !(w.maturity.acceptanceJourney===null||typeof w.maturity.acceptanceJourney==='string')||
   !Array.isArray(w.operations)||!w.operations.length||new Set(w.operations.map(op=>op?.id)).size!==w.operations.length||!w.operations.every(op=>exact(op,['id','effect','implementation'])&&typeof op.id==='string'&&['read_only','assisted_handoff','protected_action'].includes(op.effect)&&['planned','local_reference'].includes(op.implementation)))throw Error(`INVALID_WORKFLOW_MANIFEST:${w?.id??'unknown'}`);
  if(w.authority.mode==='merchant_checkout'){
   if(w.audience!=='consumer'||w.authority.approval!=='exact_selection_review'||w.authority.runtime!==null||w.authority.delegation!=='none'||w.authority.executionBoundary!=='official_merchant'||w.operations.some(op=>op.effect==='protected_action'))throw Error('ASSISTED_AUTHORITY_BOUNDARY');
  }else if(w.authority.mode!=='canonical_signed_intent'||w.authority.approval!=='policy_required'||w.authority.runtime!=='/v1/runtime/evaluations'||w.authority.delegation!=='monotonic_signed_child_intents'||w.authority.executionBoundary!=='protected_destination')throw Error('CANONICAL_AUTHORITY_REQUIRED');
  if(w.maturity.implementation==='planned'&&(w.maturity.local!=='not_verified'||w.inputs.accepted.length||w.operations.some(op=>op.implementation!=='planned')))throw Error('PLANNED_WORKFLOW_NOT_EXECUTABLE');
  compileCoordination(w);
  ids.add(w.id);
 }
 return catalog;
}

export function compileCoordination(workflow){
 const roles=new Set(workflow.agentRoles.map(role=>role.role)),stages=workflow.composition;
 if(!Array.isArray(stages))throw Error('INVALID_COORDINATION');
 const ids=new Set();for(const stage of stages){
  if(!exact(stage,['id','role','requires','operation','failurePolicy'])||typeof stage.id!=='string'||ids.has(stage.id)||!roles.has(stage.role)||!strings(stage.requires)||
   !['prepare','protected_action','reconcile'].includes(stage.operation)||stage.failurePolicy!=='stop_and_reconcile')throw Error('INVALID_COORDINATION');
  ids.add(stage.id);
 }
 const ordered=[],visited=new Set(),visiting=new Set();
 function visit(stage){if(visiting.has(stage.id))throw Error('COORDINATION_CYCLE');if(visited.has(stage.id))return;
  visiting.add(stage.id);for(const dependency of stage.requires){const previous=stages.find(x=>x.id===dependency);if(!previous)throw Error('UNKNOWN_COORDINATION_DEPENDENCY');visit(previous);}
  visiting.delete(stage.id);visited.add(stage.id);ordered.push({...stage,authority:stage.operation==='protected_action'?'separate_canonical_signed_intent':'resource_scoped_read_or_observation'});
 }
 for(const stage of stages)visit(stage);
 return {workflowId:workflow.id,workflowVersion:workflow.version,mode:'planning_only',executionEnabled:false,
  identityBinding:'Each role requires an authenticated registered principal and an explicit tenant binding.',
  delegation:'Separate monotonic signed child intents; no union of participant authority.',stages:ordered};
}

export function visibleWorkflows(catalog,{audience='',category='',query=''}={}){
 validateCatalog(catalog);if(!['consumer','enterprise'].includes(audience))throw Error('WORKFLOW_AUDIENCE_REQUIRED');
 const search=query.toLowerCase().trim();return catalog.workflows.filter(w=>w.audience===audience&&(!category||w.category===category)&&
  (!search||`${w.name} ${w.example} ${w.family} ${w.resources.join(' ')}`.toLowerCase().includes(search)));
}

// Code-owned handlers, not manifest status or a model-generated plan, determine
// which preparation surfaces exist. This function never enables provider effects.
export function preparationPath(workflow,audience){
 if(audience==='consumer'&&workflow?.audience==='consumer'&&workflow.id==='social-shopping'&&workflow.version==='1.0.0')return '/shopping';
 return null;
}
