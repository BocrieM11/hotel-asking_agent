/**
 * 对话记录器 — 将每次会话保存到 logs/ 文件夹
 *
 * 目录结构:
 *   engine/logs/
 *     └── 2026-06-10/
 *         └── web-a1b2c3d4_120530.md
 */

const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, 'logs');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * 开始新会话日志
 * @returns {{ sessionId: string, filePath: string }}
 */
function startSession(sessionId) {
  if (!sessionId) return null;

  const now = new Date();
  const dateDir = now.toISOString().split('T')[0];      // 2026-06-10
  const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, ''); // 120530
  const shortId = (sessionId || 'unknown').slice(-8);
  const filename = `${shortId}_${timeStr}.md`;

  const dirPath = path.join(LOGS_DIR, dateDir);
  ensureDir(dirPath);
  const filePath = path.join(dirPath, filename);

  const header = [
    `# 🏨 对话记录`,
    '',
    `- **日期**: ${now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}`,
    `- **开始时间**: ${now.toLocaleTimeString('zh-CN')}`,
    `- **会话ID**: ${sessionId}`,
    `- **酒店**: 澳门威尼斯人酒店`,
    '',
    '---',
    ''
  ].join('\n');

  fs.writeFileSync(filePath, header, 'utf8');
  return { sessionId, filePath };
}

/**
 * 记录一轮对话
 */
function logTurn(sessionLog, userMsg, systemReply, intent, faqTopic) {
  if (!sessionLog || !sessionLog.filePath) return;

  const now = new Date();
  const time = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  const entry = [
    `### 🕐 ${time}`,
    '',
    `**👤 住客**: ${userMsg}`,
    '',
    `**🤖 小云**: ${systemReply}`,
    '',
    `> 意图: ${intent || '未知'} | 话题: ${faqTopic || '无'} | result: ${'execute'}`,
    '',
    '---',
    ''
  ].join('\n');

  try {
    fs.appendFileSync(sessionLog.filePath, entry, 'utf8');
  } catch (e) {
    console.error('[Logger] 写入失败:', e.message);
  }
}

module.exports = { startSession, logTurn };
