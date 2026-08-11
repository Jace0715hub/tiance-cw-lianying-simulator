import { createZeroDamageOracle } from "../engine/damage-oracle.js";
import { executeActionPack } from "../engine/simulator.js";
import { millisecondsToTicks } from "../engine/clock.js";
import { ticksToMilliseconds } from "../engine/clock.js";

const TRACE_BUFF_NAMES = Object.freeze([
  "thunder",
  "orange",
  "ride",
  "bleed",
  "breakArmy",
]);

function postCastBuffSnapshot(state, tick) {
  return Object.fromEntries(
    TRACE_BUFF_NAMES.map((name) => {
      const from = Number(state.buffTicks?.[`${name}From`] ?? 0);
      const until = Number(state.buffTicks?.[`${name}Until`] ?? 0);
      return [name, tick >= from && tick < until];
    }),
  );
}

const PRIMARY_TOKENS = Object.freeze([
  ["任驰骋", "ride"],
  ["龙牙", "dragonFang"],
  ["龙吟", "dragonRoar"],
  ["穿云", "cloudStrike"],
  ["灭", "destroy"],
]);

export function compileProfileLabel(label, { orangeLeadFrames = 1 } = {}) {
  const source = String(label ?? "").trim();
  if (!source) throw new Error("技能表标签不能为空");

  const primaries = PRIMARY_TOKENS.filter(([token]) => source.includes(token));
  if (primaries.length !== 1) {
    throw new Error(`技能表标签必须且只能包含一个主要技能: ${source}`);
  }

  const prefix = [];
  if (source.includes("雷")) prefix.push("thunder");
  if (source.includes("断魂刺")) prefix.push("charge");

  const tail = [];
  if (source.includes("CW")) {
    tail.push({ id: "orange", leadFrames: orangeLeadFrames });
  }

  let remainder = source;
  for (const [token] of PRIMARY_TOKENS) remainder = remainder.replaceAll(token, "");
  remainder = remainder
    .replaceAll("断魂刺", "")
    .replaceAll("力破万钧", "")
    .replaceAll("雷", "")
    .replaceAll("-CW", "")
    .replaceAll("CW", "")
    .trim();
  if (remainder) throw new Error(`技能表标签包含未识别内容“${remainder}”: ${source}`);

  return {
    prefix,
    primary: primaries[0][1],
    tail,
    sourceLabel: source,
  };
}

function castResourceSnapshot(events, fallbackRage) {
  const cast = events.find((event) => event.type === "cast");
  if (!cast) throw new Error("动作包没有产生主要技能事件");
  if (cast.action === "dragonFang") {
    return {
      before: cast.rageBeforeCast,
      after: cast.rageAfterResolution,
    };
  }
  if (Number.isFinite(cast.rageBefore) && Number.isFinite(cast.rageAfter)) {
    return { before: cast.rageBefore, after: cast.rageAfter };
  }
  return { before: fallbackRage, after: fallbackRage };
}

function expectedResource(row, key, fallbackKey) {
  const value = row?.[key] ?? row?.[fallbackKey];
  return value === "" || value === null || value === undefined
    ? null
    : Number(value);
}

export function replayProfileRows(
  initialState,
  rows,
  config,
  oracle = createZeroDamageOracle(),
  {
    autoDismount = true,
    validateResource = true,
    orangeLeadFrames = 1,
    combatEndSeconds = null,
  } = {},
) {
  let state = initialState;
  const trace = [];
  const endTick = combatEndSeconds === null
    ? Number.POSITIVE_INFINITY
    : millisecondsToTicks(Number(combatEndSeconds) * 1000);

  for (let index = 0; index < rows.length; index += 1) {
    if (Math.max(state.tick, state.gcdReadyTick) > endTick) break;
    const row = rows[index];
    const label = String(row?.skill ?? row?.label ?? "").trim();
    if (!label) break;
    const pack = compileProfileLabel(label, { orangeLeadFrames });
    const rideRequiresDismount = pack.primary === "ride";
    const autoDismounted =
      autoDismount &&
      state.mounted &&
      (state.dragonRideStacks === 0 || rideRequiresDismount);
    // 若本行带断魂刺，先在马上完成断魂刺，再下马施展主要技能。
    if (autoDismounted) pack.prefix.push("dismount");

    const startFrame = state.frame;
    const startTick = state.tick;
    const sequenceBefore = state.sequence;
    const fallbackRage = state.rage;
    const dragonRideStacksBefore = state.dragonRideStacks;
    const mountedBefore = state.mounted;
    state = executeActionPack(state, pack, config, oracle, { endTick });
    const events = state.timeline.filter((event) => event.sequence > sequenceBefore);
    const castEvent = events.find((event) => event.type === "cast");
    const actual = castResourceSnapshot(events, fallbackRage);
    const expectedBefore = expectedResource(row, "resourceBefore", "resource");
    const expectedAfter = expectedResource(row, "resourceAfter", "resourceAfter");

    if (
      validateResource &&
      ((expectedBefore !== null && actual.before !== expectedBefore) ||
        (expectedAfter !== null && actual.after !== expectedAfter))
    ) {
      throw new Error(
        `技能表第${index + 1}行“${label}”战意不一致: ` +
          `施展前 ${actual.before}/${expectedBefore}，施展后 ${actual.after}/${expectedAfter}`,
      );
    }

    trace.push({
      index,
      label,
      startTick,
      startFrame,
      startTimeMs: ticksToMilliseconds(startTick),
      castTick: castEvent?.tick ?? startTick,
      castFrame: castEvent?.frame ?? startFrame,
      castTimeMs: castEvent?.timeMs ?? ticksToMilliseconds(startTick),
      endTick: state.tick,
      endFrame: state.frame,
      endTimeMs: state.timeMs,
      sequenceFrom: sequenceBefore + 1,
      sequenceUntil: state.sequence,
      expectedBefore,
      expectedAfter,
      actualBefore: actual.before,
      actualAfter: actual.after,
      dragonRideStacksBefore,
      dragonRideStacksAfter: state.dragonRideStacks,
      mountedBefore,
      mountedAfter: state.mounted,
      bleedStacksAfter: state.bleedStacks,
      bleedQualityAfter: state.bleedQuality,
      buffsAtCast: postCastBuffSnapshot(state, castEvent?.tick ?? startTick),
      autoDismounted,
    });
  }

  return { state, trace };
}
