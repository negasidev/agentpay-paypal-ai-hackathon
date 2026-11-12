const guid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const applications = new Set(['login', 'console', 'agentpay', 'vault', 'owner', 'mobile', 'developer']);
const operations = new Set(['open_personal_vault', 'open_purchase_workspace', 'review_action', 'review_account_setup', 'review_access', 'reconcile_lifecycle']);
const fields = ['version', 'kind', 'id', 'principalId', 'tenantId', 'sourceApplication', 'destinationApplication', 'operation', 'issuedAt', 'expiresAt', 'returnDestination', 'grantsAuthority'].sort().join(',');
function destination(value) {
  const url = new URL(value);
  if (url.username || url.password || url.hash || url.search ||
      url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))
    throw Error('Continuation destination refused');
  return url.href;
}
export function validateTaskContinuation(value) {
  if (!value || Object.keys(value).sort().join(',') !== fields || value.version !== 1 || value.kind !== 'navigation_continuation' ||
      value.grantsAuthority !== false || ![value.id, value.principalId, value.tenantId].every(id => typeof id === 'string' && guid.test(id)) ||
      !applications.has(value.sourceApplication) || !applications.has(value.destinationApplication) || !operations.has(value.operation) ||
      !Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.expiresAt) || value.issuedAt < 0 ||
      value.expiresAt <= value.issuedAt || value.expiresAt - value.issuedAt > 300000 || typeof value.returnDestination !== 'string' ||
      value.returnDestination.length > 2048 || destination(value.returnDestination) !== value.returnDestination)
    throw Error('Invalid navigation continuation');
  return Object.freeze({...value});
}
export function createTaskContinuation({id, principalId, tenantId, sourceApplication, destinationApplication, operation, returnDestination, issuedAt, expiresAt}) {
  return validateTaskContinuation({version: 1, kind: 'navigation_continuation', id, principalId, tenantId, sourceApplication,
    destinationApplication, operation, issuedAt, expiresAt, returnDestination: destination(returnDestination), grantsAuthority: false});
}
export function requireCurrentContinuation(value, current) {
  const record = validateTaskContinuation(value);
  if (!current || !Number.isSafeInteger(current.now) || current.now < record.issuedAt || current.now >= record.expiresAt ||
      ['principalId', 'tenantId', 'sourceApplication', 'destinationApplication', 'operation', 'returnDestination'].some(field => current[field] !== record[field]))
    throw Error('Current continuation context refused');
  return record;
}

export function experienceStatus({kind, status, destinationConfirmed = false}) {
  const base = {grantsAuthority: false, destinationConfirmed: false};
  if (kind === 'Decision') return {...base, label: status === 'DENY' ? 'Refused' : ['ALLOW', 'REQUIRE_APPROVAL'].includes(status) ? 'Pending' : 'Needs Investigation',
    detail: status === 'ALLOW' ? 'Policy allowed the request; protected execution is still required.' : status === 'DENY' ? 'The policy refused this request.' : 'A current decision or approval is required.'};
  if (kind === 'Receipt') return {...base, label: status === 'Succeeded' && destinationConfirmed === true ? 'Completed' : 'Needs Investigation',
    destinationConfirmed: status === 'Succeeded' && destinationConfirmed === true,
    detail: destinationConfirmed === true && status === 'Succeeded' ? 'The destination outcome was confirmed for this record.' : 'A reported outcome is not destination confirmation. Reconcile before retrying.'};
  const pending = {Approval: ['Pending', 'Requested'], AccountSetup: ['Registered', 'PendingVerification', 'UnderReview'],
    AccessReview: ['Requested'], LifecycleReview: ['Applying'], Contract: ['Active', 'Paused', 'Draft']};
  const completed = {Approval: ['Approved'], AccountSetup: ['Active'], AccessReview: ['Certified']};
  const refused = {Approval: ['Denied', 'Rejected', 'Expired', 'Cancelled'], AccountSetup: ['Rejected', 'Suspended'], AccessReview: ['Rejected', 'Expired'], Contract: ['Revoked', 'Expired']};
  const label = pending[kind]?.includes(status) ? 'Pending' : completed[kind]?.includes(status) ? 'Completed'
    : refused[kind]?.includes(status) ? 'Refused' : 'Needs Investigation';
  return {...base, label, detail: kind === 'Approval' && label === 'Completed' ? 'Approval was recorded; current action authority and destination execution are still required.'
    : kind === 'AccountSetup' && label === 'Completed' ? 'Account setup completed; this grants no action authority.'
    : label === 'Needs Investigation' ? 'The current source state or outcome needs review.' : 'This label describes this source record only; it grants no authority.'};
}
