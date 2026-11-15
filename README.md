# 我的智囊团

把你的 AI 和 agent 拉进一个 Slack 式群聊开会的桌面应用。人类主持、API 模型、本地 CLI agent 在同一个房间里对等发言。

## 运行

```bash
npm install
npm run dev      # 开发模式（热更新）
npm run build    # 构建到 out/
npm start        # 运行构建产物
```

数据（房间/参会者/消息/CLI 会话）持久化在 `%APPDATA%/agent-meeting/data.json`。

## 接入参会者

设置 → **模型服务**：填 OpenAI 兼容 Base URL + Key（DeepSeek / 通义 / Kimi / OpenRouter / Ollama 均可），点「⚡ 自动获取模型列表」拉取 `/models`。

设置 → **参会者**：
- **API 模型**：选服务 + 模型，可写人设。
- **本地 CLI agent**：预设 CodeBuddy / agy(Antigravity) / Codex / Gemini，也可自定义任意命令。prompt 走 stdin（agy 走 `-p=` 参数），输出按预设解析（stream-json / 末尾消息文件 / JSON / 纯文本）。CodeBuddy 用 `--session-id/-r`、agy 用 `--conversation` 保持会话记忆。
- **CLI 选模型**：参会者编辑页有「模型」字段（留空=CLI 默认），运行时追加 `--model`。agy 可点「⚡ 获取模型列表」自动列出（`agy models`）；其它 CLI 提供常用模型建议或手输。已实测 codebuddy `--model glm-5.3-flash` 生效。
- **Markdown 渲染**：发言按完整 Markdown 渲染（加粗/斜体/代码/列表/表格/引用，react-markdown + GFM），并修正了 `**“中文引号”**` 这类 CommonMark 不识别的加粗。
- **共享工作目录**：设置 →「通用」里选一次文件夹（系统选择器），所有 CLI agent 默认都在此读写，不用每个单独设。某个 agent 要独立目录时，在其编辑页填「工作目录」覆盖（留空=用共享目录）。
- **身份即模型**：CLI agent 自动以底层模型的名字参会（CodeBuddy→`deepseek-v4.1-flash`、agy→`Orchestrator-Argon`），从各自配置文件读取、每轮校准；你在设置里手动改过名字后就不再自动跟随。@ 提及也用模型名。
- **离线演示**：不联网的回显 agent，用于验证链路。

## 开会（防无限回复的规则）

- **成员**：头部「成员」按钮弹出勾选面板，实时启用/停用任意 AI（即时生效，无需保存）。
- 直接提问时，启用的参会者依次发言。点击上方的参会者名字，或输入 @ 点名。未发送的草稿和附件按房间保留，关闭应用后清除。
- 在房间设置里可以启用全员回答、限制 AI 接龙的层数，或允许点名本地工具时自动派发工作区任务。自动派发在新房间中默认关闭。
- **停止** → 中止当前发言并清空队列。

## 自由讨论（AI 自主开会，人类旁观）

头部「自由讨论」→ 设定**议题**和**轮数**（每轮 = 每位参会者各发言一次）→ 开始。之后 AI 们自主互相讨论，无需你发言：

- 每条发言结尾它们会 @ 下一位接话者，调度器据此 steering；没人被 @ 时按顺序轮流，保证讨论不断。
- 注入的是另一套「自由讨论」提示词：积极回应彼此、推动议题走向结论、@ 下一位。
- 预算 = 轮数 × 参会者数（硬上限 60 条），用满自动结束并提示。
- 随时点「停止」结束讨论。点「暂停」或直接发消息，当前发言结束后暂停，点「继续」恢复。
- 已实测：4 位参会者 1 轮，deepseek 发言后 @ Orchestrator-Argon 接话，用满 4 条后干净停止。

## 安全须知

- API 参会者在工作区读写文件前需要选择共享工作目录，运行命令需要在当前任务中单独批准。本地工具执行任务时沿用它自己的权限配置。
- 多个能改文件的 agent 默认共用一个共享目录，可能同时改同一文件——让它们分工明确，或只读讨论；需要隔离时给各自独立目录（或 git worktree）。
- 模型服务和主持人的 API 密钥保存在当前 Windows 用户的凭据管理器。旧配置在启动时迁移，验证写入成功后才删除原配置中的明文密钥。旧备份可能仍含明文密钥。
- 工作区在「开始任务」旁显示执行者和工作目录。若目录变化，需要核对后重新派发。
- 讨论区的「更多操作」可按关键词或发言人搜索整个房间，或导出 Markdown。聊天区先加载最近 50 条，向上滚动后可加载更早的消息。

## 架构

```
src/main/            Electron 主进程
  store.ts           JSON 持久化（房间/参会者/消息/CLI 会话）
  orchestrator.ts    调度器：@路由、顺序队列、接龙深度+轮数熔断、上下文切片
  adapters/openai.ts OpenAI 兼容：/models 拉取 + SSE 流式
  adapters/cli.ts    通用 CLI：子进程 + stdin + 四种输出解析 + 会话续接
src/preload/         contextBridge 暴露的 typed IPC
src/renderer/        React UI（房间/流式消息/@自动补全/设置）
src/shared/types.ts  共享类型 + CLI 预设
```

## 已知边界（MVP）

- Codex / Gemini 预设按官方 headless 参数编写，但本机未安装这两个 CLI，**未实测**；CodeBuddy 与 agy 已实测跑通（含会话续接）。
- 消息渲染支持完整 Markdown（含 GFM 表格）。
- 未打包安装程序（需要时加 electron-builder）。
- CLI agent 每轮喂增量会议记录；CodeBuddy 走 `--session-id`/`-r`、agy 走 `--conversation` 保持自身会话记忆。
