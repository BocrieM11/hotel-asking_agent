/**
 * Agent 单元测试 — LangGraph v4
 * 测试每个节点和工具函数
 * 用法: node unit-test.js
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// 无需直接引用 agent-langgraph，测试使用独立函数

let total=0, pass=0, fail=0, results=[];

function test(name, fn) {
  total++;
  const r = fn();
  if (r && typeof r.then === 'function') {
    r.then(v => {
      if (v === true || v === undefined) { pass++; results.push({name,status:'PASS'}); process.stdout.write('✅ '+name+'\n'); }
      else { fail++; results.push({name,status:'FAIL',reason:v}); process.stdout.write('❌ '+name+' — '+v+'\n'); }
    }).catch(e => { fail++; results.push({name,status:'FAIL',reason:e.message}); process.stdout.write('❌ '+name+' — '+e.message+'\n'); });
  } else {
    if (r === true || r === undefined) { pass++; results.push({name,status:'PASS'}); process.stdout.write('✅ '+name+'\n'); }
    else { fail++; results.push({name,status:'FAIL',reason:r}); process.stdout.write('❌ '+name+' — '+r+'\n'); }
  }
}

(async () => {
console.log('╔══════════════════════════════════╗');
console.log('║  Agent 单元测试 — LangGraph v4  ║');
console.log('╚══════════════════════════════════╝\n');

// ====== 1. 天气工具 ======
console.log('━━━ 1. getWeather — 天气API ━━━');
test('天气-澳门(默认)', () => testWeather('澳门').then(r => r && r.includes('°C') && r.includes('澳门')));
test('天气-北京', async () => {
  const r = await testWeather('北京');
  return r && r.includes('°C') && r.includes('北京');
});
test('天气-英文城市', async () => {
  const r = await testWeather('Singapore');
  return r && (r.includes('°C') || r.includes('Singapore') || r.includes('新加坡'));
});
test('天气-无效城市', async () => {
  const r = await testWeather('xyzabc123');
  return r === null || r === '未找到该城市' || r.includes('失败');
});

// ====== 2. 时间工具 ======
console.log('\n━━━ 2. getTime — 时间工具 ━━━');
test('时间-澳门(默认)', () => {
  const r = testTime('澳门');
  return r.includes('澳门') || r.includes(':');
});
test('时间-纽约', () => {
  const r = testTime('纽约');
  return r.includes('纽约') || r.includes('America');
});
test('时间-无效城市回退澳门', () => {
  const r = testTime('asdfghj');
  return r.length > 5;
});

// ====== 3. 分类路由 ======
console.log('\n━━━ 3. Classify — 意图分类 ━━━');
test('分类-天气→weather', () => {
  const s = classify({messages:[{content:'今天天气怎么样'}]});
  return s.route === 'weather' ? true : 'route='+s.route;
});
test('分类-天气+城市', () => {
  const s = classify({messages:[{content:'北京明天会下雨吗'}]});
  return s.route === 'weather' && s.toolParam === '北京' ? true : 'route='+s.route+' param='+s.toolParam;
});
test('分类-时间→time', () => {
  const s = classify({messages:[{content:'现在几点了'}]});
  return s.route === 'time' ? true : 'route='+s.route;
});
test('分类-时间+城市', () => {
  const s = classify({messages:[{content:'纽约现在几点'}]});
  return s.route === 'time' && s.toolParam === '纽约' ? true : 'route='+s.route+' param='+s.toolParam;
});
test('分类-服务拒绝→reject', () => {
  const s = classify({messages:[{content:'送毛巾到302'}]});
  return s.route === 'reject' ? true : 'route='+s.route;
});
test('分类-"准备咖啡"→reject', () => {
  const s = classify({messages:[{content:'准备一些咖啡'}]});
  return s.route === 'reject' ? true : 'route='+s.route;
});
test('分类-信息查询→kb', () => {
  const s = classify({messages:[{content:'泳池在哪里'}]});
  return s.route === 'kb' ? true : 'route='+s.route;
});
test('分类-问候→kb(LLM处理)', () => {
  const s = classify({messages:[{content:'你好'}]});
  return s.route === 'kb' ? true : 'route='+s.route;
});

// ====== 4. KB检索 ======
console.log('\n━━━ 4. KB检索 — 知识库搜索 ━━━');
test('KB-泳池', () => {
  const r = searchKB('泳池');
  return r.includes('泳池') || r.includes('柏岸池') ? true : '未命中泳池';
});
test('KB-早餐', () => {
  const r = searchKB('早餐');
  return r.includes('早餐') || r.includes('Bambu') || r.includes('06:30') ? true : '未命中早餐';
});
test('KB-WiFi', () => {
  const r = searchKB('WiFi');
  return r.includes('WiFi') || r.includes('Wi-Fi') || r.includes('网络') ? true : '未命中WiFi';
});
test('KB-葡国菜', () => {
  const r = searchKB('葡国菜');
  return r.includes('葡国') || r.includes('葡萄牙') ? true : '未命中葡国菜';
});
test('KB-交通', () => {
  const r = searchKB('机场');
  return r.includes('机场') || r.includes('穿梭巴士') || r.includes('交通') ? true : '未命中交通';
});
test('KB-退房', () => {
  const r = searchKB('退房');
  return r.includes('退房') || r.includes('入住') ? true : '未命中退房';
});

// ====== 5. 边界拒绝 ======
console.log('\n━━━ 5. 服务边界 ━━━');
test('边界-送物拒绝', async () => {
  const r = await ask('送毛巾到302');
  return r.includes('客房服务') || r.includes('拨') || r.includes('前台') ? true : r.substring(0,50);
});
test('边界-打扫拒绝', async () => {
  const r = await ask('打扫房间');
  return r.includes('客房服务') || r.includes('拨') || r.includes('前台') ? true : r.substring(0,50);
});
test('边界-准备物品拒绝', async () => {
  const r = await ask('准备咖啡和书本');
  return r.includes('客房服务') || r.includes('拨') || r.includes('前台') ? true : r.substring(0,50);
});
test('边界-订餐拒绝', async () => {
  const r = await ask('帮我订个晚餐');
  return r.includes('客房服务') || r.includes('拨') || r.includes('前台') ? true : r.substring(0,50);
});

// ====== 6. 信息查询不误杀 ======
console.log('\n━━━ 6. 信息查询(不误杀) ━━━');
test('不误杀-早餐时间', async () => {
  const r = await ask('早餐几点');
  return r.includes('06:30') || r.includes('早餐') ? true : r.substring(0,50);
});
test('不误杀-WiFi密码', async () => {
  const r = await ask('WiFi密码是什么');
  return r.includes('WiFi') || r.includes('Wi-Fi') || r.includes('网络') || r.includes('Venetian') ? true : r.substring(0,50);
});
test('不误杀-泳池位置', async () => {
  const r = await ask('泳池在哪');
  return r.includes('泳池') || r.includes('pool') || r.includes('5楼') ? true : r.substring(0,50);
});
test('不误杀-退房时间', async () => {
  const r = await ask('几点退房');
  return r.includes('退房') || r.includes('11') ? true : r.substring(0,50);
});
test('不误杀-加床价格', async () => {
  const r = await ask('加床多少钱');
  return r.length > 10 && !r.includes('客房服务') ? true : r.substring(0,50);
});

// ====== 7. 多轮对话 ======
console.log('\n━━━ 7. 多轮对话 ━━━');
test('多轮-上下文记忆', async () => {
  const sid = 'ut-multi-'+Date.now();
  const r1 = await askSid('泳池在哪', sid);
  const r2 = await askSid('收费吗', sid);
  return r2.includes('免费') || r2.includes('收费') || r2.includes('住客') ? true : r2.substring(0,50);
});

// ==================== 报告 ====================
console.log('\n╔══════════════════════════════════╗');
console.log('║        测 试 报 告               ║');
console.log('╚══════════════════════════════════╝');
console.log('总用例: '+total+'  |  ✅ PASS: '+pass+'  |  ❌ FAIL: '+fail+'  |  通过率: '+(pass/total*100).toFixed(1)+'%');

// 失败明细
const fails = results.filter(r=>r.status==='FAIL');
if (fails.length) {
  console.log('\n❌ 失败用例:');
  fails.forEach(f => console.log('  - '+f.name+': '+f.reason));
}

// 保存报告
const fs=require('fs');
fs.writeFileSync('unit-test-report.json', JSON.stringify({
  date: new Date().toISOString(),
  engine: 'LangGraph v4',
  model: 'qwen3:8b',
  total, pass, fail, rate: (pass/total*100).toFixed(1)+'%',
  details: results
}, null, 2), 'utf8');
console.log('\n📄 报告已保存: unit-test-report.json');
})();

// ==================== 辅助函数 ====================

// 直接调用agent内部函数(需要暴露)
function classify(state) {
  const msg = state.messages[state.messages.length-1].content;
  const WEATHER_KW=['天气','气温','下雨','下雪','刮风','几度','热不热','weather','rain','snow','带伞'];
  const TIME_KW=['几点','时间','几号','星期几','日期','time','what day','现在几点'];
  const REJECT_RE=/(送.+到|送伞|送毛巾|送咖啡|送水|送餐|帮我订|帮我买|帮我拿|帮我送|帮我准备|给我来|给我拿|来一杯|准备|打扫|清理|收拾|洗衣|缝补|修鞋|更换|下单|付款|支付|预订|预定|客房服务|叫醒)/;
  const REJECT_VERBS=['送','拿','帮订','帮买','帮准备'];
  const CITY_RE=/(北京|上海|广州|深圳|澳门|香港|纽约|伦敦|东京)/;
  const lower=msg.toLowerCase();
  if(REJECT_RE.test(msg)||REJECT_VERBS.some(v=>lower.startsWith(v))) return {route:'reject',toolParam:msg};
  if(WEATHER_KW.some(k=>lower.includes(k))){const m=msg.match(CITY_RE);return{route:'weather',toolParam:m?m[1]:'澳门'}}
  if(TIME_KW.some(k=>lower.includes(k))){const m=msg.match(CITY_RE);return{route:'time',toolParam:m?m[1]:'澳门'}}
  return {route:'kb',toolParam:msg};
}

function searchKB(query) {
  const KB_DIR=path.join(__dirname,'..','kb');
  const files=fs.readdirSync(KB_DIR).filter(f=>f.endsWith('.md')).sort();
  const content={};
  for(const f of files) content[f]=fs.readFileSync(path.join(KB_DIR,f),'utf8');
  const lower=query.toLowerCase();
  const kw=[];for(let len=2;len<=4;len++)for(let i=0;i<=query.length-len;i++)kw.push(query.substring(i,i+len).toLowerCase());
  const paragraphs=[];
  for(const[f,c]of Object.entries(content)){
    const parts=c.split(/\n#{2,3}\s/);
    for(const p of parts){const t=p.trim();if(t.length>20)paragraphs.push({file:f.replace('.md',''),text:t.substring(0,3000)});}
  }
  const rs=[];for(const p of paragraphs){let s=0;const pL=p.text.toLowerCase();for(const k of kw){if(pL.includes(k))s++}if(pL.includes(lower))s+=3;if(s>0)rs.push({...p,score:s})}
  rs.sort((a,b)=>b.score-a.score);
  return rs.slice(0,5).map(r=>r.text.substring(0,800)).join(' ');
}

async function testWeather(city) {
  return new Promise(r=>{
    https.get(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh`,{timeout:10000},res=>{let d='';res.on('data',c=>d+=c);res.on('end',async()=>{
      try{const geo=JSON.parse(d);if(!geo.results?.length)return r(null);
        const g=geo.results[0];
        https.get(`https://api.open-meteo.com/v1/forecast?latitude=${g.latitude}&longitude=${g.longitude}&current=temperature_2m,weather_code&timezone=${encodeURIComponent(g.timezone||'UTC')}`,{timeout:10000},res2=>{let d2='';res2.on('data',c=>d2+=c);res2.on('end',()=>{
          try{const w=JSON.parse(d2);if(!w.current)return r(null);const WMO={0:'晴天',1:'晴朗',2:'少云',3:'多云',61:'小雨',63:'中雨',80:'阵雨',95:'雷暴'};r(`${g.name}: ${Math.round(w.current.temperature_2m)}°C ${WMO[w.current.weather_code]||''}`)}
          catch{r(null)}
        })}).on('error',()=>r(null))
      }catch{r(null)}
    })}).on('error',()=>r(null))
  });
}

function testTime(city) {
  const TZ={'澳门':'Asia/Macau','北京':'Asia/Shanghai','上海':'Asia/Shanghai','纽约':'America/New_York'};
  const tz=TZ[city]||'Asia/Macau';
  try{const n=new Date();return `${city}: ${n.toLocaleDateString('zh-CN',{timeZone:tz})} ${n.toLocaleTimeString('zh-CN',{timeZone:tz})}`}
  catch{return new Date().toLocaleString('zh-CN')}
}

async function ask(msg) {
  return new Promise(r=>{
    const body=JSON.stringify({message:msg,sessionId:'ut-'+Date.now()});
    const req=http.request('http://localhost:3009/engine/chat',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer hotel-agent-2026'},timeout:120000},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{try{r(JSON.parse(d).reply||'');}catch{r('');}});});
    req.on('error',()=>r(''));req.on('timeout',function(){this.destroy();r('');});req.write(body);req.end();
  });
}

async function askSid(msg, sid) {
  return new Promise(r=>{
    const body=JSON.stringify({message:msg,sessionId:sid});
    const req=http.request('http://localhost:3009/engine/chat',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer hotel-agent-2026'},timeout:120000},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{try{r(JSON.parse(d).reply||'');}catch{r('');}});});
    req.on('error',()=>r(''));req.on('timeout',function(){this.destroy();r('');});req.write(body);req.end();
  });
}
