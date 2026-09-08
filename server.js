#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

const PORT = process.env.PORT || 3333;
const ROOT_DIR = __dirname;

const PROMPTU_DATA_DIR = path.join(os.homedir(), '.promptu');
const PRIMARY_FILE = path.join(PROMPTU_DATA_DIR, 'prompts.json');

// Legacy paths for migration
const LEGACY_FILE = path.join(ROOT_DIR, 'prompts.json');
const MIRROR_FILE = path.join(ROOT_DIR, 'prompts', 'prompts.json');
const EXAMPLE_FILE = path.join(ROOT_DIR, 'prompts.example.json');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp'
};

function readPromptsFile() {
  if (!fs.existsSync(PROMPTU_DATA_DIR)) {
    fs.mkdirSync(PROMPTU_DATA_DIR, { recursive: true });
  }

  // 1. If global file exists, use it
  if (fs.existsSync(PRIMARY_FILE)) {
    try {
      const raw = fs.readFileSync(PRIMARY_FILE, 'utf-8');
      return JSON.parse(raw);
    } catch (e) {
      console.error('[Promptu] Error reading primary prompts.json:', e.message);
    }
  }

  // 2. MIGRATION: If global doesn't exist but local repo file exists, migrate it
  if (fs.existsSync(LEGACY_FILE)) {
    try {
      const raw = fs.readFileSync(LEGACY_FILE, 'utf-8');
      const seedData = JSON.parse(raw);
      writePromptsFile(seedData);
      console.log(`[Promptu] Migrated local prompt database to global location: ${PRIMARY_FILE}`);
      return seedData;
    } catch (e) {
      console.error('[Promptu] Error migrating legacy prompts.json:', e.message);
    }
  }

  // 3. MIGRATION fallback: Mirror file
  if (fs.existsSync(MIRROR_FILE)) {
    try {
      const raw = fs.readFileSync(MIRROR_FILE, 'utf-8');
      const seedData = JSON.parse(raw);
      writePromptsFile(seedData);
      console.log(`[Promptu] Migrated mirror database to global location: ${PRIMARY_FILE}`);
      return seedData;
    } catch (e) {
      console.error('[Promptu] Error reading mirror prompts.json:', e.message);
    }
  }

  // 4. Initial seed
  if (fs.existsSync(EXAMPLE_FILE)) {
    try {
      const raw = fs.readFileSync(EXAMPLE_FILE, 'utf-8');
      const seedData = JSON.parse(raw);
      writePromptsFile(seedData);
      console.log(`[Promptu] Initialized global prompt database from prompts.example.json at ${PRIMARY_FILE}`);
      return seedData;
    } catch (e) {
      console.error('[Promptu] Error initializing from prompts.example.json:', e.message);
    }
  }

  return [];
}

function writePromptsFile(data) {
  if (!fs.existsSync(PROMPTU_DATA_DIR)) {
    fs.mkdirSync(PROMPTU_DATA_DIR, { recursive: true });
  }

  const jsonString = JSON.stringify(data, null, 2);

  // Write primary root file
  fs.writeFileSync(PRIMARY_FILE, jsonString, 'utf-8');

  // Write mirror file inside prompts/ if directory exists
  const promptsDir = path.join(ROOT_DIR, 'prompts');
  if (fs.existsSync(promptsDir)) {
    try {
      fs.writeFileSync(MIRROR_FILE, jsonString, 'utf-8');
    } catch (e) {
      console.warn('[Promptu] Notice: could not mirror to prompts/prompts.json:', e.message);
    }
  }
}

// Auto-Shutdown Engine when browser tabs are closed
let lastHeartbeat = Date.now();
let shutdownTimer = null;
const STARTUP_TIME = Date.now();
const HEARTBEAT_TIMEOUT_MS = 120000; // 120 seconds without heartbeat triggers auto-shutdown
const INITIAL_GRACE_PERIOD_MS = 15000; // 15 seconds grace period for browser window to launch

