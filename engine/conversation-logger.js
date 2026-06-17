/**
 * ============================================================
 * 对话日志记录器
 * ============================================================
 *
 * 按日分目录: logs/YYYY-MM-DD/<sessionId>.md
 * 同一会话所有轮次追加到同一文件
 *
 * 调用: api-server.js → convLogger.log(sessionId, userMsg, reply)
 * ============================================================
 */
const fs = require('fs');
const path = require('path');
const LOGS_DIR = path.join(__dirname, 'logs');

const sessions = {};

function log(sessionId, userMsg, reply) {
  if (!sessionId) return;

  const now = new Date();
  const dateDir = now.toISOString().split('T')[0];
  const dir = path.join(LOGS_DIR, dateDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, `${sessionId}.md`);

  // 新会话写头部
  if (!sessions[sessionId]) {
    sessions[sessionId] = true;
    const header = [
      `# 🏨 对话记录`,
      '',
      `- **会话ID**: ${sessionId}`,
      `- **日期**: ${now.toLocaleDateString('zh-CN', { year:'numeric', month:'long', day:'numeric', weekday:'long' })}`,
      `- **酒店**: 澳门威尼斯人酒店`,
      '',
      '---',
      ''
    ].join('\n');
    fs.writeFileSync(filePath, header, 'utf8');
  }

  const time = now.toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit' });
  const entry = [
    '',
    `### 🕐 ${time}`,
    '',
    `**👤 住客**: ${userMsg}`,
    '',
    `**🤖 小云**: ${reply}`,
    '',
    '---',
    ''
  ].join('\n');

  fs.appendFileSync(filePath, entry, 'utf8');
}

module.exports = { log };
