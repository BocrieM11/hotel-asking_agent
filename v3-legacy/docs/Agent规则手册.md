# 🏨 酒店问询Agent — 规则手册

> 版本: v2.4.0 | 2026-06-10

---

## 1. 功能边界规则

### 1.1 负责范围

| 意图 | 说明 | 风险 |
|------|------|------|
| FAQ_QUERY | 20个主题酒店知识问答 (中英双语) | 低 |
| WEATHER_QUERY | 天气查询+穿衣建议 (Open-Meteo实时数据) | 低 |
| TIME_QUERY | 时间/时区查询 (系统时钟) | 低 |
| HOTEL_CALL | 呼叫前台 (二次确认) | 高 |
| NEED_CLARIFY | 澄清机制 | 低 |
| EXIT | 退出交互 | 低 |

### 1.2 越界拒绝

| 规则ID | 触发条件 | 拒绝类型 | 话术 |
|--------|----------|----------|------|
| BDR-001 | "帮我送/打扫/拿/派人/马上要/赶紧..." | room_service | 请拨前台内线"0" |
| BDR-002 | "点一份/点个/来一份/下单/订餐/我要点/帮我点..." | food_order | 请扫码进入点餐系统 |
| BDR-003 | "打开/关闭/调到/把灯/把空调/把窗帘/turn on/turn off..." | device_control | 请使用房间控制面板 |
| BDR-004 | 以上都不匹配但非FAQ | out_of_scope | 请联系前台 |

---

## 2. NLU路由规则

### 2.1 意图优先级

```
1. HOTEL_CALL  (独立关键词，最高优先级)
2. WEATHER_QUERY  (有城市 或 无FAQ topic 或 topic=weather)
3. TIME_QUERY  (有城市 或 无FAQ topic 或 topic=time)
4. FAQ_QUERY  (有faq_topic匹配 或 isFaqQuery=true)
5. FAQ_QUERY  (兜底 → need_clarify)
```

### 2.2 天气关键词 (isWeatherQuery)

```
中文: 天气 气温 下雨 刮风 下雪 晴天 阴天 多云 预报 穿衣 穿什么 防晒 防寒 气候 带伞
      会不会下雨 会下雨 降温 升温 热不热 冷不冷 几度 下暴雨 台风 暴风雨 季节 什么季节
英文: weather rain snow temperature forecast climate umbrella typhoon hot cold season
```

### 2.3 时间关键词 (isTimeQuery)

```
中文: 几点 现在时间 今天几号 日期 星期几 当地时间 时间 几点了 什么时间
      几月几号 今天日期 今天星期几 今天周几
英文: what time current time what day timezone time zone today date

特殊规则: "时间" 单独出现 → 需配合城市名或问句特征，排除"开放时间/营业时间/早餐时间/退房时间"
```

### 2.4 呼叫关键词 (isHotelCallQuery)

```
中文: 叫前台 呼叫前台 联系前台 转接 人工 前台电话 帮我叫 帮我转 接前台 打电话 拨前台 转人工 人工服务 客服 找前台
英文: call front desk operator connect to front desk reception
```

---

## 3. FAQ检索评分规则

### 3.1 四层匹配

| 层 | 权重 | 说明 |
|----|------|------|
| L1 精确关键词 | ×3 | 命中 faq-topics.json 中 keywords_zh/keywords_en |
| L2 同义词扩展 | ×2 | 命中 SYNONYM_MAP (350中文+250英文) |
| L3 滑动窗口 | ×1 | 中文2-3字子串遍历匹配 |
| L4 描述匹配 | ×1 | 20个 topic 描述词命中得分 |

### 3.2 消歧规则

| 冲突场景 | 策略 |
|----------|------|
| breakfast vs restaurant | 含"早上/早餐"→breakfast；含"中午/晚上/午餐/晚餐"→restaurant；含"几点/时间"→breakfast |
| room_service vs restaurant | 含"房间/客房/送/叫/外卖"→room_service |
| pool vs facilities | 含"游泳/游/泳/泡水/玩水/室内泳/室外泳"→pool |
| gym vs facilities | 含"健身/跑步/运动/器械/哑铃/有氧/yoga"→gym |
| nearby vs transportation | 含"玩/逛/景点/商场/购物/打卡/观光"→nearby；含"机场/打车/地铁/公交/班车"→transportation |
| checkin vs policy | 含"入住/办理/登记/证件/护照/身份证/到店/提前住/凌晨"→checkin |
| checkout vs policy | 含"退/走人/离店/checkout/延迟/下午退"→checkout |
| payment vs policy | 含"钱/付/换/卡/现金/微信/支付宝/信用卡/押金/发票"→payment |
| facilities vs 具体topic | "有没有XX"→优先非facilities的topics |
| 平局tie-breaking | 排除time/weather → 取第一个实质性topic |

