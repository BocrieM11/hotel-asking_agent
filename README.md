# 🏨 酒店智能问询 Agent

基于 **DeepSeek LLM + BRD 后处理引擎** 的酒店智能问询系统，覆盖 FAQ 知识问答、天气查询、时间查询、酒店呼叫四大场景，支持多轮对话和自然语言回复。

---

## 目录结构

```
hotel-concierge/
├── engine/                        # 引擎核心
│   ├── api-server.js              # HTTP API 服务入口
│   ├── chat-client.js             # 命令行交互客户端
│   ├── faq-handler.js             # 问询核心处理器（FAQ/天气/时间/呼叫）
│   ├── llm-generator.js           # LLM 自然语言生成器
│   ├── session-store.js           # 多轮会话上下文管理
│   ├── nlu-adapter.js             # NLU 意图识别适配器
│   ├── pipeline.js                # BRD §9 8步处理管线
│   ├── intent-arbiter.js          # 意图裁决器
│   ├── entity-resolver.js         # 实体解析器（位置/设备/场景）
│   ├── slot-validator.js          # 槽位校验器（enum/range/clamp）
│   ├── capability-gate.js         # 能力矩阵门控
│   ├── risk-guard.js              # 风控红线检查
│   ├── need-clarify.js            # BRD §6.1 澄清机制
│   ├── decision-output.js         # BRD §5.2 决策输出
│   ├── config-loader.js           # 配置表加载与索引
│   ├── config/                    # 配置表（SSOT）
│   │   ├── general.json           # 通用枚举表
│   │   ├── intent-definitions.json # 意图定义表（6个问询意图）
│   │   ├── slot-definitions.json  # 槽位定义表（22个槽位）
│   │   ├── capability-matrix.json # 能力矩阵
│   │   ├── faq-topics.json        # FAQ主题映射（20个主题+关键词）
│   │   └── lexicon-location.json  # 位置词表
│   │   ├── location-timezone-map.json # 城市→时区映射
│   │   └── llm-config.json        # LLM API 配置
│   └── __tests__/                 # 测试
│       ├── config-loader.test.js  # 配置完整性测试（28用例）
│       └── faq-integration.test.js # 端到端集成测试（59用例）
├── 01-酒店基本信息.md              # 📝 酒店概况/交通/入住须知
├── 02-房间与设施信息.md            # 📝 房型/健身房/泳池/SPA/贡多拉
├── 03-餐饮服务信息.md              # 📝 早餐/正餐/送餐/酒吧
├── 04-周边信息与旅游推荐.md        # 📝 景点/购物/交通指南
├── 05-常见问题与紧急处理.md        # 📝 40+FAQ/紧急联系方式
├── 06-酒店政策与附加服务.md        # 📝 预订/取消/支付/会员/投诉
├── 澳门威尼斯人酒店-信息采集表.md  # 当前酒店数据源
└── README.md
```

---

## 快速开始

### 1. 配置 LLM API Key

编辑 `engine/config/llm-config.json`：

```json
{
  "deepseek_api_key": "sk-你的key",
  "model": "deepseek-chat",
  "base_url": "https://api.deepseek.com"
}
```

> 不配置 Key 也能运行，系统会自动使用内置模板话术。

### 2. 填写酒店知识库

编辑根目录下 `01-` 到 `06-` 共 6 个 Markdown 文件，填入真实酒店信息。

> 当前已预填**澳门威尼斯人酒店**数据，可直接使用或替换。

### 3. 启动服务

```bash
cd engine
node api-server.js
```

服务运行在 `http://localhost:3009`

### 4. 开始对话

**终端交互（推荐）：**

```bash
# 另开一个终端
cd engine
node chat-client.js
```

**HTTP 调用：**

```bash
curl -X POST http://localhost:3009/engine/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"早餐几点开始？"}'
```

---

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/` | 服务状态、LLM连接状态、会话统计 |
| `GET` | `/engine/config` | 查看配置版本 |
| `POST` | `/engine/chat` | 文本对话（支持 sessionId 多轮） |
| `POST` | `/engine/process` | 结构化 NLU 输入 → 决策输出 |
| `POST` | `/engine/reload` | 热重载配置表 |

### 请求格式

```json
{
  "message": "游泳池在几楼？",
  "locale": "zh-CN",
  "sessionId": "room1201"
}
```

### 响应格式（BRD §5.2）

```json
{
  "final_intent": { "intent_L1": "FAQ_QUERY", "intent_L2": "QUERY", "intent_L3": "DEFAULT" },
  "final_slots": { "faq_topic": "pool" },
  "resolved_entities": { "faq_topic": "pool" },
  "result_type": "execute",
  "reason_code": null,
  "reply": "酒店户外泳池位于园林区，营业时间08:00-20:00，住客免费...",
  "decision_trace": { "faq_topic": "pool", ... }
}
```

`result_type` 枚举：`execute`（执行）| `need_clarify`（需要澄清）| `reject`（拒绝）

---

## 功能覆盖

### 意图支持（6个）

| 意图 | 说明 | 风险 |
|------|------|------|
| `FAQ_QUERY` | 20个主题酒店知识问答 | 低 |
| `WEATHER_QUERY` | 天气查询+穿衣建议 | 低 |
| `TIME_QUERY` | 时间/时区查询 | 低 |
| `HOTEL_CALL` | 呼叫前台（二次确认） | 高 |
| `NEED_CLARIFY` | 澄清机制 | 低 |
| `EXIT` | 退出交互 | 低 |

### FAQ 主题（20个）

breakfast · gym · wifi · checkout · pool · parking · spa · restaurant · room_service · room_type · facilities · transportation · nearby · policy · payment · membership · emergency · checkin · weather · time

### 多轮对话

```bash
POST /engine/chat { "message": "游泳池在几楼？", "sessionId": "room1201" }
→ "户外园林区，08:00-20:00"

POST /engine/chat { "message": "收费吗？", "sessionId": "room1201" }
→ 自动消解为"游泳池收费吗？" → "住客免费使用"
```

---

## 测试

```bash
cd engine

# 配置完整性
node __tests__/config-loader.test.js   # 28用例

# 集成测试
node __tests__/faq-integration.test.js # 59用例
```

---

## 更换酒店

1. 编辑 `01-` 到 `06-` 共 6 个 `.md` 文件，替换为新的酒店信息
2. 编辑 `engine/config/faq-topics.json`，同步更新 `answer_hint` 字段
3. 重启服务：`node api-server.js`

> 示例数据来源：[澳门威尼斯人酒店-信息采集表.md](澳门威尼斯人酒店-信息采集表.md)

---

## BRD 对齐

本系统严格对齐 [BRD全表.md](../BRD全表.md) 问询子系统部分：

| BRD 章节 | 内容 | 状态 |
|----------|------|------|
| §5.1-5.2 | 输入/输出契约 | ✅ |
| §6 | 统一原因码（14种） | ✅ |
| §6.1 | NeedClarify 澄清机制 | ✅ |
| §7 | 风控红线 | ✅ |
| §9 | 8步后处理流程 | ✅ |
| §10 | 关键业务规则 | ✅ |
| §11 | AC1-AC5 验收标准 | ✅ |

---

## 技术栈

- **LLM**: DeepSeek API (deepseek-chat) / OpenAI 兼容
- **运行时**: Node.js
- **知识库**: Markdown 文件 + 关键词反向索引 + 同义词扩展
- **配置**: JSON 表驱动（BRD §8 SSOT）
- **会话**: 内存存储（支持30分钟TTL自动过期）
