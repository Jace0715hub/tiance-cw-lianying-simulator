# 连营状态价值训练数据

## 目的

该数据集用于评估轻量状态价值函数能否在固定束宽下保留“短期伤害较低、长期资源更优”的节点。模型只影响候选保留配额，不参与伤害结算；所有候选仍需由确定性模拟器完整复演。

## 生成

```bash
npm run collect:value-data -- - sample
npm run collect:value-data -- - screen
npm run collect:value-data -- portfolio screen
npm run evaluate:value-model -- output/lianying-value-portfolio-screen.jsonl
npm run collect:value-data -- output/value-seeds-screen/manifest.json pruning-screen output/value-pruning-screen
npm run evaluate:value-model -- output/value-pruning-screen.jsonl output/value-pruning-screen-beam-shadow beam-shadow
npm run collect:multisegment-value-data -- current sample
npm run collect:multisegment-value-data -- portfolio sample output/lianying-multisegment-value-portfolio-sample
npm run evaluate:value-model -- output/lianying-multisegment-value-portfolio-sample-actual.jsonl output/lianying-multisegment-value-portfolio-sample-actual-ridge beam-shadow
npm run evaluate:value-model -- output/lianying-multisegment-value-portfolio-screen-actual.jsonl output/lianying-multisegment-value-portfolio-screen-actual-ridge boundary-shadow
```

参数一为技能轴路径，`-`表示当前180秒最优轴，`portfolio`表示状态价值专用的八条结构跨度种子，也可传逗号分隔的自定义轴或近优种子清单；参数二为`sample`、`screen`或`pruning-screen`；参数三可指定输出文件前缀。多种子数据按完整来源轴划分，单轴数据按轨迹划分。命令输出：

- `*.jsonl`：训练程序使用的逐节点记录；
- `*.csv`：人工检查和统计分析；
- `*-summary.json`：样本量、轨迹数、数据划分、残差范围和特征列。

`pruning-screen`与旧的决赛祖先数据用途不同：它在每层束剪枝前取即时伤害前12名，逐一沿来源轴的统一参考后缀重放，只给完整合法候选贴标签。输出中的`baselineRank`表示剪枝前即时伤害名次，`selectedByBeam`表示原基础束是否保留该状态。该模式用于评估真实剪枝边界，不用于替代完整重合成。

`evaluate:value-model`的第四个参数传`beam-shadow`时，按基础5槽+价值1槽对比同预算即时伤害前6名，并把逐轴外层留出、内层逐来源验证全部通过的策略写入`*-policy.json`。未通过门控的策略会写成`enabled: false`，`optimize:segments`会拒绝加载。

### 联合区段专用探针

`collect:multisegment-value-data`复用同一特征、残差和来源轴隔离规则，但标签与单区段决赛祖先不同。`sample`使用逐行束12、边界束6，每8行探测即时伤害前16名；`screen`使用逐行束32、边界束12，每4行探测前32名。所有额外工作只在`collectValueTrainingData`显式开启时发生，不进入正式联合搜索候选。

该命令同时生成四套文件：

- 主文件包含全部探针，供统一审计；
- `*-reference`包含逐行与边界的统一参考后缀标签；
- `*-actual`只包含每个边界剪枝前状态经独立小束完成下一整个雷区段后的实际收益，是边界价值模型的主要训练输入；
- `*-full-descendant`只记录最终决赛谱系的180秒回传，样本稀疏，单独作为诊断，不与下一段标签混训。

下一段探针从候选的完整状态出发，固定下一雷区段首行开雷，使用同一机制动作空间和状态机完成全部主要技能；局部束不会写回正式联合搜索。因此它可以给边界第7名之后的候选贴标签，又不会因为额外探针改变原搜索路径。标签先计算下一段相对参考轴的真实伤害差，再把参考尾部作为共同常数补齐到`bestFinalDamage`字段；用于候选排序的`remainingDamageResidual`等价于“该状态下一段最佳新增伤害减去参考轴同段新增伤害”。

八来源轴sample共完成576/576个合法下一段探针，额外展开207,840次只读标签转移；训练/验证/测试按来源轴得到432/72/72条记录。即时伤害前6名的已知优解召回为81.25%，平均遗憾1,522,513；同预算“即时前5+线性价值1”提高到97.92%，平均遗憾降至154,907。嵌套外层8折中6折改善、2折持平、0折退化，但当前部署门控还要求8/8折都严格改善，故生成策略仍为`enabled: false`。该结果证明标签有价值信号，不足以直接上线；下一步应执行前32名screen并检查结论是否稳定。

screen的正式边界束为12，因此离线评估必须使用`boundary-shadow`。该配置直接读取`selectedByBaselineBeam`，保留原有帕累托、后缀价值和多样性选择得到的12个基础状态，再分别追加1个纯即时伤害影子或1个价值影子；只有价值影子在相同13槽成本下继续改善，才算模型收益。`beam-shadow`的5+1只适用于sample，不能用来判断screen部署价值。