### 3.3 置信度阈值

| 条件 | 行为 |
|------|------|
| confidence ≥ 0.2 | execute (正常回答) |
| confidence < 0.2 | need_clarify (low_confidence) |
| 完全无匹配 + 输入≤2字 | need_clarify (low_confidence) |
| 完全无匹配 + 问候语 | need_clarify (low_confidence) |
| 完全无匹配 + 非FAQ | reject (out_of_scope) |

### 3.4 问候语检测

```
匹配: hello hi hey 你好 您好 嗨 哈喽 good morning good evening morning evening
```

---

## 4. 知识库检索规则

### 4.1 章节匹配

```javascript
// 正则匹配 "## 章节名" + 所有子章节 (直到同级或更高级标题)
/(##\s+章节名[\s\S]*?)(?=\n##\s+(?!###)|$)/
```

### 4.2 特殊处理

| 查询类型 | 触发条件 | 检索策略 |
|----------|----------|----------|
| 酒店介绍 | 含"介绍/概况/介绍酒店/酒店怎么样/about hotel" | 加载01-酒店基本信息.md全文(3000字符) |

### 4.3 知识库文件映射

| 文件 | 内容 |
|------|------|
| 01-酒店基本信息.md | 酒店概况/交通/入住须知 |
| 02-房间与设施信息.md | 房型/V健身/V泳池/V水疗/贡多拉/teamLab/剧场/亲子 |
| 03-餐饮服务信息.md | 早餐/10家餐厅/送餐/酒吧/咖啡厅 |
| 04-周边信息与旅游推荐.md | 15家餐厅/景点/购物/交通/一日游 |
| 05-常见问题与紧急处理.md | 40+FAQ/火警/医疗/故障/失物/安全/联系方式 |
| 06-酒店政策与附加服务.md | 预订/取消/支付/金沙会/增值服务/访客/赔偿/投诉 |

---

## 5. 天气数据处理规则

### 5.1 数据源

| 来源 | 费用 | 覆盖 |
|------|------|------|
| Open-Meteo | 免费 | 全球 |

### 5.2 调用流程

```
城市名 → geocode (Open-Meteo Geocoding API) → lat/lon
       → weather (Open-Meteo Forecast API) → 当前温度/湿度/风速/天气码
       → WMO Code → 中文天气描述 (晴/多云/小雨...)
```

### 5.3 天气描述映射 (WMO Codes)

| 码 | 描述 | 码 | 描述 |
|----|------|----|------|
| 0 | 晴 | 51-55 | 小雨/中雨 |
| 1-2 | 少云 | 61-65 | 小雨/中雨/大雨 |
| 3 | 多云 | 71-75 | 小雪/中雪/大雪 |
| 45-48 | 雾/雾凇 | 80-82 | 阵雨/暴雨 |
| 95-99 | 雷阵雨/雷暴/强雷暴 | | |

### 5.4 穿衣建议

| 温度 | 建议 |
|------|------|
| ≥32°C | 短袖短裤，防暑防晒 |
| 25-31°C | 短袖、薄衬衫、夏季衣物 |
| 18-24°C | 长袖或薄外套 |
| 10-17°C | 厚外套、毛衣或夹克 |
| 0-9°C | 羽绒服、棉衣、围巾 |
| <0°C | 最保暖衣物，注意防冻 |
| 有雨 | 携带雨具，防水外套 |

---

## 6. 时间数据处理规则

### 6.1 数据源

| 来源 | 精度 |
|------|------|
| `new Date()` | 系统时钟 (Windows NTP同步) |

### 6.2 城市默认

```
未指定城市 → 默认"澳门" (Asia/Macau, UTC+8)
```

