# 天策大橙武连营技能轴模拟器

一个独立于 Excel 配装器的《剑网3》傲血战意研究项目，用确定性事件模拟和有界搜索探索“大橙武 + 连营”的高伤害技能轴。

白皮书经验只作为基准和搜索启发；最终候选必须满足游戏机制，并以完整战斗重放的实际伤害选优。

## 当前结果

默认研究环境为五段加速、30ms 总延迟、斩杀木桩和固定 180 秒战斗：

- 正式技能轴：[`output/lianying-free-fixed-180s-anchor-rides-dismount-segments-deep.json`](output/lianying-free-fixed-180s-anchor-rides-dismount-segments-deep.json)
- 循环伤害：`2,558,958,123.33`
- 循环 DPS：`14,216,434.02`
- 计入装备与附魔后的总 DPS：`14,696,179.73`
- 机制违规：`0`

这是当前已覆盖搜索空间内的最高结果，不代表对完整动作空间作出数学全局最优证明。

M5.5 已完成：短窗口资源模板曾产生仅低正式轴 `48,804.41` 的异构中间轴，但固定锚点修复最终回归正式轴，伴随锚点联合消融反而显著变差。下一阶段转向整雷区段的技能计数骨架；搜索重心仍是提高180秒最高DPS。

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
