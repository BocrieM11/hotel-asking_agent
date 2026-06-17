/**
 * 会话存储器 — 轻量级会话上下文管理
 *
 * 职责：
 *   1. 存储每个 sessionId 的对话历史
 *   2. 从历史中解析上下文（上轮话题、实体引用）
 *   3. 为 LLM prompt 构建上下文信息
 *
 * 用法：
 *   const session = sessionStore.get(sessionId);
 *   session.addTurn(userMsg, systemReply, intent);
 *   const ctx = session.getContext(); // → { lastTopic, lastEntity, history }
 */

// 内存存储（生产环境可替换为 Redis/DB）
const sessions = new Map();

// 会话过期时间（30分钟不活动则清除）
const SESSION_TTL = 30 * 60 * 1000;

// 最大历史轮数（保留最近50轮对话）
const MAX_HISTORY = 50;
// 实体栈最大深度（记住最近10个话题实体）
const MAX_ENTITY_STACK = 10;

class Session {
  constructor(id) {
    this.id = id;
    this.history = [];         // [{role, content, intent, timestamp}]
    this.lastTopic = null;     // 上轮 faq_topic
    this.lastEntity = null;    // 最新提到的实体
    this.entityStack = [];     // 最近N个实体（去重，最新在前）
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
  }

  addTurn(userMsg, systemReply, intent, faqTopic) {
    this.history.push({
      role: 'user',
      content: userMsg,
      intent: intent || null,
      timestamp: Date.now()
    });
    this.history.push({
      role: 'assistant',
      content: systemReply,
      faqTopic: faqTopic || null,
      timestamp: Date.now()
    });

    // 裁剪历史
    if (this.history.length > MAX_HISTORY * 2) {
      this.history = this.history.slice(-MAX_HISTORY * 2);
    }

    // 更新上下文
    this.lastTopic = faqTopic || intent || this.lastTopic;
    this.lastEntity = extractMainEntity(userMsg, systemReply);

    // 更新实体栈（去重，最新的放最前）
    if (this.lastEntity) {
      this.entityStack = this.entityStack.filter(e => e !== this.lastEntity);
      this.entityStack.unshift(this.lastEntity);
      if (this.entityStack.length > MAX_ENTITY_STACK) this.entityStack.pop();
    }

    this.updatedAt = Date.now();
  }

  getContext() {
    // 构建早期对话摘要（给 LLM 更多上下文但不占太多 token）
    const allHistory = this.history;
    const recentHistory = allHistory.slice(-20);   // 最近10轮 → LLM prompt
    const olderHistory = allHistory.slice(0, -20); // 更早的 → 压缩摘要

    let summary = '';
    if (olderHistory.length > 0) {
      const topics = [];
      for (const h of olderHistory) {
        if (h.faqTopic && !topics.includes(h.faqTopic)) topics.push(h.faqTopic);
      }
      if (topics.length > 0) {
        summary = `[更早的对话中，住客问过: ${topics.join('、')}]`;
      }
    }

    return {
      lastTopic: this.lastTopic,
      lastEntity: this.lastEntity,
      entityStack: [...this.entityStack],
      recentHistory: recentHistory,              // 最近10轮完整对话
      olderSummary: summary,                     // 更早的压缩摘要
      turnCount: Math.floor(allHistory.length / 2)
    };
  }

  isExpired() {
    return Date.now() - this.updatedAt > SESSION_TTL;
  }
}

// ======================== 实体提取 ========================

/**
 * 从用户消息和系统回复中提取"当前话题实体"
 * 用于后续指代消解（"它" = "游泳池"）
 */
function extractMainEntity(userMsg, systemReply) {
  const combined = (userMsg + ' ' + systemReply).toLowerCase();

  // 常见酒店实体关键词
  const entityPatterns = [
    /(?:在|是|去|到|用|关于|的)\s*([^\s，,。！？!?、；;]{2,8}?(?:餐厅|泳池|健身房|前台|WiFi|停车场|SPA|酒吧|酒廊|商务中心|洗衣房|会议室|电梯|大堂))/,
    /(早餐|午餐|晚餐|夜宵|送餐|健身房|游泳池|停车|wifi|spa|洗衣|商务中心|行李|叫醒|接送)/i,
  ];

  for (const pat of entityPatterns) {
    const m = combined.match(pat);
    if (m) return m[1] || m[0];
  }

  return null;
}

// ======================== 上下文注入 ========================

/**
 * 将上轮对话上下文注入到当前消息中，消解指代
 *
 * 例：
 *   Q1: "游泳池在几楼？" → A1: "在6楼"    → entity="游泳池"
 *   Q2: "开放时间呢？"  → 注入为 "游泳池的开放时间呢？"
 */
function resolveAnaphora(userMsg, sessionCtx) {
  if (!sessionCtx || sessionCtx.turnCount === 0) return userMsg;

  const { lastEntity, lastTopic, entityStack } = sessionCtx;

  // 检测当前消息是否是指代省略句
  const isAnaphoric = /^(?:它|他|她|这个|那个|这|那|呢|吗|啊|吧|开放时间|营业时间|价格|费用|地址|位置|怎么|收费|免费|多少钱|在哪|多远|几点|几楼|还有|另外).*/.test(userMsg) ||
    /^(?:what about|and|it|that|this|the|how about|what time|when|where is it|how much|is it free)\b/i.test(userMsg) ||
    userMsg.length <= 5;

  if (!isAnaphoric) return userMsg;

  // ==== 第一优先级：精确实体匹配 ====
  if (lastEntity && !userMsg.includes(lastEntity)) {
    return `${lastEntity}${userMsg}`;
  }

  // ==== 第二优先级：从实体栈中找最佳匹配 ====
  if (entityStack && entityStack.length > 0) {
    // 尝试找与当前query最相关的历史实体
    for (const entity of entityStack) {
      if (!userMsg.includes(entity)) {
        return `${entity}的${userMsg}`;
      }
    }
  }

  // ==== 第三优先级：从 topic 推断 ====
  const topicEntityMap = {
    breakfast: '早餐', gym: '健身房', pool: '游泳池', wifi: 'WiFi',
    parking: '停车场', spa: 'SPA', restaurant: '餐厅',
    room_service: '送餐服务', room_type: '房型', transportation: '交通',
    nearby: '周边', checkout: '退房', checkin: '入住',
    payment: '支付', membership: '会员', emergency: '紧急情况',
    facilities: '设施', policy: '酒店政策',
  };
  const entityFromTopic = topicEntityMap[lastTopic];
  if (entityFromTopic && !userMsg.includes(entityFromTopic)) {
    return `${entityFromTopic}的${userMsg}`;
  }

  return userMsg;
}

// ======================== 公开 API ========================

function getOrCreate(sessionId) {
  if (!sessionId) return null;

  // 清理过期会话
  const session = sessions.get(sessionId);
  if (session && session.isExpired()) {
    sessions.delete(sessionId);
  }

  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, new Session(sessionId));
  }

  return sessions.get(sessionId);
}

function remove(sessionId) {
  sessions.delete(sessionId);
}

function getStats() {
  return {
    activeSessions: sessions.size,
    totalTurns: Array.from(sessions.values()).reduce((s, sess) => s + Math.floor(sess.history.length / 2), 0)
  };
}

module.exports = { getOrCreate, remove, getStats, resolveAnaphora };
