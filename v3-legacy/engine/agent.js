/**
 * LLM Agent v3.2 — RAG(bge-m3) + 缓存 + 主动推荐 + 历史持久化
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const LLM = {
  model: process.env.LLM_MODEL || 'deepseek-r1:14b',
  base_url: process.env.LLM_BASE_URL || 'http://localhost:11434',
  api_key: process.env.LLM_API_KEY || 'ollama'
};

// ======================== 知识库 (纯关键词检索，无embedding依赖) ========================
const KB_DIR = path.join(__dirname, '..', 'kb');
const kbFiles = fs.readdirSync(KB_DIR).filter(f => f.endsWith('.md')).sort();
const kbContent = {};
for (const f of kbFiles) kbContent[f] = fs.readFileSync(path.join(KB_DIR, f), 'utf8');

// 预拆分为段落 (按 ## 标题)
const paragraphs = [];
for (const [file, content] of Object.entries(kbContent)) {
  const parts = content.split(/\n#{2,3}\s/);
  for (const p of parts) {
    const text = p.trim();
    if (text.length > 20) paragraphs.push({ file: file.replace('.md', ''), text: text.substring(0, 3000) });
  }
}

function keywordSearch(query, topK) {
  const lower = query.toLowerCase().replace(/-/g, '');
  const kw = [];
  for (let len = 2; len <= 4; len++) for (let i = 0; i <= query.length - len; i++) kw.push(query.substring(i, i + len).toLowerCase());
  kw.push(...lower.split(/[\s,，。？?!]+/).filter(k => k.length > 1));
  const results = [];
  for (const p of paragraphs) {
    const pLower = p.text.toLowerCase().replace(/-/g, '');
    let score = 0;
    for (const k of kw) { if (pLower.includes(k.replace(/-/g, ''))) score++; }
    if (pLower.includes(lower)) score += 3;
    if (score > 0) results.push({ ...p, score });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

// ======================== 响应缓存 (高频问题秒回) ========================
const cache = new Map();
const CACHE_MAX = 200;
function cacheKey(msg) { return msg.trim().toLowerCase(); }
function cacheGet(msg) { return cache.get(cacheKey(msg)); }
function cacheSet(msg, reply) {
  const k = cacheKey(msg);
  cache.set(k, { reply, time: Date.now() });
  if (cache.size > CACHE_MAX) { const first = cache.keys().next().value; cache.delete(first); }
}

// ======================== 天气/时间 ========================
const WMO = ['晴','晴','少云','多云','阴','雾','雾凇','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','','小雨','小雨','中雨','','','','','','','','小雪','中雪','大雪','','','','阵雨','阵雨','暴雨','','阵雪','阵雪','','','雷阵雨','雷暴','强雷暴'];
const TZ = { '澳门':'Asia/Macau','北京':'Asia/Shanghai','上海':'Asia/Shanghai','香港':'Asia/Hong_Kong','台北':'Asia/Taipei','东京':'Asia/Tokyo','首尔':'Asia/Seoul','新加坡':'Asia/Singapore','纽约':'America/New_York','伦敦':'Europe/London','巴黎':'Europe/Paris','悉尼':'Australia/Sydney','曼谷':'Asia/Bangkok','迪拜':'Asia/Dubai','洛杉矶':'America/Los_Angeles','柏林':'Europe/Berlin','莫斯科':'Europe/Moscow','多伦多':'America/Toronto' };

function httpGet(url) {
  return new Promise((r, j) => {
    (url.startsWith('https') ? https : http).get(url, { timeout: 10000 }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { r(JSON.parse(d)); } catch(e) { j(e); } }); }).on('error', j);
  });
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = (u.protocol === 'https:' ? https : http).request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'Authorization': `Bearer ${LLM.api_key}` },
      timeout: 60000
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } }); });
    req.on('error', reject); req.on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
    req.write(data); req.end();
  });
}

async function getWeather(city) {
  try {
    const geo = await httpGet(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh`);
    if (!geo.results?.length) return null;
    const g = geo.results[0];
    const w = await httpGet(`https://api.open-meteo.com/v1/forecast?latitude=${g.latitude}&longitude=${g.longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,apparent_temperature&timezone=${encodeURIComponent(g.timezone||'UTC')}`);
    if (!w.current) return null;
    const code = w.current.weather_code || 0;
    return `【实时天气】${g.name}: ${WMO[code]||'未知'}，${Math.round(w.current.temperature_2m)}°C（体感${Math.round(w.current.apparent_temperature||w.current.temperature_2m)}°C），湿度${w.current.relative_humidity_2m}%，风速${Math.round(w.current.wind_speed_10m||0)}km/h`;
  } catch(e) { return null; }
}

function getTime(city) {
  const tz = TZ[city] || Object.entries(TZ).find(([k]) => k.toLowerCase() === city?.toLowerCase() || city?.toLowerCase()?.includes(k.toLowerCase()))?.[1] || 'Asia/Macau';
  try {
    const now = new Date();
    const date = now.toLocaleDateString('zh-CN', { timeZone: tz, year:'numeric', month:'long', day:'numeric', weekday:'long' });
    const time = now.toLocaleTimeString('zh-CN', { timeZone: tz, hour:'2-digit', minute:'2-digit', hour12:false });
    return `【实时时间】${city||'澳门'}: ${date} ${time} (${tz})`;
  } catch(e) { return `【实时时间】${new Date().toLocaleString('zh-CN')}`; }
}

// ======================== 主动推荐 ========================
function getProactiveTip() {
  const h = new Date().getHours();
  const tips = [];
  if (h >= 6 && h < 10) tips.push('☀️ 早上好！Bambu沨竹自助餐厅06:30开始供应早餐。');
  else if (h >= 10 && h < 12) tips.push('🛶 大运河购物中心已开门，贡多拉游船11:00开始。');
  else if (h >= 12 && h < 14) tips.push('🍽️ 午餐时间！大运河美食广场和Portofino意餐厅都在营业。');
  else if (h >= 14 && h < 17) tips.push('☕ 下午茶时间！大堂咖啡廊和Lady M都在等你。');
  else if (h >= 17 && h < 20) tips.push('🌅 傍晚推荐去永利皇宫坐免费缆车看日落喷泉。');
  else if (h >= 20) tips.push('🌙 巴黎人铁塔夜景超美，湖畔酒吧营业到凌晨2点。');
  tips.push('🏨 住客免费使用V健身中心和V泳池。');
  tips.push('🚌 免费穿梭巴士往返机场/口岸/码头。');
  return tips[Math.floor(Math.random() * tips.length)];
}

// ======================== 历史持久化 ========================
const HISTORY_DIR = path.join(__dirname, 'logs', 'sessions');
function saveSession(sessionId, history) {
  try {
    if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
    fs.writeFileSync(path.join(HISTORY_DIR, `${sessionId}.json`), JSON.stringify(history.slice(-20)), 'utf8');
  } catch(e) {}
}
function loadSession(sessionId) {
  try {
    const f = path.join(HISTORY_DIR, `${sessionId}.json`);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch(e) {}
  return [];
}

// ======================== System Prompt ========================
function buildSystemPrompt(relevantKB) {
  const tip = getProactiveTip();
  return `你是澳门威尼斯人酒店的前台管家"小云"，一位热情贴心的酒店管家。酒店位于澳门路氹城金光大道。用温暖自然的口吻回答住客。每次回复用不同的问候方式。用列表格式让信息清晰，emoji标记类别。基于酒店信息回答，不编造。

💡 可以在回复末尾自然地加一句贴心提示，比如:
"${tip}"

## 酒店信息
${relevantKB}`;
}

// ======================== Agent 核心 ========================
async function chat(userMessage, locale, sessionId) {
  // 缓存检查
  const cached = cacheGet(userMessage);
  if (cached) return cached.reply;

  const lower = userMessage.toLowerCase();
  let preData = '';
  const weatherWords = ['天气','气温','下雨','下雪','刮风','晴天','阴天','多云','台风','季节','几度','热不热','冷不冷','weather','rain','snow','temperature'];
  const timeWords = ['几点','时间','几号','星期几','日期','time','what day','几月'];
  const cityPattern = /(北京|上海|广州|深圳|杭州|成都|重庆|武汉|南京|天津|西安|三亚|昆明|哈尔滨|大连|厦门|青岛|长沙|郑州|苏州|东莞|宁波|佛山|合肥|福州|南昌|南宁|贵阳|兰州|海口|银川|拉萨|乌鲁木齐|呼和浩特|沈阳|长春|济南|太原|石家庄|香港|澳门|台北|高雄|台中|纽约|伦敦|巴黎|东京|首尔|曼谷|迪拜|悉尼|新加坡|洛杉矶|柏林|莫斯科|多伦多|new york|london|paris|tokyo|singapore|sydney|los angeles|san francisco|chicago|bangkok|seoul)/i;

  if (weatherWords.some(w => lower.includes(w))) { const m = userMessage.match(cityPattern); const w = await getWeather(m ? m[1] : '澳门'); if (w) preData += w + '\n'; }
  if (timeWords.some(w => lower.includes(w))) { const m = userMessage.match(cityPattern); preData += getTime(m ? m[1] : '澳门') + '\n'; }

  // 关键词检索 (37KB知识库够用了)
  const relevantKB = keywordSearch(userMessage, 8).map(r => `[${r.file}] ${r.text}`).join('\n\n---\n\n') || Object.values(kbContent).join('\n').substring(0, 3000);
  const systemPrompt = buildSystemPrompt(relevantKB);

  const userMsg = preData ? `【实时数据】\n${preData}\n\n【问题】${userMessage}` : `【问题】${userMessage}`;

  // 加载历史
  const history = sessionId ? loadSession(sessionId) : [];

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-20),
    { role: 'user', content: userMsg }
  ];

  return new Promise((resolve) => {
    const body = JSON.stringify({ model: LLM.model, messages, temperature: 0.9, max_tokens: 1500 });
    const u = new URL(`${LLM.base_url}/v1/chat/completions`);
    const req = (u.protocol === 'https:' ? https : http).request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Authorization': `Bearer ${LLM.api_key}` },
      timeout: 120000
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { const j = JSON.parse(d); const reply = j.choices?.[0]?.message?.content?.trim() || '抱歉，暂时无法处理。'; if (sessionId) { history.push({ role: 'user', content: userMessage }); history.push({ role: 'assistant', content: reply }); saveSession(sessionId, history); } cacheSet(userMessage, reply); resolve(reply); } catch(e) { resolve('抱歉，处理出错。'); } }); });
    req.on('error', () => resolve('抱歉，服务暂时不可用。'));
    req.on('timeout', function() { this.destroy(); resolve('抱歉，响应超时。'); });
    req.write(body); req.end();
  });
}

// ======================== 分析数据 ========================
const analytics = { total: 0, topics: {}, recent: [] };
function trackQuery(msg) {
  analytics.total++;
  analytics.recent.push({ msg: msg.substring(0, 50), time: Date.now() });
  if (analytics.recent.length > 100) analytics.recent.shift();
}
function getAnalytics() {
  return { ...analytics, cacheSize: cache.size, model: LLM.model };
}

// ======================== 启动 ========================
console.log('[Agent] v3.3 就绪 (关键词检索+缓存+推荐+历史 | 零embedding依赖)');

module.exports = { chat, trackQuery, getAnalytics, loadSession, saveSession };
