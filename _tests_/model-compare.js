/**
 * 三模型对比测试: qwen3:8b vs qwen3.5:4b vs qwen3.5:9b
 */
const http=require('http'),fs=require('fs');

const MODELS=['qwen3:8b','qwen3.5:4b','qwen3.5:9b'];
const TESTS=[
  {q:'泳池在哪',type:'KB查询'},
  {q:'早餐几点开始',type:'KB查询'},
  {q:'澳门今天天气',type:'天气'},
  {q:'现在几点了',type:'时间'},
  {q:'帮我送毛巾',type:'边界'},
  {q:'有地方撸铁吗',type:'语义'},
];

function ask(model,msg){return new Promise(r=>{
  const body=JSON.stringify({model,messages:[
    {role:'system',content:'你是澳门威尼斯人酒店的金牌管家"小云"，热情贴心。酒店在澳门路氹城金光大道。\n## 底线\n只做信息问询。送物取物、点餐下单、控制设备→礼貌拒绝，告知拨0找前台。\n## 风格\n语音交互，简洁直接。问得宽给方向，问得细精准答。'},
    {role:'user',content:`【参考数据】V泳池在酒店地面及5楼户外园林区，有柏岸池等多个泳池。Bambu自助早餐06:30-10:30。WiFi免费，名称TheVenetian-Guest。\n\n【住客问题】${msg}\n请用管家口吻简洁回复。`}
  ],stream:false,think:false,options:{temperature:0.7,num_predict:200}});
  const t0=Date.now();
  const req=http.request('http://localhost:11434/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},timeout:120000},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{
    try{const j=JSON.parse(d);const t=Date.now()-t0;r({time:t,content:j.message?.content||'',reasoning:j.message?.thinking||'',eval:j.eval_count||0});}catch{r({time:0,content:'',reasoning:'',eval:0});}
  });});
  req.on('error',()=>r({time:0,content:'',reasoning:'',eval:0}));req.on('timeout',function(){this.destroy();r({time:0,content:'',reasoning:'',eval:0});});
  req.write(body);req.end();
});}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

(async()=>{
  const now=new Date();const ts=now.toISOString().replace(/[:.]/g,'-').substring(0,19);
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║    三模型对比: qwen3:8b vs qwen3.5:4b vs qwen3.5:9b  ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const allResults={};

  for(const model of MODELS){
    console.log('━━━ '+model+' ━━━');
    const modelResults=[];
    let totalTime=0, totalTokens=0, badReplies=0;

    for(const t of TESTS){
      process.stdout.write('  '+t.type+': "'+t.q+'"... ');
      const r=await ask(model,t.q);
      const bad=!r.content||r.content.includes('嗯，用户')||r.content.includes('首先，');
      if(bad) badReplies++;
      const icon=bad?'❌':r.time>3000?'🟡':'✅';
      modelResults.push({...t,...r,bad});
      totalTime+=r.time;totalTokens+=r.eval;
      console.log(icon+' '+(r.time||'?')+'ms | '+(bad?'THINK问题':(r.content||'').substring(0,50)));
      await sleep(500);
    }

    const avg=Math.round(totalTime/TESTS.length);
    const usable=TESTS.length-badReplies;
    allResults[model]={avg,usable,badReplies,totalTokens,details:modelResults};
    console.log('  平均:'+avg+'ms | 可用:'+usable+'/'+TESTS.length+' | 坏回复:'+badReplies+' | 总token:'+totalTokens+'\n');
  }

  // 汇总表
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║               对  比  汇  总                          ║');
  console.log('╠══════════════════╦═══════╦═══════╦═══════╦══════════╣');
  console.log('║ 指标              ║ qwen3:8b ║ qwen3.5:4b ║ qwen3.5:9b ║');
  console.log('╠══════════════════╬═══════╬═══════╬═══════╬══════════╣');
  const r3=allResults['qwen3:8b'],r35_4=allResults['qwen3.5:4b'],r35_9=allResults['qwen3.5:9b'];
  console.log('║ 平均延迟(ms)     ║ '+pad(r3.avg,5)+'║ '+pad(r35_4.avg,5)+'║ '+pad(r35_9.avg,5)+'  ║');
  console.log('║ 可用回复         ║ '+pad(r3.usable+'/6',5)+'║ '+pad(r35_4.usable+'/6',5)+'║ '+pad(r35_9.usable+'/6',5)+'  ║');
  console.log('║ think:false有效   ║   ✅   ║   ❌   ║   '+pad(r35_9.badReplies===0?'✅':'❌',3)+'  ║');
  console.log('║ 总token消耗       ║ '+pad(r3.totalTokens,5)+'║ '+pad(r35_4.totalTokens,5)+'║ '+pad(r35_9.totalTokens,5)+'  ║');
  console.log('╚══════════════════╩═══════╩═══════╩═══════╩══════════╝');

  // 保存
  const report={date:now.toISOString(),models:MODELS,summary:allResults};
  fs.writeFileSync('model-compare-'+ts+'.json',JSON.stringify(report,null,2),'utf8');
  console.log('\n📄 model-compare-'+ts+'.json');
})();
function pad(s,n){s=String(s);return s+' '.repeat(Math.max(0,n-s.length));}
