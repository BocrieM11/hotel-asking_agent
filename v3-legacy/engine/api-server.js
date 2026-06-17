/**
 * 酒店问询Agent API v3.2
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const agent = require('./agent');
const convLogger = require('./conversation-logger');

const AUTH_ENABLED = process.env.AUTH_ENABLED !== 'false';
const API_TOKENS = (process.env.API_TOKENS || 'hotel-agent-2026').split(',');

function checkAuth(req) {
  if (!AUTH_ENABLED) return true;
  return API_TOKENS.includes((req.headers['authorization'] || '').replace('Bearer ', ''));
}

const rateMap = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  let e = rateMap.get(ip);
  if (!e || now > e.reset) { e = { count: 0, reset: now + 60000 }; rateMap.set(ip, e); }
  e.count++;
  return e.count <= 60;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of rateMap) { if (now > v.reset) rateMap.delete(k); } }, 60000);

function start(port = 3009) {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    const url = new URL(req.url, `http://localhost:${port}`);
    const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const isWebUI = req.headers['referer']?.includes('/chat');

    // Health + Analytics
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'ok', version: '3.2.0', ...agent.getAnalytics() }));
      return;
    }

    // Analytics dashboard data
    if (req.method === 'GET' && url.pathname === '/analytics') {
      res.writeHead(200);
      res.end(JSON.stringify(agent.getAnalytics()));
      return;
    }

    // Rate limit
    if (!isWebUI && url.pathname !== '/health' && url.pathname !== '/') {
      if (!checkRateLimit(clientIP)) { res.writeHead(429); res.end(JSON.stringify({ error: '请求过于频繁' })); return; }
    }

    // Auth
    if (url.pathname === '/engine/chat' && req.method === 'POST' && !isWebUI) {
      if (!checkAuth(req)) { res.writeHead(401); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
    }

    // GET /
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/engine')) {
      res.writeHead(200);
      res.end(JSON.stringify({ name: '酒店问询Agent v3.2', status: 'running', features: 'RAG+bge-m3+Cache+Recommend+History' }));
      return;
    }

    // GET /chat
    if (req.method === 'GET' && url.pathname === '/chat') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(path.join(__dirname, 'web-ui.html'), 'utf8'));
      return;
    }

    // POST /engine/chat
    if (req.method === 'POST' && url.pathname === '/engine/chat') {
      try {
        const input = JSON.parse(await readBody(req));
        const { message, locale = 'zh-CN', sessionId: sid } = input;
        if (!message) { res.writeHead(400); res.end(JSON.stringify({ error: '请提供 message' })); return; }

        const sessionId = sid || 'web-' + Date.now();
        agent.trackQuery(message);

        const reply = await agent.chat(message, locale, sessionId);
        convLogger.logTurn({ filePath: null }, message, reply, 'AGENT', null);

        res.writeHead(200);
        res.end(JSON.stringify({ result_type: 'execute', reply, session: { id: sessionId } }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    res.writeHead(404); res.end(JSON.stringify({ error: 'Not Found' }));
  });

  server.listen(port, () => { console.log(`🏨 Agent v3.2: http://localhost:${port}`); });
  return server;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

if (require.main === module) start(process.env.ENGINE_PORT || 3009);
module.exports = { start };
