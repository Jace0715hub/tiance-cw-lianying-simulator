import { availableCharges } from "../engine/charge-pool.js";
import {
  frameToTicks,
  millisecondsToTicks,
  ticksToMilliseconds,
} from "../engine/clock.js";
import { executeActionPack } from "../engine/simulator.js";
import { createInitialState } from "../engine/state.js";

const ANCHOR_ACTIONS = new Set(["thunder", "orange", "ride", "dismount"]);
const COOLDOWN_ACTIONS = ["destroy", "dragonRoar", "charge", "dash", "orange"];
const BUFF_ACTIONS = ["thunder", "orange", "ride", "poLouLan"];

function actionId(action) {
  return typeof action === "string" ? action : action?.id;
}

function seconds(tick) {
  return ticksToMilliseconds(Number(tick ?? 0)) / 1000;
}

function round(value, digits = 4) {
  const scale = 10 ** digits;
  return Math.round(Number(value) * scale) / scale;
}

function chargeSnapshot(pool, tick) {
  const current = structuredClone(pool);
  const ready = availableCharges(current, tick);
  const nextReadyTick = Number(current.rechargeQueue[0] ?? tick);
  return {
    ready,
    capacity: current.capacity,
    nextReadyInSeconds: ready >= current.capacity
      ? 0
      : round(Math.max(0, seconds(nextReadyTick - tick))),
    rechargeQueueInSeconds: current.rechargeQueue.map(
      (readyTick) => round(Math.max(0, seconds(readyTick - tick))),
    ),
  };
}

function stateSnapshot(state) {
  const tick = Number(state.tick);
  return {
    seconds: round(seconds(tick)),
    rage: state.rage,
    dragonRide: state.dragonRideStacks,
    mounted: state.mounted,
    cooldownReadyInSeconds: Object.fromEntries(COOLDOWN_ACTIONS.map((name) => [
      name,
      round(Math.max(0, seconds(
        Number(state.cooldownReadyTick[name] ?? 0) - tick,
      ))),
    ])),
    charges: {
      thunder: chargeSnapshot(state.chargeTicks.thunder, tick),
      ride: chargeSnapshot(state.chargeTicks.ride, tick),
    },
    buffRemainingSeconds: Object.fromEntries(BUFF_ACTIONS.map((name) => [
      name,
      round(Math.max(0, seconds(
        Number(state.buffTicks[`${name}Until`] ?? 0) - tick,
      ))),
    ])),
  };
}

function eventPlacement(pack, event, castEvent) {
  if (event.type === "cast" && actionId(pack.primary) === event.action) {
    return "primary";
  }
  const prefix = (pack.prefix ?? []).map(actionId);
  const tail = (pack.tail ?? []).map(actionId);
  if (prefix.includes(event.action) && !tail.includes(event.action)) return "prefix";
  if (tail.includes(event.action) && !prefix.includes(event.action)) return "tail";
  return Number(event.tick) <= Number(castEvent?.tick ?? event.tick)
    ? "prefix"
    : "tail";
}

function eventState(event, rowStart, rowEnd) {
  return {
    rageBefore: event.rageBefore ?? event.rageBeforeCast ?? rowStart.rage,
    rageAfter: event.rageAfter ?? event.rageAfterResolution ?? rowEnd.rage,
    dragonRideBefore:
      event.dragonRideStacksAtStart ?? event.stacksBefore ?? rowStart.dragonRide,
    dragonRideAfter: event.stacksAfter ?? rowEnd.dragonRide,
    mountedBefore: event.mountedBefore ?? event.mounted ?? rowStart.mounted,
    mountedAfter: event.action === "dismount"
      ? false
      : event.action === "ride"
        ? true
        : rowEnd.mounted,
    thunderActive: Boolean(event.thunder),
    orangeActive: Boolean(event.orange),
    rideActive: Boolean(event.ride),
  };
}

function eventActiveWindow(event, config) {
  const castSeconds = seconds(event.tick);
  if (event.action === "ride") {
    const from = Number(event.completionAtMs) / 1000;
    return {
      fromSeconds: round(from),
      untilSeconds: round(
        from + seconds(frameToTicks(config.durations.ride)),
      ),
    };
  }
  if (event.action === "thunder" || event.action === "orange") {
    return {
      fromSeconds: round(castSeconds),
      untilSeconds: round(
        castSeconds + seconds(frameToTicks(config.durations[event.action])),
      ),
    };
  }
  return { fromSeconds: null, untilSeconds: null };
}

function nearestAnchor(anchor, anchors, type) {
  const matches = anchors.filter((candidate) => candidate.type === type);
  if (matches.length === 0) return null;
  const nearest = [...matches].sort((left, right) =>
    Math.abs(left.seconds - anchor.seconds) -
      Math.abs(right.seconds - anchor.seconds) ||
    left.seconds - right.seconds)[0];
  return {
    anchorId: nearest.anchorId,
    rowDelta: nearest.rowNumber - anchor.rowNumber,
    secondsDelta: round(nearest.seconds - anchor.seconds),
  };
}

