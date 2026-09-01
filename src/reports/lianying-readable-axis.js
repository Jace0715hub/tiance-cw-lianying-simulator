function formatNumber(value, digits = 2) {
  return Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatSeconds(value) {
  return Number(value).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function formatDamage(value) {
  return `${formatNumber(Number(value) / 1_000_000, 3)}M`;
}

function escapeCell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function castState(row) {
  const states = [row.mountedAtCast ? "马上" : "马下"];
  if (row.thunderAtCast) states.push("雷");
  if (row.rideAtCast) states.push("驰");
  if (row.orangeAtCast) states.push("橙");
  return states.join("+");
}

function rowLine(row) {
  return [
    row.rowNumber,
    formatSeconds(row.castSeconds),
    escapeCell(row.skill),
    `${row.rageBeforePrimary}→${row.rageAfterPrimary}`,
    `${row.dragonRideBefore}→${row.dragonRideAfter}`,
    castState(row),
    row.bleedStacksAfter,
    formatDamage(row.rowDamage),
  ].join(" | ");
}

function thunderBindingLabel(binding) {
  return ({
    "same-row-ride": "任驰骋同行接雷",
    "delayed-under-ride-buff": "已有驰骋增益后接雷",
    "no-ride-buff": "单雷（无驰骋增益）",
  })[binding] ?? binding;
}

function damageBreakdownLines(summary) {
  return Object.entries(summary.damageBreakdown)
    .sort((left, right) => right[1] - left[1])
    .map(([id, damage]) => `| ${id} | ${formatNumber(damage, 2)} |`)
    .join("\n");
}

export function lianyingAxisToReadableMarkdown(artifact, {
  sourcePath = null,
} = {}) {
  const { summary, structureAnalysis, rows } = artifact;
  const windows = structureAnalysis.thunderWindows;
  const sections = [];
  const firstThunderRow = windows[0]?.startRow ?? rows.length + 1;
  if (firstThunderRow > 1) {
    sections.push({
      title: "起手（首雷前）",
      detail: `第1–${firstThunderRow - 1}行`,
      rows: rows.slice(0, firstThunderRow - 1),
    });
  }
  for (let index = 0; index < windows.length; index += 1) {
    const window = windows[index];
    const nextStart = windows[index + 1]?.startRow ?? rows.length + 1;
    sections.push({
      title: `第${window.index}雷区段`,
      detail:
        `${formatSeconds(window.startSeconds)}–${formatSeconds(window.endSeconds)}秒雷窗口；` +
        `${thunderBindingLabel(window.rideThunderBinding)}；` +
        `开雷${window.rageAtStart}豆、${window.dragonRideStacksAtStart}层龙驭；` +
        `雷内龙牙${window.dragonFangRows.length}次，其中马下` +
        `${window.onFootDragonFangRows.length}次`,
      rows: rows.slice(window.startRow - 1, nextStart - 1),
    });
  }

  const sectionText = sections.map((section) => [
    `## ${section.title}`,
    "",
    section.detail,
    "",
    "行 | 时间(s) | 技能组合 | 战意 | 龙驭 | 施展状态 | 流血层数 | 本行伤害",
    "---: | ---: | --- | ---: | ---: | --- | ---: | ---:",
    ...section.rows.map(rowLine),
  ].join("\n")).join("\n\n");

  return [
    "# 傲血大橙武连营 180 秒正式技能轴（可读版）",
    "",
    sourcePath ? `来源：\`${sourcePath}\`` : null,
    "",
    "> 默认环境：五段加速、30ms总延迟、斩杀木桩、固定180秒。技能组合按同一GCD内的实际先后顺序显示。",
    "",
    "## 总览",
    "",
    `- 循环伤害：${formatNumber(summary.rotationDamage, 2)}`,
    `- 循环DPS：${formatNumber(summary.rotationDps, 2)}`,
    `- 含装备与附魔总DPS：${formatNumber(summary.dps, 2)}`,
    `- 龙牙：${summary.dragonFang.total}次；雷内${summary.dragonFang.underThunder}次；橙武内${summary.dragonFang.underOrange}次；龙驭增强${summary.dragonFang.dragonRideEnhanced}次；马上${summary.dragonFang.mounted}次`,
    `- 灭：${summary.destroy.total}次；普通${summary.destroy.normal}次；破楼兰${summary.destroy.poLouLanBonus}次`,
    `- 雷/任驰骋/橙武/突：${summary.actionCounts.thunder}/${summary.actionCounts.ride}/${summary.actionCounts.orange}/${summary.actionCounts.dash}次`,
    `- 终局：${summary.finalRage}豆、${summary.finalDragonRideStacks}层龙驭；机制违规${artifact.audit.mechanics.violationCount}项`,
    "",
    "状态缩写：`马上/马下`为技能施展瞬间姿态；`雷`、`驰`、`橙`分别表示激雷、任驰骋攻击增益和大橙武主动生效。战意和龙驭均为主要技能施展前→结算后。",
    "",
    sectionText,
    "",
    "## 伤害分项",
    "",
    "分项 | 180秒伤害",
    "--- | ---:",
    damageBreakdownLines(summary),
    "",
  ].filter((line) => line !== null).join("\n");
}
