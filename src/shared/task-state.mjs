const labels=Object.freeze({OPTIONS_READY:'Options ready for review',REVIEW_READY:'Selection ready for your review',
 HANDOFF_READY:'Official merchant link ready',PURCHASE_PREPARED:'Reference purchase prepared; approval and payment still required',CANCELED:'Task canceled',EXPIRED:'Task expired',
 DISCOVERY_UNCERTAIN:'Discovery outcome unresolved',DISCOVERY_FAILED:'Discovery unavailable'});
export function taskStateText(state){return Object.hasOwn(labels,state)?labels[state]:'Task status unavailable';}
