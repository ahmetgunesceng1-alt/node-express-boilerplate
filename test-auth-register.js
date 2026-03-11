const http = require('http');
const assert = require('assert');

// Tests assume the API server is running on localhost:3001
// Run with: node test-auth-register.js

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
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : '';
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
  console.log('Running auth/register tests against', BASE);

  // Helper to log results
  function pass(name) { passed++; console.log('\x1b[32m✓\x1b[0m', name); }
  function fail(name, err) { failed++; console.error('\x1b[31m✗\x1b[0m', name); console.error('   ', err && err.message ? err.message : err); }

  // Use a unique email per run
  const uniqueSuffix = Date.now() + Math.floor(Math.random() * 1000);
  const validEmail = `test+${uniqueSuffix}@example.com`;
  const validPayload = { name: 'Test User', email: validEmail, password: 'P@ssw0rd!' };

  // Test 1: Happy path
  try {
    const res = await makeRequest('POST', '/v1/auth/register', validPayload);
    assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}`);
    const ct = (res.headers['content-type'] || '').toLowerCase();
    assert(ct.includes('application/json') || ct.includes('application/json;'), `Expected Content-Type application/json, got ${res.headers['content-type']}`);
    assert(res.body && typeof res.body === 'object', 'Expected JSON object in body');
    // Response shape: accept any of these present
    const bodyHasKey = !!(res.body.id || res.body.email || res.body.token || res.body.user);
    assert(bodyHasKey, 'Response body should include id, email, token, or user');
    pass('Happy path: POST /v1/auth/register returns 201 and JSON body');
  } catch (err) {
    fail('Happy path: POST /v1/auth/register returns 201 and JSON body', err);
  }

  // Test 2: Missing password -> expect 400
  try {
    const payload = { name: 'NoPass', email: `nopass+${uniqueSuffix}@example.com` };
    const res = await makeRequest('POST', '/v1/auth/register', payload);
    assert(res.status >= 400 && res.status < 500, `Expected 4xx for missing password, got ${res.status}`);
    const ct = (res.headers['content-type'] || '').toLowerCase();
    assert(ct.includes('application/json') || typeof res.body === 'object', 'Expected JSON error response');
    pass('Invalid request (missing password) returns 4xx and JSON');
  } catch (err) {
    fail('Invalid request (missing password) returns 4xx and JSON', err);
  }

  // Test 3: Invalid email format -> expect 400
  try {
    const payload = { name: 'BadEmail', email: 'not-an-email', password: 'abc12345' };
    const res = await makeRequest('POST', '/v1/auth/register', payload);
    assert(res.status >= 400 && res.status < 500, `Expected 4xx for invalid email, got ${res.status}`);
    pass('Invalid email format returns 4xx');
  } catch (err) {
    fail('Invalid email format returns 4xx', err);
  }

  // Test 4: Duplicate registration -> first should succeed, second should return client error (4xx)
  try {
    const dupEmail = `dup+${uniqueSuffix}@example.com`;
    const payload = { name: 'DupUser', email: dupEmail, password: 'DupP@ss1' };
    const first = await makeRequest('POST', '/v1/auth/register', payload);
    assert(first.status === 201 || (first.status >= 200 && first.status < 300), `First registration expected 2xx, got ${first.status}`);
    const second = await makeRequest('POST', '/v1/auth/register', payload);
    assert(second.status >= 400 && second.status < 500, `Second (duplicate) expected 4xx, got ${second.status}`);
    pass('Duplicate registration returns client error on second attempt');
  } catch (err) {
    fail('Duplicate registration returns client error on second attempt', err);
  }

  // Test 5: Unknown route under auth -> expect 404
  try {
    const res = await makeRequest('GET', '/v1/auth/nonexistent', null);
    assert.strictEqual(res.status, 404, `Expected 404 for unknown route, got ${res.status}`);
    pass('Unknown auth route returns 404');
  } catch (err) {
    fail('Unknown auth route returns 404', err);
  }

  // Summary
  console.log('');
  console.log('Test summary:');
  console.log('  Passed:', passed);
  console.log('  Failed:', failed);
}

// Timeout guard
const timeout = setTimeout(() => {
  console.error('✗ Tests timed out');
  process.exit(1);
}, TIMEOUT_MS);

runTests()
  .then(() => { clearTimeout(timeout); process.exit(failed > 0 ? 1 : 0); })
  .catch((err) => { clearTimeout(timeout); console.error(err); process.exit(1); });
