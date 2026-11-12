import test from 'node:test';
import assert from 'node:assert/strict';
import {safeApplicationDestination} from '../../src/shared/navigation.mjs';
test('task and enterprise sign-in continuations stay on registered local routes without fragments',()=>{
 const id='11111111-1111-1111-1111-111111111111';
 for(const path of [`/shopping/tasks/${id}`,`/checkout/${id}`,'/enterprise/workspace','/demo'])assert.equal(safeApplicationDestination(path+'#private'),path);
 for(const path of ['https://attacker.invalid/enterprise/workspace','//attacker.invalid/shopping','/shopping/tasks/not-a-task','/enterprise/administration','/api/session','https://attacker.invalid/demo','/demo/admin'])assert.equal(safeApplicationDestination(path),'/shopping');
});
