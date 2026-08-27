# 天策大橙武连营技能轴模拟器

一个独立于 Excel 配装器的《剑网3》傲血战意研究项目，用确定性事件模拟和有界搜索探索“大橙武 + 连营”的高伤害技能轴。

白皮书经验只作为基准和搜索启发；最终候选必须满足游戏机制，并以完整战斗重放的实际伤害选优。

## 当前结果

默认研究环境为五段加速、30ms 总延迟、斩杀木桩和固定 180 秒战斗：

- 正式技能轴：[`output/lianying-free-fixed-180s-event-breakpoint.json`](output/lianying-free-fixed-180s-event-breakpoint.json)
- 循环伤害：`2,560,131,430.08`
- 循环 DPS：`14,222,952.39`
- 计入装备与附魔后的总 DPS：`14,702,698.10`
- 机制违规：`0`

240秒旁支成果（当前暂停继续扩展）：

- 技能轴：[`output/lianying-free-fixed-240s-screen.json`](output/lianying-free-fixed-240s-screen.json)
- 循环伤害：`3,286,656,916.88`
- 循环 DPS：`13,694,403.82`
- 计入装备与附魔后的总 DPS：`14,174,149.53`
- 机制违规：`0`

这是当前已覆盖搜索空间内的最高结果，不代表对完整动作空间作出数学全局最优证明。

240秒结果保留用于证明长时规划会主动让利短时前缀。180秒正式轴在双等待轴基础上，把第1、2次任驰骋后的雷移动到流血跳和梅花枪法攻击事件邻域，循环伤害提高`439,634.58`；Excel分项校准后优势为`445,592.55`，候选排名不变。30ms下1–12帧时点网格仍以当前`7/5`为最高平台，180秒30ms第一版已完成阶段验收；该结论不外推为跨延迟通用轴，也不宣称数学全局最优。

## 核心能力

- 原生 JavaScript 状态机，运行模拟与搜索时不启动 Excel。
- 统一处理 GCD、非 GCD、生效帧、连续延迟、冷却和顺序充能。
- 模拟战意、龙驭、骑乘、流血、梅花枪法、破军、激雷、驰骋和大橙武。
- 覆盖龙牙、灭、龙吟、穿云、任驰骋、断魂刺、突及主要附伤和装备期望伤害。
- 区分固定战斗时长轴与不读取结束时间的稳态轴。
- 提供自由束搜索、整段重合成、锚点协调、跨种子重组、机械邻域和离线状态价值实验。
- 所有正式候选均须通过完整状态机重放、逐行资源核对和机制审计。

## 快速开始

要求 Node.js 20 或更高版本。项目当前无第三方运行时依赖。

```bash
npm test
npm run demo
npm run report:structure
npm run report:anchors
npm run report:ranking-sensitivity
npm run report:event-timing-robustness
```

常用研究入口：