function registerHeartbeat() {
  lastHeartbeat = Date.now();
  if (shutdownTimer) {
    clearTimeout(shutdownTimer);
    shutdownTimer = null;
  }
}

function triggerShutdown(delayMs = 4000, reason = 'Tab closed') {
  if (shutdownTimer) clearTimeout(shutdownTimer);
  shutdownTimer = setTimeout(() => {
    console.log(`[Promptu] ${reason}. Server shut down cleanly.`);
    process.exit(0);
  }, delayMs);
}

// Background watcher removed to prevent inactivity disconnects.

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // Security & CORS headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data:; connect-src 'self';");
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API Endpoints
  if (pathname === '/api/prompts') {
    registerHeartbeat();
    if (req.method === 'GET') {
      try {
        const prompts = readPromptsFile();
        const payload = JSON.stringify(prompts);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Content-Length': Buffer.byteLength(payload)
        });
        res.end(payload);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 50 * 1024 * 1024) { // 50MB safety limit
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Payload too large' }));
          req.destroy();
        }
      });

      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (!Array.isArray(parsed)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Payload must be a JSON array of prompts' }));
            return;
          }

          writePromptsFile(parsed);
          console.log(`[Promptu] Saved ${parsed.length} prompt(s) directly to prompts.json [${new Date().toLocaleTimeString()}]`);

          const response = JSON.stringify({ success: true, count: parsed.length, savedAt: Date.now() });
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-cache'
          });
          res.end(response);
        } catch (err) {
          console.error('[Promptu] Error saving prompts:', err.message);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON: ' + err.message }));
        }
      });
      return;
    }
  }

  // Heartbeat endpoint to signal page is still open
  if (pathname === '/api/heartbeat') {
    registerHeartbeat();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"status":"alive"}');
    return;
  }

  // Shutdown endpoint triggered when the browser page is closed
  if (pathname === '/api/shutdown') {
    triggerShutdown(2000, 'Browser page closed');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"status":"shutting_down"}');
    return;
  }

  // Health check endpoint
  if (pathname === '/api/health') {
    registerHeartbeat();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', diskFile: PRIMARY_FILE, exists: fs.existsSync(PRIMARY_FILE) }));
    return;
  }

  // Serve static files (default to index.html)
  let relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  const filePath = path.join(ROOT_DIR, relativePath);

  // Security: prevent directory traversal outside root
  const safeRoot = ROOT_DIR.endsWith(path.sep) ? ROOT_DIR : ROOT_DIR + path.sep;
  if (filePath !== ROOT_DIR && !filePath.startsWith(safeRoot)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Access Denied');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback to index.html for SPA if not an api call
      const fallbackPath = path.join(ROOT_DIR, 'index.html');
      fs.readFile(fallbackPath, (fbErr, content) => {
        if (fbErr) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(content);
        }
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': ext === '.html' ? 'no-cache, no-store, must-revalidate' : 'public, max-age=3600'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

function startServer(port) {
  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    PROMPTU LOCAL VAULT                       ║
║                                                              ║
║  Local Server:  ${url}                        ║
║  Database File: ${PRIMARY_FILE}               ║
║  Status:        Active (Saves directly to disk)              ║
║                                                              ║
║  You can safely clear all browser history & cookies!        ║
║  All prompt data lives permanently in your prompts.json      ║
╚══════════════════════════════════════════════════════════════╝
`);

    // Auto-open browser on Windows if not suppressed
    if (!process.argv.includes('--no-open')) {
      const openCmd = process.platform === 'win32' ? `start "" "${url}"` :
                      process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
      exec(openCmd, (e) => {
        if (e) console.log(`[Promptu] Open in browser: ${url}`);
      });
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`[Promptu] Port ${port} is in use, trying port ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('[Promptu] Server error:', err);
    }
  });
}

startServer(PORT);
