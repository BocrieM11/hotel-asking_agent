/**
 * Agent 性能基准测试
 * 测试: 置信度、首token延迟、输出速度、token消耗
 */
const http = require('http');
const fs = require('fs');

const TEST_CASES = [
  {q:'泳池在哪',type:'KB查询'},
  {q:'早餐几点开始',type:'KB查询'},
  {q:'澳门今天天气怎么样',type:'天气API'},
  {q:'现在几点了',type:'时间查询'},
  {q:'帮我送毛巾到302',type:'边界拒绝'},
  {q:'酒店有什么好吃的',type:'引导对话'},
  {q:'附近有什么好玩的',type:'引导对话'},
  {q:'中餐推荐',type:'推荐变化'},
];

function benchmarkAgent(msg) {
  return new Promise(r => {
    const t0 = Date.now();
    const body = JSON.stringify({message:msg,sessionId:'bm-'+Date.now()});
    const req = http.request('http://localhost:3009/engine/chat',{
      method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer hotel-agent-2026'},timeout:120000
    },res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{
      const t=Date.now()-t0;
      try{const j=JSON.parse(d);r({reply:j.reply,totalMs:t,replyLen:j.reply?.length||0});}catch{r({reply:'',totalMs:t,replyLen:0});}
    });});
    req.on('error',()=>r({reply:'',totalMs:0,replyLen:0}));
    req.write(body);req.end();
  });
}

function benchmarkRaw(prompt, hasSystem) {
  return new Promise(r => {
    const msgs = hasSystem
      ? [{role:'system',content:'你是酒店管家小云。回复简洁。'},{role:'user',content:prompt}]
      : [{role:'user',content:prompt}];
    const body = JSON.stringify({model:'qwen3:8b',messages:msgs,stream:true,think:false,
      options:{temperature:0.7,num_predict:256}});
    const t0 = Date.now();
    let firstToken = 0, tokenCount = 0, fullText = '', firstTokenMs = 0;

    const req = http.request('http://localhost:11434/api/chat',{
      method:'POST',headers:{'Content-Type':'application/json'},timeout:120000
    },res => {
      res.on('data', chunk => {
        const text = chunk.toString();
        const lines = text.split('\n').filter(l=>l.trim());
        for (const line of lines) {
          try {
            const j = JSON.parse(line);
            if (j.message?.content) {
              if (!firstToken) { firstToken = Date.now(); firstTokenMs = firstToken - t0; }
              tokenCount++;
              fullText += j.message.content;
            }
          } catch {}
        }
      });
      res.on('end', () => {
        const totalMs = Date.now() - t0;
        const genMs = totalMs - firstTokenMs;
        const tps = genMs > 0 ? (tokenCount / (genMs / 1000)).toFixed(1) : 0;
        r({firstTokenMs, tokenCount, totalMs, tps, fullText:fullText.substring(0,150)});
      });
    });
    req.on('error',()=>r({firstTokenMs:0,tokenCount:0,totalMs:0,tps:0,fullText:''}));
    req.write(body);req.end();
  });
}

(async () => {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Agent 性能基准 — qwen3:8b + GPU        ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // ====== 1. Agent端到端延迟 ======
  console.log('━━━ 1. Agent 端到端延迟 ━━━');
  const agentResults = [];
  for (const tc of TEST_CASES) {
    process.stdout.write(`  ${tc.type}: "${tc.q.substring(0,20)}"... `);
    const r = await benchmarkAgent(tc.q);
    agentResults.push({...tc, ...r});
    console.log(`${r.totalMs}ms | ${r.replyLen}字`);
  }
  const avgAgent = Math.round(agentResults.reduce((a,b)=>a+b.totalMs,0)/agentResults.length);
  console.log(`  平均端到端延迟: ${avgAgent}ms\n`);

  // ====== 2. 模型原始性能 (首token/速率) ======
  console.log('━━━ 2. 模型原始性能 (streaming) ━━━');
  const prompts = ['泳池在哪','今天天气怎么样','酒店有什么好吃的推荐一下'];
  const rawResults = [];
  for (const p of prompts) {
    process.stdout.write(`  "${p}" ... `);
    const r = await benchmarkRaw(p, true);
    rawResults.push(r);
    console.log(`首token:${r.firstTokenMs}ms | ${r.tokenCount} tokens | ${r.tps} tok/s | 总${r.totalMs}ms`);
  }
  const avgTTFT = Math.round(rawResults.reduce((a,b)=>a+b.firstTokenMs,0)/rawResults.length);
  const avgTPS = (rawResults.reduce((a,b)=>a+parseFloat(b.tps),0)/rawResults.length).toFixed(1);
  const avgTokens = Math.round(rawResults.reduce((a,b)=>a+b.tokenCount,0)/rawResults.length);
  console.log(`  平均首token: ${avgTTFT}ms | 平均速率: ${avgTPS} tok/s | 平均输出: ${avgTokens} tokens\n`);

  // ====== 3. 置信度评估 (基于回复一致性) ======
  console.log('━━━ 3. 置信度(一致性) ━━━');
  const confTests = ['泳池在哪','早餐几点'];
  for (const q of confTests) {
    const replies = [];
    for (let i=0;i<3;i++) replies.push((await benchmarkAgent(q)).reply);
    const similar = replies.filter(r=>r===replies[0]).length;
    const unique = [...new Set(replies.map(r=>r.substring(0,30)))].length;
    const conf = unique===1 ? '高' : unique===2 ? '中' : '低';
    process.stdout.write(`  "${q}" x3 → ${unique}种回复 → 置信度:${conf}\n`);
  }

  // ====== 汇总报告 ======
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║           性 能 报 告                    ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log('║ 模型: qwen3:8b  |  GPU: RTX 4060 8GB     ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║ 首token延迟:  ${avgTTFT}ms                    ║`);
  console.log(`║ 输出速率:     ${avgTPS} tok/s                  ║`);
  console.log(`║ 平均输出:     ${avgTokens} tokens/次              ║`);
  console.log(`║ Agent端到端:  ${avgAgent}ms                   ║`);
  console.log('╚══════════════════════════════════════════╝');

  // 保存
  const report = {
    date: new Date().toISOString(),
    model:'qwen3:8b', gpu:'RTX 4060 8GB',
    summary: { avgTTFT:avgTTFT+'ms', avgTPS:avgTPS+'tok/s', avgTokens, avgAgent:avgAgent+'ms' },
    agentDetail: agentResults,
    rawDetail: rawResults
  };
  fs.writeFileSync('benchmark-report.json',JSON.stringify(report,null,2),'utf8');
  console.log('\n📄 benchmark-report.json 已保存');
})();
