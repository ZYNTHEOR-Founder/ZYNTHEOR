// Standalone Unit Test Suite for /workspace/src/core.js
import assert from 'node:assert/strict';
import { computeDigestManifest, sumAmounts } from '../src/core.js';

const m = computeDigestManifest(['plan', '  ', 'build', 'verify']);
assert.equal(m.count, 3);
assert.equal(m.sha256.length, 64);
assert.equal(sumAmounts([10.5, 20.25, 9.25]), 40);
console.log('UNIT_TESTS_PASSED: 2/2 assertions OK');