八来源轴screen共执行299,672/227,417次正式展开/合法转移，以及522,296/351,374次只读下一段探针；总文件4,347条，`*-actual`含1,536条记录，对应48个边界决策组。逐轴外层留出结果为：原12槽基础选择器召回66.67%、平均遗憾2,986,505；追加纯伤害影子后为66.67%和2,949,219；追加线性价值影子后为95.83%和238,055。模型相对纯伤害影子在8/8个来源改善，因此生成的`boundary-shadow`策略允许显式在线加载。

在线阶段严格按训练分布应用：只在雷区段边界引入价值影子，区段逐行束仅传播该谱系。当前180秒screen中价值影子贯穿7个边界，最终核心仍低基础8,908,417伤害；同成本纯伤害影子低7,899,407，反而更接近基线。结论是“一段最佳收益”标签能准确改善下一段选择，却不足以代表180秒终局价值。下一版数据将把实际探针视野扩为两个雷区段，并在战斗尾部使用剩余全轴视野；现有一段策略继续保留为可复现实验，不设为默认搜索。

## 节点与标签

只记录每层束中实际保留的节点和被钉住的热启动节点。每个节点包含`traceId`、`nodeId`、`parentNodeId`、层号、全局技能行、雷谱系、进入该状态的动作与机制状态特征。

完整固定后缀合法的决赛节点提供最终伤害标签。该伤害沿父链反向传播；一个祖先拥有多个合法后代时，标签取已知最高最终伤害，并保留`descendantOutcomeCount`。没有任何合法完整后代的节点不进入第一版监督数据。

主要监督目标为：

```text
bestRemainingDamage = bestFinalDamage - totalDamage
remainingDamageResidual = bestRemainingDamage - referenceRemainingDamage
centeredRemainingDamageResidual = remainingDamageResidual - 同一轨迹同一层均值
```

`referenceRemainingDamage`来自同一技能行上当前参考轴的剩余核心循环伤害。线性模型训练使用层内中心化残差；减去同一决策组的常数不改变候选排序，可以避免模型浪费容量学习不同轴和不同行的绝对基准偏移。突在区段主要技能搜索后独立覆盖，因此该数据集和区段束搜索一致，学习核心轴长期价值，不把后续突重排结果混入标签。

## 特征

第一版数值特征包括：

- 已过/剩余时间、GCD等待；
- 战意、龙驭、马上状态；
- 流血层数、品质、下一跳和剩余时间，梅花枪法下一击相位；
- 灭、龙吟、断魂刺、突和橙武CD；
- 雷、橙武、任驰骋、破军、破楼兰等增益剩余时间；
- 雷和任驰骋的可用充能与顺序恢复队列；
- 斩杀灭切换状态及当前雷内龙牙、龙吟、断魂刺上下文。

动作与雷谱系作为审计字段保留，第一版线性模型不会默认将字符串直接编码为数值特征。

## 数据划分与限制

训练、验证和测试按完整`sourceAxis + traceId`分组，父子节点不会跨集合；轨迹数不少于3时会保证验证和测试各至少一条轨迹。单一180秒轴的相邻雷区段仍可能存在边界状态相似性，因此当前screen数据只验证采集链路，不能单独用于宣称模型泛化效果。

第一版岭回归使用训练集均值/标准差归一化。离线评估同时报告纯模型排序，以及等预算的“即时伤害名额+模型独立名额”。价值槽支持预测权重收缩和即时伤害名次门控；权重为0或最大名次为2时严格退化为即时伤害前2名。

逐轴留出已升级为嵌套来源验证：外层测试轴完全不参与参数选择；剩余来源轮流作为内层验证。普通配额模型与同预算即时伤害配额比较；`boundary-shadow`与“真实基础选择器+纯伤害影子”比较。只有每个内层来源都不降低召回且不增加平均遗憾的“正则强度+预测权重+最大基线名次”组合才可启用，否则自动回退原基线。

当前八种子screen覆盖56条轨迹、462个合法完整后代和4,099条有标签节点，来源核心结构相对现最优约相差0至79行。无严格门控时，等预算召回由89.27%提高到91.26%，7/8折有局部改善；但平均遗憾由324,156升至380,368，说明最远结构轴存在高损失误选。嵌套严格门控在8个外层折全部选择基线回退，最终指标与即时伤害前2名完全一致。模型尚不具备在线替换资格。

单区段数据仍应优先生成“与当前最优同质量、但由失败修复、资源复合邻域和不同雷谱系得到”的新轴；联合区段screen已覆盖前32名，下一步优先把边界实际探针扩到两个雷区段，而不是继续扩大候选名次。两类标签保持分开评估，仍按同一嵌套门槛比较已知优解召回率、完整后缀合法率、最终最佳伤害和运行时间。
