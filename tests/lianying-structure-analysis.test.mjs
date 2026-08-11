import test from "node:test";
import assert from "node:assert/strict";
import { analyzeLianyingStructure } from "../src/reports/lianying-structure-analysis.js";

function row(rowNumber, overrides = {}) {
  return {
    rowNumber,
    skill: "龙牙",
    primaryAction: "dragonFang",
    castSeconds: rowNumber,
    rageBeforePrimary: 5,
    rageAfterPrimary: 4,
    dragonRideBefore: 0,
    dragonRideAfter: 0,
    mountedAtCast: true,
    mountedAfter: true,
    thunderAtCast: false,
    rideAtCast: false,
    offGcdActions: [],
    rowDamage: 100,
    ...overrides,
  };
}

test("结构审计识别雷内下马、马下龙牙攒龙驭和低豆开雷", () => {
  const report = analyzeLianyingStructure([
    row(1, {
      skill: "任驰骋→雷",
      primaryAction: "ride",
      castSeconds: 1,
      mountedAtCast: false,
      mountedAfter: true,
      offGcdActions: [{
        action: "thunder",
        seconds: 1.5,
        activeUntilSeconds: 19.5,
        rageBefore: 4,
        mounted: true,
        ride: true,
        dragonRideStacksAtStart: 6,
      }],
    }),
    row(2, {
      castSeconds: 2.7,
      mountedAtCast: true,
      mountedAfter: true,
      thunderAtCast: true,
      rideAtCast: true,
      dragonRideBefore: 6,
      dragonRideAfter: 5,
    }),
    row(3, {
      skill: "下马→龙牙",
      castSeconds: 3.9,
      mountedAtCast: false,
      mountedAfter: false,
      thunderAtCast: true,
      rideAtCast: true,
      dragonRideBefore: 5,
      dragonRideAfter: 6,
      offGcdActions: [{
        action: "dismount",
        seconds: 3.9,
        mounted: true,
        thunder: true,
        ride: true,
        dragonRideStacksAtStart: 5,
      }],
    }),
    row(4, {
      skill: "灭·正常",
      primaryAction: "destroy",
      destroySource: "normal",
      castSeconds: 5.1,
      mountedAtCast: false,
      mountedAfter: false,
      thunderAtCast: true,
      rideAtCast: true,
    }),
    row(5, {
      skill: "灭·破楼兰",
      primaryAction: "destroy",
      destroySource: "poLouLanBonus",
      castSeconds: 6.3,
      mountedAtCast: false,
      mountedAfter: false,
      thunderAtCast: true,
      rideAtCast: true,
    }),
  ]);

  assert.deepEqual(report.summary, {
    thunderWindows: 1,
    thunderStartsBelowFiveRage: 1,
    thunderStartsBoundToRideSameRow: 1,
    thunderStartsDelayedUnderRideBuff: 0,
    thunderStartsWithoutRideBuff: 0,
    rideCastsWithoutSameRowThunder: 0,
    dismountsDuringThunder: 1,
    onFootDragonFangsDuringThunder: 1,
    onFootThunderFangsCoveredByRideBuff: 1,
    onFootThunderFangsAfterRideBuff: 0,
    dragonRideGainedFromOnFootThunderFangs: 1,
    consecutiveDestroyChains: 1,
    dashCasts: 0,
    dashUnderBreakArmy: 0,
    dashUnderThunder: 0,
    dashUnderRide: 0,
  });
  assert.deepEqual(report.thunderWindows[0].onFootDragonFangRows, [3]);
  assert.equal(
    report.mechanicConfirmations.dismountDoesNotClearRideBuff.status,
    "confirmed-by-user",
  );
  assert.deepEqual(report.consecutiveDestroyChains[0].sources, [
    "normal",
    "poLouLanBonus",
  ]);
});
