import {createHash} from 'node:crypto';
import {authorityConfig} from '../authorization/requests.mjs';
import {TwoayeAuthorityAdapter} from '../authorization/twoaye.mjs';
export async function recordPlatformReceipt(pool,actor,attemptId,config=authorityConfig(actor)){
 if(!config)throw new Error('AUTHORITY_NOT_CONFIGURED');
 const db=await pool.connect();let locked=false;
 try{
  await db.query('SELECT pg_advisory_lock(hashtextextended($1,11))',[attemptId]);locked=true;
  const row=(await db.query(`SELECT receipt.id,receipt.evidence,receipt.provider_capture_id,a.authority_envelope,a.authority_grant,a.authority_consumed_at,a.state
  FROM ap_receipts receipt JOIN ap_attempts a ON a.id=receipt.attempt_id AND a.tenant_id=receipt.tenant_id AND a.user_id=receipt.user_id
  WHERE a.id=$1 AND a.tenant_id=$2 AND a.user_id=$3`,[attemptId,actor.tenant_id,actor.user_id])).rows[0];
  if(!row||row.state!=='COMPLETED'||!row.authority_consumed_at||!row.authority_envelope||!row.authority_grant)throw new Error('ORIGINAL_AUTHORIZATION_BINDING_REQUIRED');
  const grant=row.authority_grant;
  if(grant.tenantId!==config.tenantId||grant.intentId!==config.intentId||grant.agentId!==config.agentId||grant.intentVersion!==config.intentVersion)throw new Error('INVALID_AUTHORITY_BINDING');
  const adapter=new TwoayeAuthorityAdapter(config);const evidence=JSON.stringify(row.evidence);
  // Read before writing: a lost receipt response must recover the one canonical
  // record rather than overwrite the outcome or initiate another payment.
  let receipt=await adapter.receiptFor(grant.id);
  if(!receipt)receipt=await adapter.recordReceipt(grant.id,row.authority_envelope,row.provider_capture_id,evidence);
  const expected=createHash('sha256').update(evidence).digest('hex').toUpperCase();
  if(receipt.tenantId!==config.tenantId||receipt.authorizationId!==grant.id||receipt.intentId!==config.intentId||receipt.intentVersion!==grant.intentVersion||receipt.status!=='Succeeded'||receipt.comparison!=='Matched'||receipt.externalReference!==row.provider_capture_id||receipt.evidenceHash?.toUpperCase()!==expected)throw new Error('PLATFORM_RECEIPT_MISMATCH');
  await db.query('UPDATE ap_receipts SET platform_receipt=$2 WHERE id=$1',[row.id,JSON.stringify(receipt)]);
  return {status:'RECORDED',signatureVerified:false};
 }finally{try{if(locked)await db.query('SELECT pg_advisory_unlock(hashtextextended($1,11))',[attemptId]);}finally{db.release();}}
}
