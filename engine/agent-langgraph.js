/**
 * ============================================================
 * 酒店问询 Agent — LangGraph 状态图引擎 (v4.0)
 * ============================================================
 *
 * 架构: 三节点状态机
 *   classifyNode (关键词路由) → executeNode (工具执行) → generateNode (LLM生成)
 *
 * 检索: bge-m3语义向量 + 关键词混合检索 (91段落, 6个MD知识库)
 * 模型: qwen3:8b (Ollama, GPU推理, think:false)
 * 工具: Open-Meteo天气API / 系统时钟+时区 / KB混合检索
 *
 * 调用链: api-server.js → agent.chat(msg, locale, sessionId) → 回复文本
 * ============================================================
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ── LLM配置 ──
// ── LLM配置 (远程 vLLM) ──
const LLM = {
  model: process.env.LLM_MODEL || 'qwen35-4b',
  base_url: process.env.LLM_BASE_URL || 'http://192.168.253.95:8013',
};

// ======================== 知识库 ========================
const KB_DIR = path.join(__dirname, '..', 'kb');
const kbFiles = fs.readdirSync(KB_DIR).filter(f => f.endsWith('.md')).sort();
const kbContent = {};
for (const f of kbFiles) kbContent[f] = fs.readFileSync(path.join(KB_DIR, f), 'utf8');

// 预拆段落 + 向量索引
const paragraphs = [];
for (const [file, content] of Object.entries(kbContent)) {
  const parts = content.split(/\n#{2,3}\s/);
  for (const p of parts) { const t = p.trim(); if (t.length > 20) paragraphs.push({ file: file.replace('.md', ''), text: t.substring(0, 3000), embedding: null }); }
}

// ======================== bge-m3 语义嵌入 ========================
const EMBED_MODEL = 'bge-m3:latest';
let embeddingsReady = false;

async function getEmbedding(text) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ model: EMBED_MODEL, input: text.substring(0, 512) });
    const req = http.request('http://localhost:11434/api/embed', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: 30000
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d).embeddings?.[0] || null); } catch { resolve(null); } }); });
    req.on('error', () => resolve(null)); req.on('timeout', function() { this.destroy(); resolve(null); });
    req.write(body); req.end();
  });
}

function cosineSim(a, b) {
  if (!a || !b) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

let buildPromise = null;
function buildIndex() {
  if (buildPromise) return buildPromise;
  buildPromise = (async () => {
    console.log('[RAG] 正在构建语义索引 (' + paragraphs.length + '个段落)...');
    let done = 0;
    for (const p of paragraphs) {
      p.embedding = await getEmbedding(p.text);
      done++;
      if (done % 10 === 0) process.stdout.write('\r[RAG] ' + done + '/' + paragraphs.length + ' ...');
    }
    embeddingsReady = true;
    process.stdout.write('\r[RAG] ✅ 语义索引就绪 (' + paragraphs.length + '段落)\n');
  })();
  return buildPromise;
}
buildIndex(); // 启动
module.exports.buildPromise = buildPromise;

// 混合检索：语义 + 关键词
async function hybridSearch(query, topK) {
  // 关键词召回 (topK*3 候选)
  const lower = query.toLowerCase().replace(/-/g, '');
  const kw = [];
  for (let len = 2; len <= 4; len++) for (let i = 0; i <= query.length - len; i++) kw.push(query.substring(i, i + len).toLowerCase());
  kw.push(...lower.split(/[\s,，。？?!]+/).filter(k => k.length > 1));
  const scored = [];
  for (const p of paragraphs) {
    let score = 0; const pL = p.text.toLowerCase().replace(/-/g, '');
    for (const k of kw) { if (pL.includes(k.replace(/-/g, ''))) score++; }
    if (pL.includes(lower)) score += 3;
    if (score > 0) scored.push({ ...p, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const kwResults = scored.slice(0, topK * 3);

  // 语义重排序 — 仅关键词弱匹配时启用
  const topScore = kwResults[0]?.score || 0;
  if (embeddingsReady && topScore < 5) {
    const qEmb = await getEmbedding(query);
    if (qEmb) {
      for (const p of kwResults) {
        const sim = cosineSim(qEmb, p.embedding);
        p.score = p.score * 0.4 + sim * 10 * 0.6;
      }
      kwResults.sort((a, b) => b.score - a.score);
    }
  }

  return kwResults.slice(0, topK);
}

// 回退纯关键词检索
function keywordSearch(query, topK) {
  const lower = query.toLowerCase().replace(/-/g, '');
  const kw = [];
  for (let len = 2; len <= 4; len++) for (let i = 0; i <= query.length - len; i++) kw.push(query.substring(i, i + len).toLowerCase());
  kw.push(...lower.split(/[\s,，。？?!]+/).filter(k => k.length > 1));
  const results = [];
  for (const p of paragraphs) { let score = 0; const pL = p.text.toLowerCase().replace(/-/g, ''); for (const k of kw) { if (pL.includes(k.replace(/-/g, ''))) score++; } if (pL.includes(lower)) score += 3; if (score > 0) results.push({ ...p, score }); }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

// ======================== 天气/时间 ========================
const WMO_MAP = { 0:'晴天☀️', 1:'大部晴朗🌤️', 2:'少云⛅', 3:'多云☁️', 45:'雾🌫️', 48:'雾凇🌫️', 51:'小毛毛雨🌧️', 53:'毛毛雨🌧️', 55:'大毛毛雨🌧️', 61:'小雨🌧️', 63:'中雨🌧️', 65:'大雨🌧️', 71:'小雪❄️', 73:'中雪❄️', 75:'大雪❄️', 80:'阵雨⛈️', 81:'中阵雨⛈️', 82:'大阵雨⛈️', 95:'雷暴⛈️', 96:'雷暴+冰雹⚡', 99:'强雷暴+冰雹⚡' };
const TZ = { '澳门':'Asia/Macau','北京':'Asia/Shanghai','上海':'Asia/Shanghai','香港':'Asia/Hong_Kong','新加坡':'Asia/Singapore','东京':'Asia/Tokyo','纽约':'America/New_York','伦敦':'Europe/London','巴黎':'Europe/Paris','悉尼':'Australia/Sydney' };

async function getWeather(city) {
  try {
    return new Promise((resolve) => {
      https.get(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh`, {timeout:10000}, res => { let d=''; res.on('data',c=>d+=c); res.on('end',async()=>{
        try { const geo = JSON.parse(d); if(!geo.results?.length) return resolve(null);
          const g = geo.results[0];
          https.get(`https://api.open-meteo.com/v1/forecast?latitude=${g.latitude}&longitude=${g.longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,apparent_temperature&timezone=${encodeURIComponent(g.timezone||'UTC')}`, {timeout:10000}, res2=>{let d2='';res2.on('data',c=>d2+=c);res2.on('end',()=>{
            try { const w = JSON.parse(d2); if(!w.current) return resolve(null);
              const desc = WMO_MAP[w.current.weather_code]||'未知';
              resolve(`${g.name}: ${Math.round(w.current.temperature_2m)}°C，${desc}，体感${Math.round(w.current.apparent_temperature||w.current.temperature_2m)}°C，湿度${w.current.relative_humidity_2m}%，风速${Math.round(w.current.wind_speed_10m||0)}km/h`);
            } catch { resolve(null); }
          });}).on('error',()=>resolve(null));
        } catch { resolve(null); }
      });}).on('error',()=>resolve(null));
    });
  } catch { return null; }
}

function getTime(city) {
  const tz = TZ[city] || Object.entries(TZ).find(([k])=>k.toLowerCase()===city?.toLowerCase())?.[1]||'Asia/Macau';
  try {
    const now = new Date();
    return `${city||'澳门'}: ${now.toLocaleDateString('zh-CN',{timeZone:tz,month:'long',day:'numeric',weekday:'long'})} ${now.toLocaleTimeString('zh-CN',{timeZone:tz,hour:'2-digit',minute:'2-digit',hour12:false})}`;
  } catch { return new Date().toLocaleString('zh-CN'); }
}

// ======================== LLM调用 ========================
async function callLLM(messages) {
  const body = JSON.stringify({ model: LLM.model, messages,
    temperature: 0.7, top_p: 0.9, max_tokens: 256,
    chat_template_kwargs: { enable_thinking: false }
  });
  return new Promise((resolve) => {
    const u = new URL(`${LLM.base_url}/v1/chat/completions`);
    const req = (u.protocol === 'https:' ? https : http).request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method:'POST',
      headers: {'Content-Type':'application/json','Content-Length': Buffer.byteLength(body)}, timeout: 120000
    }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{ resolve(JSON.parse(d)); }catch{ resolve(null); } }); });
    req.on('error', () => resolve(null)); req.on('timeout', function(){ this.destroy(); resolve(null); });
    req.write(body); req.end();
  });
}

// ======================== SYSTEM PROMPT ========================
const HOUR_TIPS = [
  [6,10,'☀️ 早上好！Bambu沨竹自助餐厅06:30开始供应早餐。'],
  [10,12,'🛶 大运河购物中心已开门，贡多拉游船11:00开始。'],
  [12,14,'🍽️ 午餐时间！大运河美食广场和Portofino意餐厅都在营业。'],
  [14,17,'☕ 下午茶时间！大堂咖啡廊和Lady M都在等你。'],
  [17,20,'🌅 傍晚推荐去永利皇宫坐免费缆车看日落喷泉。'],
  [20,24,'🌙 巴黎人铁塔夜景超美，湖畔酒吧营业到凌晨2点。'],
];
function getTip() {
  const h = new Date().getHours();
  for (const [s,e,t] of HOUR_TIPS) { if (h>=s && h<e) return t; }
  return '🏨 住客免费使用V健身中心和V泳池。';
}

const SYSTEM = `你是澳门威尼斯人酒店的金牌管家"小云"，热情贴心。酒店在澳门路氹城金光大道。
## 底线
只做信息问询。送物取物、点餐下单、控制设备、生成工单→礼貌拒绝，告知拨0找前台。
## 风格
语音交互，简洁直接。问得宽给方向，问得细精准答。不绕弯不编造。
💡 ${getTip()}`;

// ======================== LangGraph 状态机 ========================
// 状态: { messages, route, toolResult, finalReply }

// 关键词路由表（代码层决策，不依赖LLM）
const WEATHER_KW = ['天气','气温','下雨','下雪','刮风','晴天','阴天','多云','几度','热不热','冷不热','weather','rain','snow','temperature','带伞'];
const TIME_KW = ['几点','时间','几号','星期几','日期','time','what day','几月','现在几点'];
// 服务请求正则：动词+物品组合（精确匹配，避免误伤信息查询）
const REJECT_RE = /(送.+到|送伞|送毛巾|送咖啡|送水|送餐|帮我订|帮我买|帮我拿|帮我送|帮我准备|给我来|给我拿|给我准备|来一杯|来一份|准备|收拾|洗衣|缝补|修鞋|下单|付款|支付|送餐到|客房服务|叫醒)/;
// 额外关键词（纯动词，但检查是否跟了物品）
const REJECT_VERBS = ['送','拿','帮订','帮买','帮准备','代购','代买','代取'];
const CITY_RE = /(北京|上海|广州|深圳|杭州|成都|重庆|武汉|南京|天津|西安|三亚|昆明|哈尔滨|大连|厦门|青岛|长沙|郑州|苏州|东莞|宁波|佛山|合肥|福州|南昌|南宁|贵阳|兰州|海口|银川|拉萨|乌鲁木齐|呼和浩特|沈阳|长春|济南|太原|石家庄|香港|澳门|台北|高雄|台中|纽约|伦敦|巴黎|东京|首尔|曼谷|迪拜|悉尼|新加坡|洛杉矶|柏林|莫斯科|多伦多)/;

function classifyNode(state) {
  const msg = state.messages[state.messages.length-1].content;
  const lower = msg.toLowerCase();
  if (REJECT_RE.test(msg) || REJECT_VERBS.some(v => lower.startsWith(v) || lower.includes(' '+v))) return { ...state, route: 'reject', toolParam: msg };
  if (WEATHER_KW.some(k => lower.includes(k))) { const m = msg.match(CITY_RE); return { ...state, route: 'weather', toolParam: m ? m[1] : '澳门' }; }
  if (TIME_KW.some(k => lower.includes(k))) { const m = msg.match(CITY_RE); return { ...state, route: 'time', toolParam: m ? m[1] : '澳门' }; }
  return { ...state, route: 'kb', toolParam: msg };
}

/**
 * 节点2: Execute —— 代码层执行工具
 */
