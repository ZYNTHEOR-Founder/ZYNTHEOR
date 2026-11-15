import assert from 'node:assert/strict';
import { createStore, routeRequest } from '../src/app.mjs';

const store = createStore();
const health = routeRequest('GET', '/api/health', {}, store);
assert.equal(health.status, 200);
assert.equal(health.body.status, 'ok');

const created = routeRequest('POST', '/api/items', { title: 'Verified item', category: 'audit' }, store);
assert.equal(created.status, 201);
assert.equal(created.body.item.title, 'Verified item');

const bad = routeRequest('POST', '/api/items', { title: '' }, store);
assert.equal(bad.status, 400);

const list = routeRequest('GET', '/api/items', {}, store);
assert.equal(list.status, 200);
assert.equal(list.body.items.length, 1);
console.log('ALL_TESTS_PASSED: 4/4 assertions verified');
