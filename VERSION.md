# 🏨 hotel-asking_agent — 版本说明

GitHub: https://github.com/BocrieM11/hotel-asking_agent

---

## 分支对比

| | `master` (v4.0) | `v3-legacy` (v3.3) |
|------|------|------|
| **架构** | LangGraph 三节点状态机 | 规则引擎 + LLM 润色 |
| **模型** | vLLM qwen3.5:4b (远程) | deepseek-r1:14b (Ollama本地) |
| **检索** | bge-m3 语义 + 关键词混合 | 关键词子串匹配 |
| **意图分类** | 代码层关键词路由 | 规则硬编码优先级 |
| **服务边界** | 双重保险 (预处理+回复检测) | System Prompt 声明 |
| **回复风格** | 语音友好，简洁直接 | 三步引导法 (方向→选择→精准) |
| **代码量** | ~280 行 (agent-langgraph.js) | ~7,000 行 (17个文件) |
| **配置** | 0 个 JSON 配置 | 9 个 JSON 配置 |
| **引擎文件** | 5 个源文件 | 17 个源文件 |
| **测试** | 3套测试集(251题) + 31项单元测试 | 600+ 用例 |
| **日志** | MD 格式，按日分目录 | Markdown + JSON 双份 |

---

## 切换版本

```bash
# 查看所有版本
git branch -a

# 切换到 v3.3 (旧版)
git checkout v3-legacy

# 切换到 v4.0 (最新)
git checkout master
```

---

## v4.0 快速启动

```bash
cd engine
node api-server.js
# → http://localhost:3009/chat
```

- 模型: vLLM 服务器 192.168.253.95:8013 (qwen35-4b)
- 嵌入: bge-m3:latest (本地 Ollama)
- 知识库: kb/*.md (6文件, 91段落)

## v3.3 快速启动

```bash
git checkout v3-legacy
cd engine
node api-server.js
```

- 模型: 本地 Ollama deepseek-r1:14b
- 需配置 API Key
