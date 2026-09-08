# Crater AI 助手 (crater_ai_helper)

在 [Crater](https://github.com/raids-lab/crater) ML 训练平台上集成对话式 AI 助手，让用户通过自然语言完成建镜像、开训练作业、下载模型、查询资源状态等操作。

- **技术设计文档**：见 `assistant-design.md` / `assistant-design.docx`
- **仓库分支**：`feature/assistant`

## 快速概览

- 后端 `internal/handler/assistant/`：AssistantMgr + 28 个工具（15 读+13 写）
- 前端 `portal/assistant`：SSE 流式聊天 + PendingAction 确认卡片
- 权限：AI 每次调用完全复用 Crater JWT + Handler UserID 过滤，架构级零越权
- 计费：平台 key 走扣 ExtraBalance；用户自带 key 免扣
- 部署：作为 Crater 的一部分，重建 crater-be/crater-fe 镜像 + helm upgrade

## 交付里程碑

| M | 内容 | 天数 |
|---|------|------|
| M0 | DB + LLM 流式客户端 | 1.5 |
| M1 | Chat SSE + 15 读工具 | 2 |
| M2 | PendingAction + 13 写工具 | 2 |
| M3 | Settings + Billing | 1.5 |
| M4 | 前端 Chat UI | 2 |
| M5 | Rate limit + Audit + e2e | 1 |
| M6 | 构建部署 | 1 |

详细设计见 assistant-design.md。