function addAnchorRelationships(anchors) {
  const types = ["thunder", "orange", "ride", "dismount"];
  return anchors.map((anchor, index) => {
    const sameType = anchors.filter((candidate) => candidate.type === anchor.type);
    const sameIndex = sameType.findIndex(
      (candidate) => candidate.anchorId === anchor.anchorId,
    );
    const previous = sameType[sameIndex - 1] ?? null;
    const next = sameType[sameIndex + 1] ?? null;
    return {
      ...anchor,
      ordinal: sameIndex + 1,
      previousSameTypeGapSeconds: previous
        ? round(anchor.seconds - previous.seconds)
        : null,
      nextSameTypeGapSeconds: next
        ? round(next.seconds - anchor.seconds)
        : null,
      nearestByType: Object.fromEntries(types.map((type) => [
        type,
        type === anchor.type
          ? null
          : nearestAnchor(anchor, anchors, type),
      ])),
      sequenceIndex: index,
    };
  });
}

function overlapSeconds(leftFrom, leftUntil, rightFrom, rightUntil) {
  return round(Math.max(
    0,
    Math.min(leftUntil, rightUntil) - Math.max(leftFrom, rightFrom),
  ));
}

function buildThunderSegments(anchors, durationSeconds) {
  const thunders = anchors.filter((anchor) => anchor.type === "thunder");
  const rides = anchors.filter((anchor) => anchor.type === "ride");
  const oranges = anchors.filter((anchor) => anchor.type === "orange");
  const dismounts = anchors.filter((anchor) => anchor.type === "dismount");
  return thunders.map((thunder, index) => {
    const nextThunder = thunders[index + 1] ?? null;
    const segmentUntil = nextThunder?.seconds ?? durationSeconds;
    const thunderUntil = Math.min(
      segmentUntil,
      thunder.activeWindow.untilSeconds,
    );
    const precedingRides = rides.filter((ride) => ride.seconds <= thunder.seconds);
    const pairedRide = precedingRides.at(-1) ?? null;
    const rideOverlap = pairedRide
      ? overlapSeconds(
          pairedRide.activeWindow.fromSeconds,
          pairedRide.activeWindow.untilSeconds,
          thunder.seconds,
          thunderUntil,
        )
      : 0;
    const overlappingOranges = oranges.filter((orange) =>
      overlapSeconds(
        orange.activeWindow.fromSeconds,
        orange.activeWindow.untilSeconds,
        thunder.seconds,
        thunderUntil,
      ) > 0);
    return {
      segment: index + 1,
      fromAnchorId: thunder.anchorId,
      startRow: thunder.rowNumber,
      startSeconds: thunder.seconds,
      endSeconds: round(segmentUntil),
      thunderUntilSeconds: round(thunderUntil),
      startState: thunder.rowStart,
      pairedRideAnchorId: pairedRide?.anchorId ?? null,
      rideToThunderSeconds: pairedRide
        ? round(thunder.seconds - pairedRide.seconds)
        : null,
      rideBuffToThunderSeconds: pairedRide
        ? round(thunder.seconds - pairedRide.activeWindow.fromSeconds)
        : null,
      rideThunderOverlapSeconds: rideOverlap,
      orangeAnchorIds: overlappingOranges.map((anchor) => anchor.anchorId),
      orangeThunderOverlapSeconds: round(overlappingOranges.reduce(
        (total, orange) => total + overlapSeconds(
          orange.activeWindow.fromSeconds,
          orange.activeWindow.untilSeconds,
          thunder.seconds,
          thunderUntil,
        ),
        0,
      )),
      dismountAnchorIds: dismounts
        .filter((anchor) =>
          anchor.seconds >= thunder.seconds && anchor.seconds < segmentUntil)
        .map((anchor) => anchor.anchorId),
    };
  });
}

/**
 * 从一条已经通过完整状态机的技能轴中抽取高层锚点。该函数只读复演，
 * 不移动动作，也不把任雷绑定、橙武覆盖或下马位置升级为硬约束。
 */
