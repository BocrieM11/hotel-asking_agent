# 🏨 酒店问询Agent — 架构升级报告

> v2.4 (规则引擎) → v3.0 (LLM Agent + Tools)
> 日期: 2026-06-10

---

## 一、核心变化

| 维度 | v2.4 | v3.0 |
|------|------|------|
| **架构模式** | 规则引擎 + LLM润色 | LLM Agent + Tools |
| **LLM角色** | 最后一步"说成人话" | 全程决策者 |
| **意图识别** | 350+同义词 + 四层匹配 + 8组消歧规则 | LLM语义理解 |
| **路由决策** | 硬编码优先级 (天气>时间>呼叫>FAQ) | LLM自主判断 |
| **知识检索** | 正则匹配KB章节 | LLM调用 search_hotel_info 工具 |
| **边界拒绝** | 硬编码话术 (4种) | LLM友善引导 |
| **天气** | Open-Meteo (规则触发) | LLM调用 get_weather 工具 |
| **时间** | new Date() (规则触发) | LLM调用 get_time 工具 |
| **LLM模型** | DeepSeek (云端) | qwen2.5:7b (本地Ollama) |
| **费用** | 按token付费 | 免费 (本地) |
| **离线可用** | ❌ | ✅ |

---

## 二、架构图对比

### v2.4 — 规则引擎

```
用户输入
  │
  ├─ 1. 会话消解 (规则)
  ├─ 2. 边界检查 (isServiceRequest)
  ├─ 3. NLU路由 (isWeatherQuery/isTimeQuery/isHotelCall)
  ├─ 4. 话题检测 (detectFaqTopic → 350+同义词)
  ├─ 5. 消歧规则 (8组if-else)
  ├─ 6. KB检索 (正则匹配章节)
  ├─ 7. 决策输出 (BRD §5.2格式)
  └─ 8. LLM润色 (DeepSeek)
       │
    输出回复
```

### v3.0 — LLM Agent

```
用户输入
  │
  └─ LLM (qwen2.5:7b) 自主决策
       │
       ├─ 需要酒店信息? → search_hotel_info(kb)
       ├─ 需要天气?     → get_weather(city)
       ├─ 需要时间?     → get_time(city)
       ├─ 服务请求?     → 友善引导
       └─ 直接回复
            │
         输出回复
```

---

## 三、代码量对比

| 指标 | v2.4 | v3.0 | 变化 |
|------|------|------|------|
| 引擎源文件 | 17个 | **6个** | -65% |
| 配置文件 | 9个 | **0个** | -100% |
| 代码总行数 | ~7,000行 | **~500行** | -93% |
| 测试文件 | 6个 (600+用例) | 0个 (手动验证) | - |

### v2.4 的17个源文件 (已全部删除)

```
faq-handler.js (70KB, 1200行) — 核心规则
nlu-adapter.js — NLU路由
intent-arbiter.js — 意图裁决
pipeline.js — BRD 8步管线
slot-validator.js — 槽位校验
capability-gate.js — 能力矩阵
risk-guard.js — 风控红线
need-clarify.js — 澄清机制
decision-output.js — 决策输出
entity-resolver.js — 实体解析
config-loader.js — 配置加载
weather-api.js — 天气API
llm-generator.js — LLM调用
api-server.js — HTTP服务 (200行)
session-store.js — 会话记忆
conversation-logger.js — 日志
chat-client.js — CLI客户端
```

### v3.0 的6个源文件

```
agent.js (200行) — LLM Agent + 3个Tools
api-server.js (80行) — HTTP服务
session-store.js — 会话记忆
conversation-logger.js — 日志
chat-client.js — CLI客户端
web-ui.html — Web UI
```

---

## 四、功能对比

| 场景 | v2.4 | v3.0 |
|------|------|------|
| "早餐几点" | 关键词"早餐"→breakfast→正则检索→LLM润色 | LLM理解→调search_hotel_info→获取数据→回复 |
| "哪里能吃饭" | 同义词"吃饭"→restaurant | LLM理解→调search_hotel_info |
| "有地儿撸铁不" | 同义词"撸铁"→gym (需预先配置) | LLM直接理解"撸铁"=健身房 |
| "帮我送毛巾" | 硬编码拒绝"请拨前台0" | LLM友善引导"这是客房服务..." |
| "北京天气" | isWeatherQuery→规则路由→Open-Meteo | LLM→调get_weather("北京") |
| "现在几点" | isTimeQuery→规则路由→new Date() | LLM→调get_time("澳门") |
| "介绍酒店" | 关键词缺失→out_of_scope | LLM理解→调search_hotel_info("酒店概况") |
| 未预见的问法 | ❌ 匹配失败 | ✅ LLM语义理解兜底 |

---

## 五、优化收益

| 优化 | 细节 |
|------|------|
| **灵活性** | 不再需要预定义所有同义词，LLM自然理解任意表达 |
| **可维护性** | 删除了350+同义词、8组消歧规则、9个配置文件 |
| **扩展性** | 加新功能=加一个Tool，不改现有代码 |
| **成本** | DeepSeek付费API → 本地qwen2.5免费 |
| **离线** | 完全离线可用，不依赖外网 |
| **隐私** | 数据不出本地 |

---

## 六、风险与已知限制

| 风险 | 说明 | 缓解 |
|------|------|------|
| qwen2.5:7b能力 | 指令遵循不如DeepSeek | 可随时切回云端模型 |
| KB检索精度 | 简单子串匹配 | 可升级为向量检索 |
| Tool调用延迟 | 每次工具调用多1轮LLM请求 | 本地模型速度快(~3s) |
| 无brd合规验证 | 不再输出BRD §5.2格式 | 按需加回 |

---

## 七、切换方式

```bash
# 本地模型 (当前)
LLM_BASE_URL=http://localhost:11434 LLM_MODEL=qwen2.5:7b node api-server.js

# 切回DeepSeek
LLM_BASE_URL=https://api.deepseek.com LLM_MODEL=deepseek-chat LLM_API_KEY=sk-xxx node api-server.js

# 切OpenAI
LLM_BASE_URL=https://api.openai.com LLM_MODEL=gpt-4o LLM_API_KEY=sk-xxx node api-server.js
```

---

## 八、总结

| | v2.4 | v3.0 |
|--|------|------|
| 代码量 | 7,000行 | 500行 |
| 规则数 | 60+条 | 0条 |
| 配置文件 | 9个JSON | 0个 |
| 响应逻辑 | 规则决定+LLM润色 | LLM自主决策 |
| 部署依赖 | DeepSeek API Key | 仅需Ollama |
| 新需求响应 | 需改规则+重部署 | LLM自然适应 |
| **一句话** | **人工教AI怎么做** | **AI自己决定怎么做** |
