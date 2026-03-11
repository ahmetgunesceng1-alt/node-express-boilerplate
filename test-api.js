const http = require('http');
const assert = require('assert');
const TIMEOUT_MS = 10000;
let passed = 0;
let failed = 0;
let server = null;
let startedServer = false;
const PORT = 3001;
const BASE = `http://localhost:${PORT}`;

function tryRequireCandidates() {
  const candidates = [
    './src/app',
    './app',
    './index',
    './server',
    './src/index',
    './src/server',
    './bin/www'
  ];
  for (const p of candidates) {
    try {
      const mod = require(p);
      if (!mod) continue;
      // support ES module default export compiled to CommonJS
      const appOrRouter = mod.default || mod;
      return appOrRouter;
    } catch (err) {
      // ignore and try next
    }
  }
  return null;
}

function startIfAppPresent() {
  const appOrRouter = tryRequireCandidates();
  if (!appOrRouter) return null;
  // If it's an Express app, it will have a `listen` method
  if (typeof appOrRouter.listen === 'function') {
    server = appOrRouter.listen(PORT);
    startedServer = true;
    return server;
  }
  // If it's a request handler (router or function), create an http server
  if (typeof appOrRouter === 'function') {
    server = http.createServer(appOrRouter);
    server.listen(PORT);
    startedServer = true;
    return server;
  }
  return null;
}

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
        try { resolve({ status: res.statusCode, body: JSON.parse(data || '{}'), headers: res.headers }); }
        catch { resolve({ status: res.statusCode, body: data, headers: res.headers }); }
      });
    });
    req.on('error', (err) => reject(err));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  // Attempt to start server if repository exports an app/router
  try {
    startIfAppPresent();
    if (startedServer) console.log('Started embedded app on port', PORT);
    else console.log('No local app export found; will connect to running server at', BASE);
  } catch (err) {
    console.log('Error while attempting to start local app, will try to connect to existing server:', err.message);
  }

  // Test 1: Happy path - register
  try {
    const unique = Date.now();
    const payload = { name: 'Test User', email: `test+${unique}@example.com`, password: 'Password123!' };
    const res = await makeRequest('POST', '/v1/auth/register', payload);
    try {
      assert.strictEqual(res.status, 201, `Expected status 201, got ${res.status}`);
      const ct = (res.headers['content-type'] || '').toLowerCase();
      assert(ct.includes('application/json') || typeof res.body === 'object', 'Expected JSON response or application/json Content-Type');
      assert(res.body && (typeof res.body === 'object') && Object.keys(res.body).length > 0, 'Expected response body to be a non-empty JSON object');
      console.log('✓ POST /v1/auth/register - returns 201 and JSON');
      passed++;
    } catch (assertErr) {
      console.error('✗ POST /v1/auth/register - failed:', assertErr.message);
      failed++;
    }
  } catch (err) {
    console.error('✗ POST /v1/auth/register - request error:', err.message);
    failed++;
  }

  // Test 2: GET unknown auth route -> 404
  try {
    const res = await makeRequest('GET', '/v1/auth/nonexistent');
    try {
      assert.strictEqual(res.status, 404, `Expected 404 for unknown resource, got ${res.status}`);
      console.log('✓ GET /v1/auth/nonexistent - returns 404');
      passed++;
    } catch (assertErr) {
      console.error('✗ GET /v1/auth/nonexistent - failed:', assertErr.message);
      failed++;
    }
  } catch (err) {
    console.error('✗ GET /v1/auth/nonexistent - request error:', err.message);
    failed++;
  }

  // Summary
  console.log(`\nTest summary: ${passed} passed, ${failed} failed`);
  // Cleanup
  if (startedServer && server) {
    try {
      server.close(() => { /* closed */ });
    } catch (e) { /* ignore */ }
  }
  if (failed > 0) process.exit(1);
}

// Timeout guard
const timeout = setTimeout(() => {
  console.error('✗ Tests timed out');
  process.exit(1);
}, TIMEOUT_MS);

runTests()
  .then(() => { clearTimeout(timeout); process.exit(0); })
  .catch((err) => { clearTimeout(timeout); console.error(err); process.exit(1); });
