const MISSING_LIMIT_MS = 500;
const ACTIVE_PHASES = new Set(['contact', 'pulling', 'release']);

function poseOf(face) {
  if (!face?.eyes || face.eyes.length !== 2) return null;
  const [left, right] = face.eyes;
  const roll = face.roll;
  if (![left?.x, left?.y, right?.x, right?.y, roll].every(Number.isFinite)) return null;
  const scale = Math.hypot(right.x - left.x, right.y - left.y);
  if (scale <= 0) return null;
  return {x: (left.x + right.x) / 2, y: (left.y + right.y) / 2, scale, roll, c: Math.cos(roll), s: Math.sin(roll)};
}

function local(point, pose) {
  const x = point.x - pose.x, y = point.y - pose.y;
  return {x: (x * pose.c + y * pose.s) / pose.scale, y: (-x * pose.s + y * pose.c) / pose.scale};
}

function project(point, pose) {
  return {x: pose.x + pose.scale * (point.x * pose.c - point.y * pose.s), y: pose.y + pose.scale * (point.x * pose.s + point.y * pose.c)};
}

function poseChanged(previous, next) {
  const angle = Math.atan2(Math.sin(next.roll - previous.roll), Math.cos(next.roll - previous.roll));
  return Math.hypot(next.x - previous.x, next.y - previous.y) > previous.scale
    || Math.abs(next.scale / previous.scale - 1) > .35
    || Math.abs(angle) > .7;
}

/** Retains geometry through the controller's active gesture; its global amplitude handles release. */
export function createHandConstraintTracker() {
  let remembered = [null, null], lastTimestamp, lastPose;
  function reset() {
    remembered = [null, null];
    lastTimestamp = lastPose = undefined;
  }
  return {
    reset,
    update(face, hands, timestamp, phase) {
      const pose = poseOf(face);
      if (!pose || !Number.isFinite(timestamp) || !ACTIVE_PHASES.has(phase)) { reset(); return []; }
      if (lastTimestamp !== undefined && (timestamp < lastTimestamp || poseChanged(lastPose, pose))) reset();
      lastTimestamp = timestamp;
      lastPose = pose;

      const observed = [null, null];
      for (const hand of hands ?? []) {
        if (!Array.isArray(hand) || hand.length !== 21 || hand.some(p => !Number.isFinite(p?.x) || !Number.isFinite(p?.y))) continue;
        const points = hand.map(p => local(p, pose));
        const side = points[8].x < 0 ? 0 : 1;
        // If the detector reports two hands on one side, retain the outer observation.
        if (!observed[side] || Math.abs(points[8].x) > Math.abs(observed[side].local[8].x)) {
          observed[side] = {local: points, source: hand};
        }
      }

      const result = [];
      for (let side = 0; side < 2; side++) {
        const observation = observed[side];
        if (observation) {
          remembered[side] = {points: observation.local, seenAt: timestamp};
          const hand = observation.source.map(p => ({x: p.x, y: p.y}));
          hand.weight = 1;
          result.push(hand);
          continue;
        }
        const previous = remembered[side];
        if (!previous) continue;
        const elapsed = timestamp - previous.seenAt;
        if (elapsed >= MISSING_LIMIT_MS) { remembered[side] = null; continue; }
        const hand = previous.points.map(p => project(p, pose));
        hand.weight = 1;
        result.push(hand);
      }
      return result;
    }
  };
}
