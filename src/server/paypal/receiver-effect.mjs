import {createPrivateKey, createPublicKey, sign, verify} from 'node:crypto';
import {readFileSync} from 'node:fs';

const fields=['format','tenantId','purchaseId','intentVersion','intentHash','authorizationId','attemptId','requestId','orderId','captureId','merchantId','amount','currency','status','verifiedAt'];
const statement=e=>Buffer.from(JSON.stringify(['agentpay.receiver-effect.v1',...fields.map(k=>[k,e[k]])]),'utf8');
const keyFor=(value,type)=>{
 const key=type==='private'?createPrivateKey(value):createPublicKey(value);
 if(key.asymmetricKeyType!=='ec'||key.asymmetricKeyDetails?.namedCurve!=='prime256v1')throw new Error('RECEIVER_KEY_INVALID');
 return key;
};

export function signReceiverEffect(e,env=process.env){
 if(!env.AGENTPAY_RECEIVER_SIGNING_KEY_FILE)return e;
 if(!env.AGENTPAY_RECEIVER_KEY_ID||fields.some(k=>e[k]===null||e[k]===undefined))throw new Error('RECEIVER_BINDING_REQUIRED');
 const key=keyFor(readFileSync(env.AGENTPAY_RECEIVER_SIGNING_KEY_FILE),'private');
 return {...e,receiverEffect:{format:'agentpay.receiver-effect.v1',keyId:env.AGENTPAY_RECEIVER_KEY_ID,
  signature:sign('sha256',statement(e),{key,dsaEncoding:'ieee-p1363'}).toString('base64url')}};
}

export function verifyReceiverEffect(e,env=process.env){
 const proof=e?.receiverEffect;
 if(!proof||!env.AGENTPAY_RECEIVER_PUBLIC_KEY_FILE||!env.AGENTPAY_RECEIVER_KEY_ID)return false;
 if(proof.format!=='agentpay.receiver-effect.v1'||proof.keyId!==env.AGENTPAY_RECEIVER_KEY_ID||
    typeof proof.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(proof.signature)||fields.some(k=>e[k]===null||e[k]===undefined))return false;
 try{
  const key=keyFor(readFileSync(env.AGENTPAY_RECEIVER_PUBLIC_KEY_FILE),'public');
  return verify('sha256',statement(e),{key,dsaEncoding:'ieee-p1363'},Buffer.from(proof.signature,'base64url'));
 }catch{return false;}
}
