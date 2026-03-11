const http = require('http');
const assert = require('assert');

const PORT = 3001;
const BASE = `http://localhost:${PORT}`;
const TIMEOUT_MS = 10000;
let serverInstance = null;
let usedLocalServer = false;

function tryRequireApp() {
  const candidates = ['./src/app', './app', './src/index', './index', './server', './src/server'];
  for (const p of candidates) {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const mod = require(p);
      if (mod) return mod;
    } catch (err) {
      // ignore and continue
    }
  }
  return null;
}

function startServerIfApp(appOrRouter) {
  return new Promise((resolve, reject) => {
    try {
      // If it's an Express app, it has listen
      if (appOrRouter && typeof appOrRouter.listen === 'function') {
        const s = appOrRouter.listen(PORT, () => resolve(s));
      } else if (appOrRouter && typeof appOrRouter === 'function') {
        // treat as a request handler/router
        const s = http.createServer(appOrRouter).listen(PORT, () => resolve(s));
      } else {
        reject(new Error('Exported module is not an app or router'));
      }
    } catch (err) {
      reject(err);
    }
  });
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
      timeout: TIMEOUT_MS,
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        const ct = res.headers['content-type'] || '';
        try {
          const parsed = data ? JSON.parse(data) : '';
          resolve({ status: res.statusCode, body: parsed, headers: res.headers, contentType: ct });
        } catch (e) {
          resolve({ status: res.statusCode, body: data, headers: res.headers, contentType: ct });
        }
      });
    });
    req.on('error', (err) => reject(err));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let passed = 0;
let failed = 0;

async function runTests() {
  // Attempt to require and start local app/router if available
  const appOrRouter = tryRequireApp();
  if (appOrRouter) {
    try {
      serverInstance = await startServerIfApp(appOrRouter);
      usedLocalServer = true;
      console.log('Started local app for tests on port', PORT);
    } catch (err) {
      console.warn('Found app export but failed to start it, falling back to external server:', err.message);
    }
  } else {
    console.log('No local app found; tests will target an external server at', BASE);
  }

  // Give a brief moment for server to be fully ready
  await new Promise((r) => setTimeout(r, 150));

  // Test: Happy path - register returns 201
  try {
    const payload = { name: 'Test User', email: `test+${Date.now()}@example.com`, password: 'Password123!' };
    const res = await makeRequest('POST', '/v1/auth/register', payload);
    try {
      assert.strictEqual(res.status, 201, `Expected 201 Created, got ${res.status}`);
      assert.ok(res.contentType && res.contentType.includes('application/json'), 'Expected Content-Type application/json');
      passed++;
      console.log('✓ POST /v1/auth/register returns 201 and JSON');
    } catch (err) {
      failed++;
      console.error('✗ POST /v1/auth/register happy path failed:', err.message);
      console.error('  Response status:', res.status);
      console.error('  Content-Type:', res.contentType);
      console.error('  Body:', res.body);
    }
  } catch (err) {
    failed++;
    console.error('✗ POST /v1/auth/register request failed:', err && err.message ? err.message : err);
  }

  // Summary
  console.log(`\nTest summary: ${passed} passed, ${failed} failed`);

  // Cleanup
  if (serverInstance && typeof serverInstance.close === 'function') {
    await new Promise((resolve) => serverInstance.close(resolve));
  }

  if (failed > 0) process.exit(1);
  process.exit(0);
}

// Timeout guard
const timeout = setTimeout(() => {
  console.error('✗ Tests timed out');
  process.exit(1);
}, TIMEOUT_MS);

runTests()
  .then(() => { clearTimeout(timeout); })
  .catch((err) => { clearTimeout(timeout); console.error(err); process.exit(1); });
