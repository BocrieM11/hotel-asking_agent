const http = require('http');
const tests = require('./test-suite.json');

async function ask(msg) {
  return new Promise(r => {
    const body = JSON.stringify({ message: msg, sessionId: 't' + Date.now() });
    const req = http.request('http://localhost:3009/engine/chat', {
      method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer hotel-agent-2026'}, timeout:120000
    }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{r(JSON.parse(d).reply||''); }catch{r('');} }); });
    req.on('error',()=>r('')); req.on('timeout',function(){this.destroy();r('');}); req.write(body); req.end();
  });
}

function score(reply, expect) {
  const hits = expect.split('/').filter(k => reply.includes(k.trim()));
  if (hits.length >= 2) return 'PASS';
  if (hits.length === 1) return 'OK';
  return 'FAIL';
}

(async () => {
  console.log('Agent 参数优化测试\n');
  let pass=0, ok=0, fail=0, total=0;

  for (const t of tests) {
    total++;
    process.stdout.write(`[${total}/${tests.length}] ${t.q.substring(0,25)} ... `);
    const reply = await ask(t.q);
    const s = score(reply, t.expect);
    const icon = s==='PASS'?'✅':s==='OK'?'⚠️':'❌';
    console.log(`${icon} ${s} | ${reply.substring(0,80)}`);
    if (s==='PASS') pass++; else if (s==='OK') ok++; else fail++;
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅PASS:${pass} ⚠️OK:${ok} ❌FAIL:${fail} | 通过率:${((pass+ok*0.5)/total*100).toFixed(0)}%`);
})();
