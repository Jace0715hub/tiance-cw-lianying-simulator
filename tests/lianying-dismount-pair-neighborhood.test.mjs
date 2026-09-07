import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import {
  applyLianyingDismountTransferMutations,
  lianyingDismountTransferMutations,
  searchLianyingDismountPairNeighborhood,
  searchLianyingDismountTripleNeighborhood,
} from "../src/policies/lianying-dismount-pair-neighborhood.js";

const artifact = JSON.parse(fs.readFileSync(new URL(
  "../output/lianying-free-fixed-180s-pruned-suffix-revival.json",
  import.meta.url,
)));
const packs = artifact.actionPacks;

test("下马突包迁移保持GCD主技能并覆盖早晚两个雷窗口", () => {
  const mutations = lianyingDismountTransferMutations(packs, {
    maxDistance: 4,
  });
  const early = mutations.find((mutation) =>
    mutation.sourceIndex === 15 && mutation.targetIndex === 16);
  const late = mutations.find((mutation) =>
    mutation.sourceIndex === 123 && mutation.targetIndex === 120);
  assert.ok(early);
  assert.ok(late);
  assert.notEqual(early.sourceSegment, late.sourceSegment);
  const combined = applyLianyingDismountTransferMutations(packs, [early, late]);
  assert.deepEqual(
    combined.map((pack) => pack.primary),
    packs.map((pack) => pack.primary),
  );
});

test("三窗口搜索压缩每雷代表并完整复演互不冲突的三元组", () => {
  const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
  const searched = searchLianyingDismountTripleNeighborhood(runtime, packs, {
    durationSeconds: 180,
    maxDistance: 4,
    maxRepresentativesPerSegment: 2,
    maxTripleCandidates: 16,
    finalistCount: 2,
    sourceRows: [16, 84, 124],
    targetRows: [17, 83, 121],
  });
  assert.ok(searched.eligibleSingleCandidates >= 3);
  assert.ok(searched.representativeSingleCandidates >= 3);
  assert.ok(searched.evaluatedRepresentativePairs >= 3);
  assert.ok(searched.generatedTripleCandidates > 0);
  assert.ok(searched.legalTripleCandidates > 0);
  assert.ok(searched.state.totalDamage >= searched.baselineDamage);
});

test("双窗口搜索只组合各自不增伤的合法单移并保持正式轴不降级", () => {
  const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
  const searched = searchLianyingDismountPairNeighborhood(runtime, packs, {
    durationSeconds: 180,
    maxDistance: 4,
    maxPairCandidates: 32,
    finalistCount: 2,
    sourceRows: [16, 124],
    targetRows: [17, 121],
  });
  assert.ok(searched.generatedSingleCandidates > 0);
  assert.ok(searched.eligibleSingleCandidates > 0);
  assert.ok(searched.generatedPairCandidates > 0);
  assert.ok(searched.legalPairCandidates > 0);
  assert.equal(searched.state.totalDamage, searched.baselineDamage);
});
