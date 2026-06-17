/**
 * 酒店服务测试集 全量运行脚本
 * 用法: node full-test.js
 * 输出: test-results/ 目录下保存报告+每轮日志
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const RESULT_DIR = __dirname;
const now = new Date();
const timestamp = now.toISOString().replace(/[:.]/g, '-').substring(0, 19);
if (!fs.existsSync(RESULT_DIR)) fs.mkdirSync(RESULT_DIR, { recursive: true });

// 解析题目
const raw = fs.readFileSync(path.join(__dirname, '酒店服务.txt'), 'utf8');
const lines = raw.split('\n').filter(l => l.trim() && !l.startsWith('一、') && !l.startsWith('二、') && !l.startsWith('三、') && !l.startsWith('四、') && !l.startsWith('五、') && !l.startsWith('六、') && !l.startsWith('七、') && !l.startsWith('八、') && !l.startsWith('九、') && !l.startsWith('十、'));
const questions = lines.map(l => l.replace(/^\d+[\.\、\s]+/, '').trim()).filter(q => q.length > 2);

function ask(msg) {
  return new Promise(r => {
    const body = JSON.stringify({ message: msg, sessionId: 'test-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) });
    const req = http.request('http://localhost:3009/engine/chat', {
      method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer hotel-agent-2026'}, timeout:120000
    }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{r(JSON.parse(d).reply||''); }catch{r('');} }); });
    req.on('error',()=>r('')); req.on('timeout',function(){this.destroy();r('');}); req.write(body); req.end();
  });
}

(async () => {
  console.log(`🔄 开始测试 ${questions.length} 题...\n`);

  const results = [];
  let pass=0, fail=0, err=0;

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    process.stdout.write(`[${i+1}/${questions.length}] ${q.substring(0,40)}... `);

    let reply = '';
    try {
      reply = await ask(q);
    } catch(e) {
      reply = '';
    }

    // 判断是否有效回复（非拒绝，非模糊）
    const noAnswer = /(抱歉|暂时无法|不能|帮不到|超出|不清楚|不确定)/.test(reply);
    const isShort = reply.length < 10;
    const status = (noAnswer || isShort) ? 'MISS' : 'HIT';

    results.push({ index: i+1, question: q, reply: reply.substring(0, 300), status, length: reply.length });

    if (status === 'HIT') pass++;
    else if (status === 'MISS') fail++;
    else err++;

    const icon = status === 'HIT' ? '✅' : '❌';
    console.log(`${icon} ${status} (${reply.length}字)`);
  }

  // 保存详细报告
  const report = {
    date: now.toISOString(),
    model: 'qwen3:8b',
    total: questions.length,
    hit: pass,
    miss: fail,
    error: err,
    hitRate: (pass / questions.length * 100).toFixed(1) + '%',
    details: results
  };

  const reportPath = path.join(RESULT_DIR, `report-${timestamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  // 保存可读文本报告
  let txt = `🏨 酒店问询Agent 测试报告\n`;
  txt += `━━━━━━━━━━━━━━━━━━━━\n`;
  txt += `时间: ${now.toLocaleString('zh-CN')}\n`;
  txt += `模型: qwen3:8b | 总题: ${questions.length}\n`;
  txt += `✅ HIT: ${pass} (${(pass/questions.length*100).toFixed(1)}%)\n`;
  txt += `❌ MISS: ${fail} (${(fail/questions.length*100).toFixed(1)}%)\n\n`;
  txt += `--- 详细 ---\n\n`;
  for (const r of results) {
    txt += `[${r.status}] ${r.question}\n  → ${r.reply.substring(0, 200)}\n\n`;
  }
  fs.writeFileSync(path.join(RESULT_DIR, `report-${timestamp}.txt`), txt, 'utf8');

  console.log(`\n📊 报告已保存: ${reportPath}`);
  console.log(`✅ HIT: ${pass}/${questions.length} (${(pass/questions.length*100).toFixed(1)}%)`);
  console.log(`❌ MISS: ${fail}/${questions.length} (${(fail/questions.length*100).toFixed(1)}%)`);
})();
