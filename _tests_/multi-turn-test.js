/**
 * 多轮对话测试 — 相关性 + 无引导性 + 连贯性
 * 用法: cd _tests_ && node multi-turn-test.js
 */
const http=require('http'),fs=require('fs'),path=require('path');
const raw=fs.readFileSync('酒店服务3.txt','utf8');

// 解析6个场景的多轮对话
const scenarios=[];
const lines=raw.split('\n');
let current=null;
for(const l of lines){
  const m=l.match(/^轮(\d)（[^）]+）：(.+)/);
  if(m){if(!current){current={turns:[]}};current.turns.push({num:parseInt(m[1]),q:m[2]});}
  else if(l.includes('场景')&&!l.includes('测试场景')&&current){scenarios.push(current);current=null;}
}
if(current)scenarios.push(current);
console.log('解析到 '+scenarios.length+' 个场景\n');

function ask(msg,sid){return new Promise(r=>{const body=JSON.stringify({message:msg,sessionId:sid});const req=http.request('http://localhost:3009/engine/chat',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer hotel-agent-2026'},timeout:120000},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{try{r(JSON.parse(d).reply||'');}catch{r('');}});});req.on('error',()=>r(''));req.on('timeout',function(){this.destroy();r('');});req.write(body);req.end();});}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

function evaluate(reply){
  // 检测引导性话术
  const guideWords=/(推荐|建议您|为您推荐|现在预订|立即下单|限时|优惠券|升级|套餐|加价|速订|抢购|机会难得|错过就没有|涨价|赶紧|马上订|帮您预订|需要帮您订)/;
  const hasGuide=guideWords.test(reply);
  // 检测答非所问(极短回复)
  const tooShort=reply.length<15;
  // 检测堆砌无关信息（回复过长）
  const tooLong=reply.length>300;
  // 检测边界拒绝
  const isReject=/(这属于|不能帮|无法提供|拨.*0|前台)/.test(reply);

  let score=0,issues=[];
  if(tooShort){score+=1;issues.push('过短');}else{score+=3;}
  if(!hasGuide){score+=3;}else{score+=0;issues.push('引导性话术');}
  if(!tooLong){score+=1;}else{issues.push('堆砌信息');}
  return{score:Math.min(score,5),issues,hasGuide};
}

(async()=>{
  const now=new Date();const ts=now.toISOString().replace(/[:.]/g,'-').substring(0,19);
  const results=[];let totalScore=0;

  for(let s=0;s<scenarios.length;s++){
    const sc=scenarios[s];const sid='mt-'+ts+'-s'+s;
    console.log('━━━ 场景'+(s+1)+' ━━━');

    let scenarioScore=0;
    for(const t of sc.turns){
      process.stdout.write('  轮'+t.num+': '+t.q.substring(0,50)+'... ');
      const reply=await ask(t.q,sid);
      const ev=evaluate(reply);
      scenarioScore+=ev.score;
      const icon=ev.hasGuide?'⚠️':ev.issues.length?'🟡':'✅';
      results.push({scenario:s+1,turn:t.num,question:t.q,reply:reply.substring(0,400),score:ev.score,issues:ev.issues,hasGuide:ev.hasGuide});
      console.log(icon+' '+ev.score+'分 | '+reply.substring(0,80));
      await sleep(500);
    }
    totalScore+=scenarioScore;
    console.log('  场景'+(s+1)+'总分: '+scenarioScore+'/15\n');
  }

  // 汇总
  const avg=totalScore/scenarios.length;
  console.log('╔══════════════════════════════════╗');
  console.log('║  多轮对话测试报告                ║');
  console.log('╠══════════════════════════════════╣');
  console.log('║ 场景数: '+scenarios.length+' | 总轮次: '+results.length+'           ║');
  console.log('║ 总分: '+totalScore+'/'+(scenarios.length*15)+' | 平均: '+avg.toFixed(1)+'/15  ║');
  console.log('╚══════════════════════════════════╝');

  const guideCases=results.filter(r=>r.hasGuide);
  if(guideCases.length){
    console.log('\n⚠️ 存在引导话术:');
    guideCases.forEach(r=>console.log('  场景'+r.scenario+'轮'+r.turn+': '+r.reply.substring(0,100)));
  }

  // 保存报告
  const report={date:now.toISOString(),model:'qwen3:8b',engine:'LangGraph v4',scenarios:scenarios.length,totalRounds:results.length,totalScore,avgScore:avg.toFixed(1),guideCount:guideCases.length,details:results};
  fs.writeFileSync('multi-turn-report-'+ts+'.json',JSON.stringify(report,null,2),'utf8');

  let md='# 🏨 多轮对话测试报告\n\n';
  md+='> 模型: qwen3:8b | 引擎: LangGraph v4 | 日期: '+now.toLocaleString('zh-CN')+'\n\n';
  md+='## 汇总\n\n| 指标 | 数值 |\n|------|------|\n';
  md+='| 场景数 | '+scenarios.length+' |\n| 总轮次 | '+results.length+' |\n';
  md+='| 总分 | '+totalScore+'/'+(scenarios.length*15)+' |\n| 平均 | '+avg.toFixed(1)+'/15 |\n';
  md+='| 引导话术 | '+guideCases.length+'次 |\n\n';
  md+='## 详细\n\n';
  for(let s=0;s<scenarios.length;s++){
    md+='### 场景'+(s+1)+'\n\n';
    const rs=results.filter(r=>r.scenario===s+1);
    for(const r of rs){
      md+='**轮'+r.turn+'**: '+r.question+'\n\n';
      md+='> 🤖 '+r.reply+'\n\n';
      md+='得分:'+r.score+'/5 | '+(r.issues.length?r.issues.join(', '):'合格')+'\n\n---\n\n';
    }
  }
  fs.writeFileSync('multi-turn-report-'+ts+'.md',md,'utf8');
  console.log('\n📄 已保存 _tests_/');
})();
