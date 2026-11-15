# 数据可视化与 Python 绘图 (Data Visualization) — 图表选型指南、Plotly 交互图与 Matplotlib/Seaborn 出版级静态图规范
> 精编自：`C:\Users\18791\.codebuddy\plugins\marketplaces\cb_teams_marketplace\plugins\data\skills\data-visualization\SKILL.md`

## 1. 按数据关系选型（Chart Selection）
- **时间趋势**：折线图（Line）/ 面积图（累计或构成）
- **分类对比**：柱状图（分类多时用水平柱状图 / 棒棒糖图）
- **排名**：水平柱状图 / 点图 / 坡度图（双时期对比）
- **部分与整体**：堆叠柱状图 / 树状图（层级）
- **分布**：直方图（Histogram）/ 箱线图 / 小提琴图（多组对比）
- **相关性（2 变量）**：散点图（Scatter）/ 气泡图（第 3 变量作尺寸）
- **多变量相关性**：热力图（Heatmap 相关矩阵）
- **流向/转化**：桑基图（Sankey）/ 漏斗图（Funnel）
- **多指标对比**：分面小图（Small Multiples）

### 避坑清单（何时不用）
- **饼图 / 环形图**：分类 >= 6 或需要精确比较时不用，改用水平柱状图。
- **3D 图表**：禁止使用，会扭曲视觉比例。
- **双 Y 轴图**：谨慎使用，容易制造虚假相关性；必须明确标注双轴单位。

## 2. 库选择优先级
- **交互式探索/分享**：优先 **Plotly**（`plotly.express` / `plotly.graph_objects`），`template='plotly_white'`，`hovermode='x unified'`，导出 `.html`。
- **论文/实验报告/出版级静态图**：使用 **Matplotlib / Seaborn**：
  - 统一字体与字号，去掉多余上右边框（`spines['top'/'right'].set_visible(False)`）；
  - 使用色盲友好配色（如 Okabe-Ito / ColorBrewer / Viridis），避免红绿直接对照；
  - 必须标注坐标轴名称、单位、图例、标题与数据来源，导出高分辨率 PNG（`dpi=300`）或矢量 SVG/PDF，并用视觉工具实际查看成图是否重叠裁切。
