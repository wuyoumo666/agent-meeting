# 架构与流程图可视化 (Archify Diagrams) — 生成可探索的架构图、流程图、时序图、数据流与状态机 HTML+SVG
> 精编自：`C:\Users\18791\.agents\skills\archify\SKILL.md`（需要 `bin/archify.mjs` 或 Schema 时可读取原目录）

## 适用场景与图表选型
- `architecture`：组件、服务、云/网络/安全边界、系统拓扑（若需反映真实代码，必须先检查仓库源码证据）。
- `workflow`：业务流程、审批门禁、工具调用、Runbook、CI/CD。
- `sequence`：API 调用链、请求生命周期、异步时序与返回。
- `dataflow`：数据管道、ETL/ELT、血缘与消费端。
- `lifecycle`：状态转换、重试、等待与终态。

## Mermaid 转换原则
收到用户的 Mermaid（`flowchart` / `sequenceDiagram` / `stateDiagram`）时，只读取其拓扑与语义，重新构建清晰的语义节点、分组边界和路由，不机械照搬 Mermaid 的简陋样式。

## 使用 Archify CLI 工作流（本地可用时）
1. 在工作区新建独立输出目录 `.archify/<type>-<slug>-<YYYYMMDD-HHMMSS>/`，放入 `candidate.json`。
2. 基于对应类型 Schema（`schemas/<type>.schema.json`）与示例编写完整 `candidate.json`，默认静态输出（仅在明确要求时开启 `meta.animation: "trace"`）。
3. 运行验证与构建：
   `node "<archify-root>/bin/archify.mjs" finalize <type> <candidate.json> <output.html> --quality showcase --json`
   （若基于真实仓库，加上 `--repo-root <repo-root>`）。
4. **交付纪律**：非零退出不算成功；交付时如实报告 HTML 绝对路径、图表类型、自动化校验结果以及是否进行了截图视觉检查。无命令行工具可用时，可将语义化 SVG 放入干净 HTML 模板中并做浏览器渲染自检。
