export function safeApplicationDestination(value,fallback='/shopping'){
 try{
  const url=new URL(value,'https://agentpay.invalid');
  const allowed=/^\/(shopping|workflows|assistant|review|approvals|checkout|transactions)(\/[^/?#]+)?$/.test(url.pathname)||
   /^\/shopping\/tasks\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(url.pathname)||url.pathname==='/enterprise/workspace'||url.pathname==='/demo';
  return url.origin==='https://agentpay.invalid'&&allowed?url.pathname+url.search:fallback;
 }catch{return fallback;}
}