### 6.3 日期解析

| 表达 | 解析 |
|------|------|
| 今天/today | 当天 |
| 明天/tomorrow | 当天+1 |
| 后天 | 当天+2 |
| 本周末/this weekend | 本周六→周日 |
| 未来N天/next N days | 当天→当天+N |
| 本周/this week | 当天→周日 |

---

## 7. 城市/位置提取规则

### 7.1 白名单 (60+中文 + 20+英文)

```
中文: 北京 上海 广州 深圳 杭州 成都 重庆 武汉 南京 天津 西安 三亚 昆明 哈尔滨
      大连 厦门 青岛 长沙 郑州 苏州 东莞 宁波 佛山 合肥 福州 南昌 南宁 贵阳
      兰州 海口 银川 拉萨 乌鲁木齐 呼和浩特 沈阳 长春 济南 太原 石家庄
      香港 澳门 台北 高雄 台中 纽约 伦敦 巴黎 东京 首尔 曼谷 迪拜 悉尼
      新加坡 莫斯科 柏林 罗马 马德里 多伦多 温哥华 孟买 新德里 雅加达 吉隆坡 马尼拉

英文: New York London Paris Tokyo Singapore Sydney Dubai Bangkok Seoul
      Los Angeles San Francisco Chicago Berlin Rome Madrid Toronto Vancouver
```

### 7.2 正则提取

```
"XX天气": /([^\s，,。！？!?、；;]{1,6})(?:的)?(?:天气|气温|气候|温度)/
"XX几点": /([^\s，,。！？!?、；;]{1,6})(?:现在)?(?:几点|时间|日期)/
```

### 7.3 非位置词过滤 (100+词)

```
什么 怎么 如何 今天 明天 后天 现在 早餐 早饭 午餐 午饭 晚餐 晚饭 自助 送餐
房间 酒店 餐厅 健身房 游泳池 会员 支付 发票 行李 宠物 押金 证件 免费 收费
预订 取消 退款 入住 退房 空调 电视 窗帘 音箱 灯光 音乐 退房时间 入住时间
开放时间 营业时间 早餐时间 breakfast lunch dinner what how which where
```

---

## 8. 会话上下文规则

### 8.1 存储参数

| 参数 | 值 |
|------|-----|
| 最大轮数 | 50轮 (100条消息) |
| 实体栈深度 | 10个 (去重) |
| 过期时间 | 30分钟不活动 |
| LLM可见历史 | 最近10轮完整 + 更早压缩摘要 |
| 单条截断 | 250字符 |

### 8.2 指代消解

| 模式 | 策略 |
|------|------|
| "它/他/她/这个/那个/这/那..." | 用 lastEntity 替换 |
| "开放时间/营业时间/价格/费用/地址/位置/怎么/收费/免费/多少钱/在哪/多远/几楼..." | 从实体栈最近10个逐一尝试 |
| ≤5字极短追问 | 从 topic→entity 映射推断 |
| 英文 "what about/and/it/that/this/the/how about/how much..." | 同样消解 |

---

## 9. LLM生成规则

### 9.1 调用参数

| 参数 | 值 |
|------|-----|
| 模型 | deepseek-chat |
| API | https://api.deepseek.com |
| maxTokens | 2000 |
| temperature | 0.7 |
| timeout | 15秒 |
| 重试 | 3次，指数退避(1s→2s→4s) |
| KB注入 | 截取3000字符 |

### 9.2 系统提示 (5种)

| 意图 | 提示要点 |
|------|----------|
| FAQ | 管家身份，列表格式，3-5个选项，emoji标记，短句分行 |
| Weather | 使用提供的天气数据，不要编造，提及穿衣建议 |
| Time | 使用提供的时间数据，不要编造日期星期 |
| HotelCall | 确认用户是否需要联系前台 |
| NeedClarify | 友好引导用户提供更多信息 |

### 9.3 回退规则

| 条件 | 行为 |
|------|------|
| API Key未配置 | 使用模板话术 |
| API超时/错误 | 3次重试 → 模板话术 |
| FAQ回退 | 优先 answer_hint → KB提取 → 通用兜底 |
| 通用兜底 | 20个topic预设通用回复 |

---

## 10. 输出契约规则 (BRD §5.2)

