import {AIError} from './agent.mjs';

export function aiLimits(env=process.env){
 const read=(name,fallback)=>{
  const value=env[name];
  if(value===undefined||value==='')return fallback;
  if(!/^[1-9]\d*$/.test(value)||Number(value)>fallback)throw new AIError('AI_LIMITS_INVALID');
  return Number(value);
 };
 return {userHour:read('AGENTPAY_AI_USER_HOURLY_LIMIT',3),
  globalHour:read('AGENTPAY_AI_GLOBAL_HOURLY_LIMIT',10),
  globalDay:read('AGENTPAY_AI_GLOBAL_DAILY_LIMIT',25)};
}

export async function admitAiRequest(db,actor,limits){
 // The reservation and shared counts commit together before model I/O. An
 // in-process limiter would multiply the public spending allowance per replica.
 await db.query('SELECT pg_advisory_xact_lock(24981012)');
 const {rows:[counts]}=await db.query(`SELECT
  count(*) FILTER(WHERE tenant_id=$1 AND user_id=$2 AND created_at>now()-interval '1 hour')::int AS user_hour,
  count(*) FILTER(WHERE created_at>now()-interval '1 hour')::int AS global_hour,
  count(*) FILTER(WHERE created_at>now()-interval '24 hours')::int AS global_day,
  count(*) FILTER(WHERE state='GENERATING')::int AS active
  FROM ap_ai_proposals`,[actor.tenant_id,actor.user_id]);
 if(counts.user_hour>=limits.userHour||counts.global_hour>=limits.globalHour||counts.global_day>=limits.globalDay)
  throw new AIError('AI_RATE_LIMIT',429);
 // An unresolved generation may already have cost money. A process restart
 // must not clear its reservation and silently start another paid request.
 if(counts.active>0)throw new AIError('AI_BUSY',429);
}
