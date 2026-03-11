const http = require('http');
const assert = require('assert');
const { URL } = require('url');
const TIMEOUT_MS = 10000;
let passed = 0;
let failed = 0;
let serverInstance = null;
let serverStartedByTest = false;
const PORT = 3001;
const BASE = `http://localhost:${PORT}`;

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
        try {
          const parsed = JSON.parse(data || 'null');
          resolve({ status: res.statusCode, body: parsed, headers: res.headers });
        } catch (err) {
          // not JSON
          resolve({ status: res.statusCode, body: data, headers: res.headers });
        }
      });
    });
    req.on('error', (err) => reject(err));
    if (body) {
      try {
        req.write(JSON.stringify(body));
      } catch (e) {
        // ignore
      }
    }
    req.end();
  });
}

function tryStartLocalServer() {
  const candidatePaths = [
    './src/app',
    './src/server',
    './app',
    './server',
    './index',
    './src/index',
    './dist/index',
  ];

  for (const p of candidatePaths) {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const mod = require(p);
      if (!mod) continue;
      // handle default export
      const exported = mod.default || mod;
      if (exported && typeof exported.listen === 'function') {
        serverInstance = exported.listen(PORT);
        serverStartedByTest = true;
        console.log('Started server by calling listen() on exported app from', p);
        return;
      }
      // if exported is a request handler (function), create http server
      if (typeof exported === 'function') {
        serverInstance = http.createServer(exported).listen(PORT);
        serverStartedByTest = true;
        console.log('Started http server from exported handler in', p);
        return;
      }
    } catch (err) {
      // ignore and try next
    }
  }
  // no local server started; assume external server will be available
}

async function runTests() {
  tryStartLocalServer();

  // Small helper to run and report each test
  async function run(name, fn) {
    try {
      await fn();
      console.log(`✓ ${name}`);
      passed += 1;
    } catch (err) {
      console.error(`✗ ${name}`);
      console.error('  ', err.message || err);
      failed += 1;
    }
  }

  // Test 1: Happy path - expect 201
  await run('POST /v1/auth/register - happy path returns 201 and JSON body', async () => {
    const uniqueEmail = `test+${Date.now()}@example.com`;
    const res = await makeRequest('POST', '/v1/auth/register', {
      name: 'Test User',
      email: uniqueEmail,
      password: 'Password123!',
    });
    assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}`);
    assert.ok(res.headers['content-type'] && res.headers['content-type'].includes('application/json'), 'Content-Type should include application/json');
    if (res.body && typeof res.body === 'object') {
      assert.ok(Object.keys(res.body).length > 0, 'Response JSON should be a non-empty object');
    }
  });

  // Test 2: Invalid body - expect 400
  await run('POST /v1/auth/register - invalid/missing body returns 400', async () => {
    const res = await makeRequest('POST', '/v1/auth/register', {});
    assert.strictEqual(res.status, 400, `Expected 400 for invalid body, got ${res.status}`);
  });

  // Test 3: Not found path - expect 404
  await run('POST /v1/auth/registers - wrong path returns 404', async () => {
    const res = await makeRequest('POST', '/v1/auth/registers', {
      name: 'X',
      email: 'x@example.com',
      password: 'x',
    });
    assert.strictEqual(res.status, 404, `Expected 404 for wrong path, got ${res.status}`);
  });

  // Summary
  console.log('\nTest summary:');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
}

// Timeout guard
const timeout = setTimeout(() => {
  console.error('✗ Tests timed out');
  if (serverInstance && serverStartedByTest) {
    try { serverInstance.close(); } catch (e) {}
  }
  process.exit(1);
}, TIMEOUT_MS);

runTests()
  .then(() => {
    clearTimeout(timeout);
    if (serverInstance && serverStartedByTest) {
      try { serverInstance.close(); } catch (e) { console.error('Error closing server', e); }
    }
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch((err) => {
    clearTimeout(timeout);
    console.error(err);
    if (serverInstance && serverStartedByTest) {
      try { serverInstance.close(); } catch (e) { console.error('Error closing server', e); }
    }
    process.exit(1);
  });
