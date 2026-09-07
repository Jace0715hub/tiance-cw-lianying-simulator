import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { loadDefaultGearRuntime } from "../src/config/gear-template.js";
import {
  lianyingFocusedPrimaryMutations,
  searchLianyingDismountPrimaryJointNeighborhood,
} from "../src/policies/lianying-dismount-primary-joint-neighborhood.js";

const artifact = JSON.parse(fs.readFileSync(new URL(
  "../output/lianying-free-fixed-180s-dismount-triple-transfer.json",
  import.meta.url,
)));

test("聚焦主技能邻域只改第2、3、5雷且保持非GCD动作", () => {
  const mutations = lianyingFocusedPrimaryMutations(artifact.actionPacks, {
    segmentNumbers: [2, 3, 5],
    maxSwapDistance: 4,
    maxRotationLength: 4,
  });
  assert.ok(mutations.length > 0);
  assert.ok(mutations.every((mutation) => [1, 2, 4].includes(
    mutation.sourceSegment,
  )));
  for (const mutation of mutations.slice(0, 20)) {
    for (const [index, pack] of mutation.changes) {
      assert.deepEqual(pack.prefix, artifact.actionPacks[index].prefix);
      assert.deepEqual(pack.tail, artifact.actionPacks[index].tail);
    }
  }
});

test("下马平台与主技能代表可以联合完整重放且正式轴不降级", () => {
  const runtime = loadDefaultGearRuntime({ rotation: "lianying", executePhase: true });
  const searched = searchLianyingDismountPrimaryJointNeighborhood(
    runtime,
    artifact.actionPacks,
    {
      durationSeconds: 180,
      segmentNumbers: [2, 3, 5],
      maxDismountDistance: 2,
      maxSwapDistance: 2,
      maxRotationLength: 3,
      mainRepresentativesPerKind: 1,
      dismountRepresentativesPerSegment: 1,
      maxJointCandidates: 8,
      finalistCount: 2,
    },
  );
  assert.ok(searched.generatedPrimaryCandidates > 0);
  assert.ok(searched.generatedDismountCandidates > 0);
  assert.ok(searched.generatedJointCandidates > 0);
  assert.ok(searched.legalJointCandidates > 0);
  assert.ok(searched.state.totalDamage >= searched.baselineDamage);
});