```bash
# 从当前正式轴继续局部搜索
npm run optimize:seed

# 连续雷区段与层次化锚点搜索
npm run optimize:multisegments
npm run optimize:anchor-coordinator

# 从协调器核心候选移植并修复两雷动作块
npm run optimize:block-recombination -- \
  - /path/to/coordinator.json screen /tmp/block-search

# 从正式轴搜索两个互相补偿的局部变换
npm run optimize:compound-neighborhood -- \
  - screen /tmp/compound-search

# 独立强制关键行产生不同主技能，再重合成完整后缀
npm run optimize:counterfactual-anchors -- \
  - /tmp/counterfactual.json probe

# 固定前缀后搜索4–6行资源顺序/数量模板
npm run optimize:counterfactual-windows -- \
  - /tmp/window.json probe

# 按雷区段搜索有限的主要技能计数骨架
npm run optimize:segment-skeletons -- \
  - /tmp/segment-skeletons.json probe

# 组合两条已验证单骨架计数增量
npm run optimize:double-segment-skeletons -- \
  - /tmp/double-skeletons.json probe /tmp/single-a.json,/tmp/single-b.json

# 将单计数增量映射到不同雷表的真实区段边界
npm run optimize:anchor-count-skeletons -- \
  - /tmp/anchor-count.json probe /tmp/single-a.json,/tmp/single-b.json

# 断魂刺区段计数，以及与不同雷表的有界联合
npm run optimize:charge-count-skeletons -- \
  - /tmp/charge-count.json probe
npm run optimize:anchor-charge-count-skeletons -- \
  - /tmp/anchor-charge-count.json probe /tmp/charge-count.json

# 同预算对照动作差异谱系，或相对状态偏差谱系
npm run optimize:difference-lineages -- \
  - /tmp/difference-lineages.json probe
npm run optimize:difference-lineages -- \
  - /tmp/state-lineages.json probe state

# 相同节点展开预算下比较逐层束与最佳优先局部块
npm run optimize:best-first-block -- \
  - /tmp/best-first-block.json probe 107 128

# 可选：先把指定序号的雷移动到目标行，再以该近优轴为基线搜索
npm run optimize:best-first-block -- \
  - /tmp/best-first-79-106.json probe 79 106 6 106

# 离散比较不同的单雷归属和任驰骋充能使用行表
npm run optimize:ride-thunder-templates -- \
  - /tmp/ride-thunder-templates.json probe

# 以近优完整轴为热启动，联合重合成三个连续雷区段
npm run optimize:triple-segment-recombination -- \
  - /tmp/triple-segment.json probe output/lianying-ranking-sensitivity.json heterogeneous

# 合并两个已验证来源，并逐档继承完整精英轴
npm run optimize:multi-source-recombination -- \
  - /tmp/multi-source.json adaptive-probe

# 以现有固定时长轴为热启动，搜索更长战斗时间
npm run search:duration -- \
  output/lianying-free-fixed-240s-probe.json /tmp/240s-screen.json 240 screen

# 在雷/橙武/任驰骋锚点前搜索不减少主要技能的短等待
npm run optimize:wait-anchors
npm run optimize:pair-wait-anchors
npm run optimize:event-breakpoints
npm run search:neutral-event-timings

# 复活关键雷边界被束宽裁剪的少量资源相位祖先
npm run search:pruned-revival
npm run search:neutral-pair-waits
```

脚本完整清单及参数以 [`package.json`](package.json) 和各 `tools/*.mjs` 入口为准。缺省输入 `-` 表示当前正式轴。

## 项目结构

- `src/engine/`：时钟、状态、充能和动作执行。
- `src/damage/`、`src/effects/`：原生伤害公式与装备期望伤害。
- `src/policies/`：技能轴生成、搜索、重合成和邻域算法。
- `src/reports/`：技能轴、结构、锚点和审计报告。
- `tools/`：命令行研究入口。
- `tests/`：机制金标准和搜索回归测试。
- `data/`：默认配装模板及离线 Excel 对照数据。
- `output/`：已验证技能轴与研究产物。

## 研究约束

- Excel 只用于离线金标准和结果对比，不参与正式模拟循环。
- 搜索器必须调用统一状态机，不复制技能规则。
- 资源浪费和白皮书偏离不等于机制非法；它们只能作为诊断或软排序依据。
- 不因终局剩余战意或龙驭强制修改技能轴，固定时长模式只比较截止前总伤害。
- 未经游戏实测确认的机制和由 Excel 反推的公式需要继续保留误差边界。

## 文档

- [`docs/mechanics-spec.md`](docs/mechanics-spec.md)：已建模机制与假设。
- [`docs/development-roadmap.md`](docs/development-roadmap.md)：开发阶段、实验结论和下一步。
- [`docs/180s-search-coverage.md`](docs/180s-search-coverage.md)：180 秒搜索覆盖范围与未证明空间。
- [`docs/value-training-data.md`](docs/value-training-data.md)：状态价值数据、训练和在线对照实验。
- [`output/lianying-ranking-sensitivity.json`](output/lianying-ranking-sensitivity.json)：正式轴与最近近优轴的分项权重排序核查。

公开仓库不包含原工作簿、原配装器仓库或个人绝对路径。重新提取装备与 Excel 金标准时，通过对应 `refresh:*` 工具显式传入来源目录和配装方案。
