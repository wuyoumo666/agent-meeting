# 交互式 HTML 数据看板 (Interactive Dashboard) — 用 Chart.js、筛选器与 KPI 卡片构建零后端独立 HTML 看板
> 精编自：`C:\Users\18791\.codebuddy\plugins\marketplaces\cb_teams_marketplace\plugins\data\skills\interactive-dashboard-builder\SKILL.md`

用于创建无需服务器即可直接在浏览器打开的交互式 HTML 数据看板。

## 标准页面骨架
1. **Header（顶部栏）**：看板标题 + 全局筛选控件（下拉选择器、日期范围、重置按钮）。
2. **KPI Row（指标概览行）**：3–5 张核心 KPI 卡片，统一包含「指标名 + 格式化主数值（等宽数字 `tabular-nums`）+ 环比/同比变化标识（正负语义色）」。
3. **Chart Row（图表区）**：使用 CSS Grid 响应式排布（如 2 列或非对称主副图），每张图表有独立标题、副标题说明与 Canvas 容器。
4. **Table Section（明细表）**：支持随筛选器联动的明细表格，数值列右对齐，表头清晰。
5. **Footer（底部信息）**：明确标注数据口径与更新时间。

## 核心实现准则
- **单文件联动架构**：将清洗后的数据内嵌为 `const DATA = [...]`，由一个 `Dashboard` 类统一管理 `rawData` → `filteredData` → `renderKPIs()` / `updateCharts()` / `renderTable()`，避免各组件状态不同步。
- **Chart.js 细节**：显式设置 `responsive: true`、`maintainAspectRatio: false` 并给外层容器固定高度，防止图表无限拉高；切换筛选条件时调用 `chart.update()` 而非重复创建 Canvas 实例导致内存泄漏/闪烁。
- **视觉克制**：背景保持干净中性浅色或深色底，统一 1–2 个强调色与图表系列色板；禁用默认紫蓝渐变和过度阴影。
