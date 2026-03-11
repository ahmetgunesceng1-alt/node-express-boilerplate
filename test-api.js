const http = require('http');
const assert = require('assert');

// Base URL for the API under test. Ensure your server is running on this port.
const BASE = 'http://localhost:3001';
const TIMEOUT_MS = 10000;
let passed = 0;
let failed = 0;

function makeRequest(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        const contentType = res.headers['content-type'] || '';
        try {
          const parsed = data ? JSON.parse(data) : data;
          resolve({ status: res.statusCode, body: parsed, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, body: data, headers: res.headers });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('Starting API tests against', BASE);

  // Test 1: Happy path - register
  try {
    const payload = { name: 'Test User', email: 'test.user+node@test.local', password: 'P@ssw0rd123' };
    const res = await makeRequest('POST', '/v1/auth/register', payload);
    try {
      assert.strictEqual(res.status, 201, `Expected 201 Created, got ${res.status}`);
      const ct = (res.headers['content-type'] || '').toLowerCase();
      assert.ok(ct.includes('application/json'), `Expected Content-Type application/json, got ${res.headers['content-type']}`);
      assert.ok(res.body && typeof res.body === 'object', 'Expected JSON body object');
      console.log('✓ Happy path: POST /v1/auth/register returned 201 and JSON');
      passed++;
    } catch (err) {
      console.error('✗ Happy path: POST /v1/auth/register failed -', err.message);
      failed++;
    }
  } catch (err) {
    console.error('✗ Happy path: Could not connect to server or request failed -', err.message);
    failed++;
  }

  // Test 2: Invalid/missing body -> expect 400 or 422
  try {
    const res = await makeRequest('POST', '/v1/auth/register', null);
    try {
      const ok = res.status === 400 || res.status === 422;
      assert.ok(ok, `Expected 400 or 422 for invalid/missing body, got ${res.status}`);
      console.log('✓ Invalid body: server returned expected client error for missing/invalid body ->', res.status);
      passed++;
    } catch (err) {
      console.error('✗ Invalid body: Unexpected response -', err.message);
      failed++;
    }
  } catch (err) {
    console.error('✗ Invalid body: Request failed -', err.message);
    failed++;
  }

  // Test 3: Not found route
  try {
    const res = await makeRequest('GET', '/v1/auth/nonexistent', null);
    try {
      assert.strictEqual(res.status, 404, `Expected 404 for nonexistent route, got ${res.status}`);
      console.log('✓ Not found: GET /v1/auth/nonexistent returned 404');
      passed++;
    } catch (err) {
      console.error('✗ Not found: Unexpected response -', err.message);
      failed++;
    }
  } catch (err) {
    console.error('✗ Not found: Request failed -', err.message);
    failed++;
  }

  // Summary
  console.log('\nTest summary: Passed:', passed, 'Failed:', failed);
}

// Timeout guard
const timeout = setTimeout(() => {
  console.error('✗ Tests timed out');
  process.exit(1);
}, TIMEOUT_MS);

runTests()
  .then(() => {
    clearTimeout(timeout);
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch((err) => {
    clearTimeout(timeout);
    console.error(err);
    process.exit(1);
  });