### 10.1 必填字段

```json
{
  "final_intent": { "intent_L1": "...", "intent_L2": "...", "intent_L3": "...", "confidence": 0.9 },
  "final_slots": {},
  "resolved_entities": { "locations": [], "faq_topic": "..." },
  "result_type": "execute | need_clarify | reject",
  "reason_code": "...",
  "reply": "...",
  "decision_trace": { "config_version": {}, "query_type": "...", "faq_topic": "...", "locale_source": "default" }
}
```

### 10.2 need_clarify时额外字段

```json
{
  "clarify_info": {
    "reason_code": "...",
    "clarify_slot": "...",
    "candidates": [],
    "prompt_key": "...",
    "confirm_action": null,
    "target_intent": "...",
    "additional_reasons": []
  }
}
```

### 10.3 reason_code 枚举 (14种)

```
missing_required_slot  invalid_enum  out_of_range_clamped
capability_unsupported  ambiguous_entity  entity_not_found
locale_missing_defaulted  intent_conflict  low_confidence
risky_action_need_confirm  parse_time_failed  parse_duration_failed
device_unavailable  out_of_scope
```

### 10.4 优先级排序 (§6.1.6)

```
1. risky_action_need_confirm
2. capability_unsupported / device_unavailable
3. intent_conflict
4. ambiguous_entity / entity_not_found
5. missing_required_slot
6. parse_time_failed / parse_duration_failed
7. low_confidence
```

---

## 11. 安全与运维规则

### 11.1 鉴权

| 规则 | 值 |
|------|-----|
| 启用条件 | `AUTH_ENABLED !== 'false'` |
| Token | `Bearer hotel-agent-2026` |
| Web UI豁免 | 来自 /chat 的 referer 自动放行 |
| 健康检查豁免 | GET /health 无需鉴权 |

### 11.2 速率限制

| 规则 | 值 |
|------|-----|
| 限制 | 60次/分钟/IP |
| Web UI豁免 | 来自网页的请求不限 |
| 超限返回 | 429 + "请60秒后再试" |

### 11.3 进程守护 (PM2)

| 参数 | 值 |
|------|-----|
| 最大内存 | 500MB |
| 实例数 | 1 |
| 崩溃重启 | 自动 |
| 日志 | logs/pm2-error.log / pm2-out.log |

### 11.4 Key安全

| 规则 | 说明 |
|------|------|
| 存储 | 环境变量 DEEPSEEK_API_KEY |
| fallback | config/llm-config.json (仅占位符) |
| .gitignore | llm-config.json / ecosystem.config.js / logs |

### 11.5 健康检查

```
GET /health → 200 (正常) / 503 (LLM不可用)
返回: status version uptime memory llm sessions time
```

---

## 12. 对话日志规则

| 规则 | 说明 |
|------|------|
| 存储位置 | engine/logs/YYYY-MM-DD/sessionId_time.md |
| 格式 | Markdown，每轮含时间/用户消息/回复/意图/话题 |
| 触发 | 每轮对话完成后追加写入 |
| 清理 | 手动删除目录 |

---

## 13. 测试规则

| 测试套件 | 用例数 | 通过 |
|----------|--------|------|
| config-loader | 26 | 100% |
| faq-integration | 59 | 100% |
| semantic-stress | 226 | 98.2% |
| real-guest-questions | 150 | 90.7% |
| english-200 | 142 | 97.9% |
| full-system-check | 53 | 100% |

---

## 附录: 规则文件索引

| 文件 | 包含的规则 |
|------|-----------|
| `engine/faq-handler.js` | §1-4 (边界/路由/检索/消歧) + §5-7 (天气/时间/城市) |
| `engine/session-store.js` | §8 (会话) |
| `engine/llm-generator.js` | §9 (LLM生成) |
| `engine/api-server.js` | §10 (输出契约) + §11 (安全运维) |
| `engine/need-clarify.js` | §10.2-10.4 (澄清机制) |
| `engine/risk-guard.js` | 风控红线 |
| `engine/slot-validator.js` | 槽位校验 |
| `engine/capability-gate.js` | 能力矩阵 |
| `engine/conversation-logger.js` | §12 (日志) |
| `engine/ecosystem.config.js` | §11.3 (PM2) |
