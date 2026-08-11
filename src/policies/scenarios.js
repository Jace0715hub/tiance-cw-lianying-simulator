function repeat(count, factory) {
  return Array.from({ length: count }, (_, index) => factory(index));
}

export function orangeBurstOnFoot() {
  return [
    {
      primary: "dragonRoar",
      tail: [
        { id: "thunder", leadFrames: 1 },
        { id: "orange", leadFrames: 1 },
      ],
    },
    ...repeat(5, () => ({ primary: "dragonFang" })),
  ];
}

export function orangeBurstThenRide() {
  return [
    ...orangeBurstOnFoot(),
    { primary: "ride" },
    { prefix: ["charge"], primary: "dragonFang" },
  ];
}

export function fullMountedOverlap() {
  return [
    { primary: "ride" },
    {
      prefix: ["charge"],
      primary: "dragonRoar",
      tail: [
        { id: "thunder", leadFrames: 1 },
        { id: "orange", leadFrames: 1 },
      ],
    },
    ...repeat(5, () => ({ primary: "dragonFang" })),
  ];
}

export function orangeThunderOverlapOnFoot(overlapSeconds = 3) {
  const overlap = Number(overlapSeconds);
  if (!Number.isFinite(overlap) || overlap < 0 || overlap > 6) {
    throw new Error("激雷与橙武重叠时间必须位于0到6秒之间");
  }
  const waitFrames = (18 - overlap) * 16;
  if (!Number.isInteger(waitFrames)) {
    throw new Error("重叠时间必须能够精确换算为游戏帧");
  }
  return [
    {
      primary: "dragonRoar",
      tail: [{ id: "thunder", leadFrames: 1 }],
    },
    {
      primary: { id: "wait", frames: waitFrames },
      tail: [{ id: "orange", leadFrames: 1 }],
    },
    ...repeat(5, () => ({ primary: "dragonFang" })),
  ];
}

export function partialOrangeThunderOverlapOnFoot() {
  return orangeThunderOverlapOnFoot(3);
}

export function staggeredOrangeAfterThunderOnFoot() {
  return orangeThunderOverlapOnFoot(0);
}