export function extractLianyingAnchorTemplate(
  runtime,
  actionPacks,
  { durationSeconds = 180 } = {},
) {
  const endTick = millisecondsToTicks(Number(durationSeconds) * 1000);
  let state = createInitialState(runtime.config, {
    rage: 5,
    bleedStacks: 0,
    executePhase: true,
    ...runtime.initialStateOverrides,
  });
  const anchors = [];

  for (let rowIndex = 0; rowIndex < actionPacks.length; rowIndex += 1) {
    if (Math.max(state.tick, state.gcdReadyTick) >= endTick) break;
    const pack = actionPacks[rowIndex];
    const before = state;
    const sequenceBefore = state.sequence;
    state = executeActionPack(state, pack, runtime.config, runtime.oracle, {
      endTick,
    });
    const events = state.timeline.filter(
      (event) => event.sequence > sequenceBefore,
    );
    const castEvent = events.find((event) => event.type === "cast");
    const rowStart = stateSnapshot(before);
    const rowEnd = stateSnapshot(state);
    for (const event of events) {
      if (!ANCHOR_ACTIONS.has(event.action)) continue;
      if (event.type !== "cast" && event.type !== "offGcd") continue;
      anchors.push({
        anchorId: `${event.action}-${anchors.length + 1}`,
        type: event.action,
        rowIndex,
        rowNumber: rowIndex + 1,
        placement: eventPlacement(pack, event, castEvent),
        tick: event.tick,
        seconds: round(seconds(event.tick)),
        reason: event.reason ?? null,
        activeWindow: eventActiveWindow(event, runtime.config),
        rowStart,
        eventState: eventState(event, rowStart, rowEnd),
        rowEnd,
      });
    }
  }

  const relatedAnchors = addAnchorRelationships(anchors);
  const byType = Object.fromEntries(
    [...ANCHOR_ACTIONS].map((type) => [
      type,
      relatedAnchors.filter((anchor) => anchor.type === type),
    ]),
  );
  const thunderSegments = buildThunderSegments(
    relatedAnchors,
    Number(durationSeconds),
  );
  const compactTemplate = {
    thunderRows: byType.thunder.map((anchor) => anchor.rowNumber),
    orangeRows: byType.orange.map((anchor) => anchor.rowNumber),
    rideRows: byType.ride.map((anchor) => anchor.rowNumber),
    dismountRows: byType.dismount.map((anchor) => anchor.rowNumber),
  };

  return {
    schemaVersion: 1,
    kind: "tiance-cw-lianying-anchor-template",
    purpose: "read-only-high-level-anchor-audit",
    durationSeconds: Number(durationSeconds),
    summary: {
      totalAnchors: relatedAnchors.length,
      thunderAnchors: byType.thunder.length,
      orangeAnchors: byType.orange.length,
      rideAnchors: byType.ride.length,
      dismountAnchors: byType.dismount.length,
      sameRowRideThunder: thunderSegments.filter((segment) => {
        const ride = relatedAnchors.find(
          (anchor) => anchor.anchorId === segment.pairedRideAnchorId,
        );
        return ride?.rowNumber === segment.startRow;
      }).length,
      thunderWithoutRideOverlap: thunderSegments.filter(
        (segment) => segment.rideThunderOverlapSeconds === 0,
      ).length,
      totalRideThunderOverlapSeconds: round(thunderSegments.reduce(
        (total, segment) => total + segment.rideThunderOverlapSeconds,
        0,
      )),
      totalOrangeThunderOverlapSeconds: round(thunderSegments.reduce(
        (total, segment) => total + segment.orangeThunderOverlapSeconds,
        0,
      )),
    },
    compactTemplate,
    anchors: relatedAnchors,
    byType,
    thunderSegments,
  };
}

export function lianyingAnchorTemplateToCsv(report) {
  const header = [
    "anchorId",
    "type",
    "ordinal",
    "rowNumber",
    "placement",
    "seconds",
    "rageAtRowStart",
    "dragonRideAtRowStart",
    "mountedAtRowStart",
    "thunderChargesAtRowStart",
    "rideChargesAtRowStart",
    "destroyReadyInSeconds",
    "dragonRoarReadyInSeconds",
    "chargeReadyInSeconds",
    "orangeReadyInSeconds",
    "thunderBuffRemainingSeconds",
    "orangeBuffRemainingSeconds",
    "rideBuffRemainingSeconds",
    "previousSameTypeGapSeconds",
    "nextSameTypeGapSeconds",
    "reason",
  ];
  const escape = (value) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const rows = report.anchors.map((anchor) => [
    anchor.anchorId,
    anchor.type,
    anchor.ordinal,
    anchor.rowNumber,
    anchor.placement,
    anchor.seconds,
    anchor.rowStart.rage,
    anchor.rowStart.dragonRide,
    Number(anchor.rowStart.mounted),
    anchor.rowStart.charges.thunder.ready,
    anchor.rowStart.charges.ride.ready,
    anchor.rowStart.cooldownReadyInSeconds.destroy,
    anchor.rowStart.cooldownReadyInSeconds.dragonRoar,
    anchor.rowStart.cooldownReadyInSeconds.charge,
    anchor.rowStart.cooldownReadyInSeconds.orange,
    anchor.rowStart.buffRemainingSeconds.thunder,
    anchor.rowStart.buffRemainingSeconds.orange,
    anchor.rowStart.buffRemainingSeconds.ride,
    anchor.previousSameTypeGapSeconds,
    anchor.nextSameTypeGapSeconds,
    anchor.reason,
  ]);
  return [header, ...rows]
    .map((row) => row.map(escape).join(","))
    .join("\n") + "\n";
}
