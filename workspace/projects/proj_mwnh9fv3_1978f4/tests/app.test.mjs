import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, routeRequest } from '../src/app.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const store = createStore();
const health = routeRequest('GET', '/api/health', {}, store);
assert.equal(health.status, 200);
assert.equal(health.body.status, 'ok');

const created = routeRequest('POST', '/api/items', { title: 'Verified item', category: "operations", value: 42 }, store);
assert.equal(created.status, 201);
assert.equal(created.body.item.title, 'Verified item');

const updated = routeRequest('PATCH', '/api/items/' + created.body.item.id, { status: 'VERIFIED' }, store);
assert.equal(updated.status, 200);
assert.equal(updated.body.item.status, 'VERIFIED');

const bad = routeRequest('POST', '/api/items', { title: '' }, store);
assert.equal(bad.status, 400);

const userCreated = routeRequest('POST', '/api/users', { name: 'QA Tester', email: 'qa@example.com', role: 'member' }, store);
assert.equal(userCreated.status, 201);

const summary = routeRequest('GET', '/api/summary', {}, store);
assert.equal(summary.status, 200);
assert.equal(summary.body.summary.totalItems, 1);
assert.equal(summary.body.summary.verifiedItems, 1);

const html = fs.readFileSync(path.resolve(__dirname, '../public/index.html'), 'utf8');
assert.ok(html.includes('id="record-form"') && html.includes('id="records-tbody"'), 'Interactive UI form & table must exist');
assert.ok(html.includes('data-view="analytics"') && html.includes('data-view="users"'), 'Multi-view navigation must exist');
console.log('ALL_TESTS_PASSED: 7/7 application, persistence & UI contract assertions verified');
