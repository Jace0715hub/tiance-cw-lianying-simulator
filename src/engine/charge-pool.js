export function createChargePool(definition) {
  return {
    capacity: Number(definition.capacity),
    rechargeFrames: Number(definition.rechargeFrames),
    mode: definition.mode ?? "sequential",
    ready: Number(definition.capacity),
    rechargeQueue: [],
  };
}

export function refreshChargePool(pool, frame) {
  while (pool.rechargeQueue.length > 0 && pool.rechargeQueue[0] <= frame) {
    pool.rechargeQueue.shift();
    pool.ready = Math.min(pool.capacity, pool.ready + 1);
  }
  return pool;
}

export function availableCharges(pool, frame) {
  refreshChargePool(pool, frame);
  return pool.ready;
}

export function consumeCharge(pool, frame) {
  refreshChargePool(pool, frame);
  if (pool.ready <= 0) {
    throw new Error("充能不足");
  }

  pool.ready -= 1;
  const lastDue = pool.rechargeQueue.at(-1);
  const rechargeStart =
    pool.mode === "sequential" && Number.isFinite(lastDue)
      ? Math.max(frame, lastDue)
      : frame;
  const due = rechargeStart + pool.rechargeFrames;
  pool.rechargeQueue.push(due);
  pool.rechargeQueue.sort((left, right) => left - right);
  return due;
}
