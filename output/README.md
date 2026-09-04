# 输出目录保留规则

该目录只保留三类可复现产物：

1. `src/config/lianying-research-defaults.js`直接声明的当前最优轴、固定时长基线、默认研究种子和价值训练种子；
2. 上述JSON的`seedPath`、`sourcePath`或`durationSearch.inputPath`递归来源；
3. 当前正式轴与白皮书固定/稳态基准的CSV和装备CSV，以及对比摘要。

`lianying-ranking-sensitivity.json/.csv`、`lianying-event-timing-robustness.json/.csv`与`lianying-current-best-verification.json`是当前正式轴接受依据的一部分，作为小型离线核查报告例外保留；中间搜索轴仍不常驻该目录。

历史种子只保留可重放JSON，不重复保留其CSV、装备CSV和结构报告。其余screen、fast、balanced、deep中间实验和候选短名单不再作为运行输入，结论已写入README与开发路线图，故不继续常驻版本库。需要复核历史实验时可以从Git历史恢复，或使用对应`optimize:*`/`report:*`命令重新生成。

当前默认轴由`LIANYING_CURRENT_BEST_AXIS`唯一指定。提升新最优轴时，应同时更新默认种子配置，再按以上递归规则清理被替代的产物，避免依赖文件与实验缓存混在一起。
