export const products=Object.freeze([
 {id:'keyboard',name:'Ergonomic wireless keyboard',amount:'119.00',currency:'USD',features:['wireless','ergonomic'],description:'Split layout and wireless connectivity for office typing.',available:true},
 {id:'compact-keyboard',name:'Compact wireless keyboard',amount:'79.00',currency:'USD',features:['wireless','compact'],description:'A smaller wireless keyboard with a conventional layout.',available:true},
 {id:'wired-keyboard',name:'Wired ergonomic keyboard',amount:'99.00',currency:'USD',features:['wired','ergonomic'],description:'Ergonomic layout with a wired USB connection.',available:true},
 {id:'premium-keyboard',name:'Premium ergonomic wireless keyboard',amount:'179.00',currency:'USD',features:['wireless','ergonomic','premium'],description:'Wireless ergonomic layout with premium construction.',available:true},
].map(product=>Object.freeze({...product,features:Object.freeze(product.features)})));
export function cents(value){if(typeof value!=='string'||! /^(?:0|[1-9]\d{0,6})\.\d{2}$/.test(value))throw new Error('INVALID_BUDGET');return Number(value.replace('.',''));}
export function decimal(value){return `${Math.floor(value/100)}.${String(value%100).padStart(2,'0')}`;}
export function productById(id,permitted=products){return permitted.find(product=>product.id===id&&product.available);}
export function effectiveBudget(instruction,budget){
 let maximum=cents(budget);if(maximum<=0)throw new Error('INVALID_BUDGET');
 // A model cannot loosen an explicit dollar ceiling written in the instruction.
 for(const match of instruction.matchAll(/\$(\d+(?:\.\d{1,2})?)\b|\b(\d+(?:\.\d{1,2})?)\s*USD\b/gi)){
  const value=match[1]??match[2];const parts=value.split('.');const normalized=`${parts[0]}.${(parts[1]??'').padEnd(2,'0')}`;
  maximum=Math.min(maximum,cents(normalized));
 }
 if(maximum<=0)throw new Error('INVALID_BUDGET');return decimal(maximum);
}
export function catalogTools(permitted,budget){
 const eligible=permitted.filter(product=>product.available&&cents(product.amount)<=cents(budget));
 return {
 search:query=>eligible.filter(product=>query.toLowerCase().split(/\s+/).filter(Boolean).some(word=>`${product.name} ${product.description}`.toLowerCase().includes(word))),
 details:id=>{const product=eligible.find(p=>p.id===id);if(!product)throw new Error('UNKNOWN_ITEM');return product;},
 compare:ids=>ids.map(id=>{const p=eligible.find(p=>p.id===id);if(!p)throw new Error('UNKNOWN_ITEM');return p;}),
 evaluate:(id,quantity)=>{const product=eligible.find(p=>p.id===id);if(!product||!Number.isInteger(quantity)||quantity<1||quantity>3)throw new Error('INVALID_PROPOSAL');return {productId:id,total:decimal(cents(product.amount)*quantity),withinBudget:cents(product.amount)*quantity<=cents(budget)};},
 };
}
