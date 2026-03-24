'use strict';
const http = require('http');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Candidates to look for as application entry points (relative to this test file)
const candidates = [
  './index.js',
  './app.js',
  './src/index.js',
  './src/app.js',
  './server.js'
];

let exported = null;
let usedPath = null;
for (const p of candidates) {
  const rp = path.join(__dirname, p);
  if (fs.existsSync(rp)) {
    try {
      exported = require(rp);
      usedPath = rp;
      break;
    } catch (err) {
      // If require fails, continue to next candidate
      console.error(`Could not require ${rp}:`, err && err.message ? err.message : err);
    }
  }
}

if (!exported) {
  console.log('SKIPPED: No application entry file found among candidates. Test skipped.');
  process.exit(0);
}

let server = null;
const TIMEOUT_MS = 5000;
const timeout = setTimeout(() => {
  console.error('✗ Test timeout after 5 seconds');
  if (server && typeof server.close === 'function') {
    try { server.close(() => process.exit(1)); } catch (e) { process.exit(1); }
    setTimeout(() => process.exit(1), 500);
  } else {
    process.exit(1);
  }
}, TIMEOUT_MS);

function cleanupAndExit(code) {
  clearTimeout(timeout);
  if (server && typeof server.close === 'function') {
    try {
      server.close(() => process.exit(code));
      // Fallback in case close callback isn't called
      setTimeout(() => process.exit(code), 500);
    } catch (e) {
      process.exit(code);
    }
  } else {
    process.exit(code);
  }
}

function startServerAndTest() {
  try {
    // If exported has listen (likely an Express app or http.Server)
    if (exported && typeof exported.listen === 'function') {
      server = exported.listen(0);
    } else if (typeof exported === 'function') {
      // Could be a request handler (router) or factory returning handler
      // If it's an express app function without listen, wrap it
      server = http.createServer(exported);
      server.listen(0);
    } else if (exported && typeof exported === 'object' && typeof exported.handle === 'function') {
      // Express app sometimes exposes .handle; wrap it
      server = http.createServer(exported);
      server.listen(0);
    } else {
      console.error('Unsupported export type from', usedPath);
      clearTimeout(timeout);
      process.exit(1);
    }
  } catch (err) {
    console.error('Error while starting server from', usedPath, ':', err && err.message ? err.message : err);
    clearTimeout(timeout);
    process.exit(1);
  }

  server.on('error', (err) => {
    console.error('Server error:', err && err.message ? err.message : err);
    clearTimeout(timeout);
    cleanupAndExit(1);
  });

  const addr = server.address();
  if (!addr || !addr.port) {
    // In some cases listen is asynchronous; wait for 'listening' event
    server.on('listening', () => {
      performRequest(server.address().port);
    });
  } else {
    performRequest(addr.port);
  }
}

function performRequest(port) {
  const reqBodyObj = { email: 'test@example.com', password: 'password' };
  const reqBody = JSON.stringify(reqBodyObj);

  const options = {
    hostname: '127.0.0.1',
    port: port,
    path: '/v1/auth/register',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(reqBody)
    }
  };

  const req = http.request(options, (res) => {
    clearTimeout(timeout);
    let raw = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => raw += chunk);
    res.on('end', () => {
      try {
        assert.strictEqual(res.statusCode, 201, `Expected status 201 but received ${res.statusCode}. Response body: ${raw}`);
        console.log('✓ Test passed: POST /v1/auth/register returned 201');
        cleanupAndExit(0);
      } catch (e) {
        console.error('✗ Test failed:', e && e.message ? e.message : e);
        cleanupAndExit(1);
      }
    });
  });

  req.on('error', (err) => {
    clearTimeout(timeout);
    console.error('✗ Test request error:', err && err.message ? err.message : err);
    cleanupAndExit(1);
  });

  req.write(reqBody);
  req.end();
}

startServerAndTest();
