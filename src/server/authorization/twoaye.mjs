import {VeridAgentClient,VeridGrantVerifier,canonicalizeEnvelope} from '@verid/agent-sdk';
export class AuthorityUnavailable extends Error {
  constructor(code){super(code);this.code=code;}
}
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(value);
export function purchaseEnvelope(binding,config){
  if(!binding||!id(binding.purchaseId)||!id(binding.providerOrderId)||!id(binding.executionId)||
    !id(binding.merchantId)||binding.currency!=='USD'||typeof binding.amount!=='string'||
    !/^(?:0|[1-9]\d{0,6})\.\d{2}$/.test(binding.amount)||Number(binding.amount)<=0||
    binding.tenantId!==config.tenantId||!id(binding.principalId)||!id(binding.localTenantId)||
    !Number.isInteger(binding.purchaseVersion)||binding.purchaseVersion<1||
    (binding.quoteDigest!=null&&!/^[a-f0-9]{64}$/.test(binding.quoteDigest)))throw new AuthorityUnavailable('INVALID_AUTHORITY_BINDING');
  return {schemaVersion:'1.0',agentId:config.agentId,tool:config.tool,action:config.action,
    environment:'development',requestedAt:new Date().toISOString(),predicates:[
      {type:'amount',currency:binding.currency,value:binding.amount},
      {type:'counterparty_reference',value:binding.merchantId},
      {type:'resource_reference',resourceType:'commerce.order',namespace:'paypal/sandbox',resourceId:binding.providerOrderId},
      {type:'resource_reference',resourceType:'commerce.order',namespace:'agentpay/purchase',resourceId:binding.purchaseId},
      {type:'resource_reference',resourceType:'commerce.order',namespace:'agentpay/execution',resourceId:binding.executionId},
      {type:'resource_reference',resourceType:'identity.principal',namespace:'agentpay/owner',resourceId:binding.principalId},
      {type:'resource_reference',resourceType:'identity.tenant',namespace:'agentpay/tenant',resourceId:binding.localTenantId},
      {type:'resource_version',versionType:'record_version',value:String(binding.purchaseVersion)},
      ...(binding.quoteDigest?[{type:'resource_reference',resourceType:'commerce.quote',namespace:'agentpay/quote',resourceId:binding.quoteDigest}]:[]),
    ]};
}
export class TwoayeAuthorityAdapter {
  constructor(config){
    for(const field of ['baseUrl','tenantId','agentId','intentId','tool','action','accessToken'])
      if(typeof config[field]!=='string'||!config[field])throw new AuthorityUnavailable('AUTHORITY_NOT_CONFIGURED');
    this.config={...config};this.client=new VeridAgentClient(config);
    this.verifier=new VeridGrantVerifier(config);
  }
  coveredEnvelope(binding){
    const envelope=purchaseEnvelope(binding,this.config);
    // Removing resource references would turn an integration incompatibility
    // into reusable payment authority. Never downgrade to amount-only grants.
    try{canonicalizeEnvelope(envelope);}catch{throw new AuthorityUnavailable('SDK_RESOURCE_BINDING_UNSUPPORTED');}
    return envelope;
  }
  async evaluate(binding){
    const envelope=this.coveredEnvelope(binding);
    return this.evaluateEnvelope(envelope);
  }
  async evaluateEnvelope(envelope){
    try{canonicalizeEnvelope(envelope);}catch{throw new AuthorityUnavailable('SDK_RESOURCE_BINDING_UNSUPPORTED');}
    return this.client.request('/v1/runtime/evaluations',{method:'POST',body:JSON.stringify({
      tenantId:this.config.tenantId,intentId:this.config.intentId,...envelope,
    })});
  }
  async verify(binding,authorizationId){
    if(!id(authorizationId))throw new AuthorityUnavailable('INVALID_AUTHORIZATION_ID');
    const envelope=this.coveredEnvelope(binding);
    return this.verifyEnvelope(envelope,authorizationId,this.config.intentVersion);
  }
  async verifyEnvelope(envelope,authorizationId,intentVersion){
    if(!id(authorizationId)||!Number.isInteger(intentVersion)||intentVersion<1)throw new AuthorityUnavailable('INVALID_AUTHORITY_BINDING');
    try{canonicalizeEnvelope(envelope);}catch{throw new AuthorityUnavailable('SDK_RESOURCE_BINDING_UNSUPPORTED');}
    const grant=await this.client.authorizationById(authorizationId);
    if(grant.intentVersion!==intentVersion)throw new AuthorityUnavailable('INTENT_VERSION_MISMATCH');
    await this.verifier.refreshKeys();
    await this.verifier.verify(grant,{tenantId:this.config.tenantId,agentId:this.config.agentId,
      intentId:this.config.intentId,envelope});
    return {grant,envelope};
  }
  async approval(approvalId){
    if(!id(approvalId))throw new AuthorityUnavailable('INVALID_APPROVAL_ID');
    return this.client.request(`/v1/runtime/approvals/${encodeURIComponent(approvalId)}?tenantId=${encodeURIComponent(this.config.tenantId)}`);
  }
  async consumeEnvelope(envelope,authorizationId,intentVersion){
    await this.verifyEnvelope(envelope,authorizationId,intentVersion);
    return this.client.consume({authorizationId,agentId:this.config.agentId,envelope});
  }
  async receiptFor(authorizationId){
    const receipts=await this.client.request(`/v1/intents/${encodeURIComponent(this.config.intentId)}/receipts?tenantId=${encodeURIComponent(this.config.tenantId)}`);
    if(!Array.isArray(receipts))throw new AuthorityUnavailable('INVALID_RECEIPT_RESPONSE');
    return receipts.find(receipt=>receipt.authorizationId===authorizationId)??null;
  }
  async recordReceipt(authorizationId,envelope,captureId,evidence){
    return this.client.submitReceipt({authorizationId,status:'Succeeded',externalReference:captureId,evidence,executed:envelope});
  }
  // Call only after a recoverable uniquely keyed attempt has committed.
  async consume(binding,authorizationId){
    const {envelope}=await this.verify(binding,authorizationId);
    return this.client.consume({authorizationId,agentId:this.config.agentId,envelope});
  }
}