async function executeNode(state) {
  let toolResult = '';
  switch (state.route) {
    case 'weather':
      const w = await getWeather(state.toolParam || '澳门');
      toolResult = w ? `【实时天气】${w}` : '天气数据暂不可用';
      break;
    case 'time':
      toolResult = `【实时时间】${getTime(state.toolParam || '澳门')}`;
      break;
    case 'kb':
      const isBroad = /(有什么|推荐|介绍|好吃|好玩|有哪些)/.test(state.toolParam);
      if (isBroad) {
        toolResult = Object.values(kbContent).join('\n').split(/\n#{2,3}\s/).filter(p=>p.trim().length>5&&p.trim().length<80).slice(0,10).join('\n');
      } else {
        const kb = await hybridSearch(state.toolParam, 5);
        toolResult = kb.map(r=>`【${r.file}】${r.text.replace(/^#{1,4}\s/gm,'').substring(0,600)}`).join('\n\n') || '暂无相关信息';
      }
      break;
    case 'reject':
      toolResult = 'REJECT';
      break;
    default:
      toolResult = '';
  }
  return { ...state, toolResult };
}

/**
 * 节点3: Generate —— LLM生成最终回复
 */
async function generateNode(state) {
  if (state.route === 'reject') {
    return { ...state, finalReply: '抱歉，这属于客房服务范围。您可以拨打房间电话0联系前台，他们会为您安排～' };
  }
  const userMsg = state.messages[state.messages.length-1].content;
  const prompt = `【参考数据】\n${state.toolResult}\n\n【住客问题】${userMsg}\n请用管家小云的口吻简洁回复（不超3句话）。`;
  const res = await callLLM([
    { role:'system', content: SYSTEM },
    ...state.messages.slice(-4),
    { role:'user', content: prompt }
  ]);
  let reply = res?.choices?.[0]?.message?.content?.trim() || '抱歉，暂时无法处理。';
  // 双保险：回复中检测越界行为
  if (/(已为您准备|已为您安排|已为您送|已为您订|马上送到|马上安排|已通知客房)/.test(reply)) {
    reply = '抱歉，这属于客房服务范围。您可以拨打房间电话0联系前台，他们会为您安排～';
  }
  return { ...state, finalReply: reply };
}

// ======================== Graph Runner ========================
const HISTORY_DIR = path.join(__dirname, 'logs', 'sessions');
const cache = new Map();

async function chat(userMessage, locale, sessionId) {
  const ck = userMessage.trim().toLowerCase();
  if (cache.has(ck)) return cache.get(ck);

  const history = sessionId ? loadHistory(sessionId) : [];
  const messages = [...history.slice(-6), { role:'user', content: userMessage }];

  // 初始化状态
  let state = { messages, route:'', toolParam:'', toolResult:'', finalReply:'' };

  // ==== 状态图执行 ====
  state = await classifyNode(state);
  state = await executeNode(state);
  state = await generateNode(state);

  const reply = state.finalReply;

  // 保存
  if (sessionId) {
    history.push({ role:'user', content: userMessage }, { role:'assistant', content: reply });
    saveHistory(sessionId, history);
  }
  const skipCache = /(推荐|好吃|好玩|中餐|西餐|葡国|去哪|逛逛|吃什么)/.test(userMessage);
  if (!skipCache) cache.set(ck, reply);

  return reply;
}

function loadHistory(id) { try { const f = path.join(HISTORY_DIR, `${id}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f,'utf8')) : []; } catch { return []; } }
function saveHistory(id, h) { try { if(!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR,{recursive:true}); fs.writeFileSync(path.join(HISTORY_DIR,`${id}.json`), JSON.stringify(h.slice(-30)),'utf8'); } catch {} }

let total = 0;
function trackQuery() { total++; }
function getAnalytics() { return { total, cacheSize: cache.size, model: LLM.model, engine: 'LangGraph v4.0' }; }

module.exports = { chat, trackQuery, getAnalytics };
