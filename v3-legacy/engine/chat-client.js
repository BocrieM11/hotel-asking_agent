/**
 * 问询子系统 — 交互式命令行客户端
 *
 * 用法：
 *   1. 先启动服务器:  cd engine && node api-server.js
 *   2. 再运行客户端:  cd engine && node chat-client.js
 *   3. 输入问题，按回车发送；输入 exit 退出
 */

const readline = require('readline');
const http = require('http');

const SERVER = { hostname: 'localhost', port: 3009 };

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '\n💬 你: '
});

console.log('╔══════════════════════════════════════════════════╗');
console.log('║        🏨 酒店问询子系统 — 交互式客户端           ║');
console.log('╠══════════════════════════════════════════════════╣');
console.log('║  可以问我:                                        ║');
console.log('║    • 酒店FAQ:  早餐几点? WiFi密码? 泳池在哪?      ║');
console.log('║    • 天气查询:  北京天气? 明天上海下雨吗?         ║');
console.log('║    • 时间查询:  纽约现在几点?                     ║');
console.log('║    • 酒店呼叫:  帮我叫前台                        ║');
console.log('║    • 退房/停车/健身房/周边景点/交通/房型...       ║');
console.log('║  输入 exit 退出                                    ║');
console.log('╚══════════════════════════════════════════════════╝');

function ask(question) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ message: question, locale: 'zh-CN' });
    const req = http.request({
      hostname: SERVER.hostname,
      port: SERVER.port,
      path: '/engine/chat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error('解析响应失败: ' + body));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function formatReply(result) {
  if (result.result_type === 'execute') {
    // 成功回答
    const icon = result.final_intent?.intent_L1 === 'WEATHER_QUERY' ? '🌤️' :
                 result.final_intent?.intent_L1 === 'TIME_QUERY' ? '🕐' :
                 result.final_intent?.intent_L1 === 'HOTEL_CALL' ? '📞' : '📋';
    console.log(`\n${icon} 小云: ${result.reply || '已处理'}`);
    if (result.kb_content) {
      console.log(`\n📖 知识库参考: ${result.kb_source || ''}`);
      console.log('─'.repeat(50));
      console.log(result.kb_content.substring(0, 500));
      if (result.kb_content.length > 500) console.log('...(已截断)');
      console.log('─'.repeat(50));
    }
    if (result.weather_data) {
      const w = result.weather_data;
      console.log(`   📍 ${w.location} | ${w.date}`);
      console.log(`   🌡️  ${w.temperature}°C (体感 ${w.feels_like}°C) | ${w.condition}`);
      console.log(`   💧 湿度 ${w.humidity}% | 🌬️ 风力 ${w.wind}`);
    }
    if (result.outfit_suggestion) {
      console.log(`   👔 ${result.outfit_suggestion}`);
    }
    if (result.time_data) {
      console.log(`   🕐 ${result.time_data.formatted}`);
    }
  } else if (result.result_type === 'need_clarify') {
    // 需要澄清
    console.log(`\n🤔 小云: ${result.reply || '请补充更多信息'}`);
    if (result.clarify_info?.candidates?.length > 0) {
      console.log('   💡 您可以尝试:');
      for (const c of result.clarify_info.candidates.slice(0, 5)) {
        console.log(`      - ${c.display || c.canonical}`);
      }
    }
  } else {
    console.log(`\n❌ 小云: 抱歉，我无法处理这个请求`);
  }
}

async function main() {
  rl.prompt();
  for await (const line of rl) {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      continue;
    }
    if (input === 'exit' || input === 'quit' || input === '退出') {
      console.log('👋 再见！');
      process.exit(0);
    }

    try {
      const result = await ask(input);
      formatReply(result);
    } catch (e) {
      console.log(`\n⚠️ 错误: ${e.message}`);
      console.log('   请确认服务器已启动: node engine/api-server.js');
    }
    rl.prompt();
  }
}

main();
