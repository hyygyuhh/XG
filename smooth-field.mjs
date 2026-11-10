const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const cross = (ax, ay, bx, by) => ax * by - ay * bx;

function axis(size, start, end, step, coarseStep) {
  const values = [0];
  const segment = (a, b, spacing) => {
    const count = Math.ceil((b - a) / spacing);
    for (let i = 1; i <= count; i++) values.push(a + (b - a) * i / count);
  };
  segment(0, start, coarseStep);
  segment(start, end, step);
  segment(end, size, coarseStep);
  return values;
}

function makeSampler(inputControls, width, height, fixedBorders, regularization, kernelRadius = 0) {
  const controls = inputControls.filter(p => (p.weight ?? 1) > 0);
  const count = controls.length;
  const px = new Float64Array(count), py = new Float64Array(count);
  const dx = new Float64Array(count), dy = new Float64Array(count), confidence = new Float64Array(count);
  const radiusSquared = kernelRadius * kernelRadius;
  for (let i = 0; i < count; i++) {
    px[i] = controls[i].x; py[i] = controls[i].y;
    dx[i] = controls[i].dx; dy[i] = controls[i].dy;
    confidence[i] = controls[i].weight ?? 1;
  }
  return (x, y) => {
    if (!count || fixedBorders && (x === 0 || x === width || y === 0 || y === height)) return {x, y};
    let weight = 0, rx = 0, ry = 0, ux = 0, uy = 0;
    let xx = 0, xy = 0, yy = 0, uxx = 0, uxy = 0, uyx = 0, uyy = 0;
    for (let i = 0; i < count; i++) {
      const a = px[i] - x, b = py[i] - y, distanceSquared = a * a + b * b;
      if (kernelRadius === 0 && distanceSquared < 1e-12) return {x: x + dx[i], y: y + dy[i]};
      const w = confidence[i] / (distanceSquared + radiusSquared), wa = w * a, wb = w * b;
      weight += w; rx += wa; ry += wb; ux += w * dx[i]; uy += w * dy[i];
      xx += wa * a; xy += wa * b; yy += wb * b;
      uxx += wa * dx[i]; uxy += wb * dx[i]; uyx += wa * dy[i]; uyy += wb * dy[i];
    }
    if (!(weight > 0)) return {x, y};
    const mx = rx / weight, my = ry / weight, tx = ux / weight, ty = uy / weight;
    xx -= rx * mx; xy -= rx * my; yy -= ry * my;
    uxx -= ux * mx; uxy -= ux * my; uyx -= uy * mx; uyy -= uy * my;
    // Regularize displacement gradients toward translation, so identity remains exact.
    const ridge = Math.max(1e-12, (xx + yy) * regularization);
    xx += ridge; yy += ridge;
    const determinant = xx * yy - xy * xy;
    if (determinant <= 1e-20) return {x: x + tx, y: y + ty};
    const bx = (uxx * yy - uxy * xy) / determinant, by = (uxy * xx - uxx * xy) / determinant;
    const cx = (uyx * yy - uyy * xy) / determinant, cy = (uyy * xx - uyx * xy) / determinant;
    return {x: x + tx - bx * mx - by * my, y: y + ty - cx * mx - cy * my};
  };
}

function metrics(points, targets, triangles) {
  let folded = 0, minimumAreaRatio = Infinity, maxAnisotropy = 1, maxDisplacement = 0;
  for (let i = 0; i < points.length; i++) maxDisplacement = Math.max(maxDisplacement, Math.hypot(targets[i].x - points[i].x, targets[i].y - points[i].y));
  for (const [a, b, c] of triangles) {
    const p = points[a], u = points[b], v = points[c], q = targets[a], s = targets[b], t = targets[c];
    const ux = u.x - p.x, uy = u.y - p.y, vx = v.x - p.x, vy = v.y - p.y;
    const sx = s.x - q.x, sy = s.y - q.y, tx = t.x - q.x, ty = t.y - q.y;
    const determinant = cross(ux, uy, vx, vy), ratio = cross(sx, sy, tx, ty) / determinant;
    if (ratio <= 0) folded++;
    minimumAreaRatio = Math.min(minimumAreaRatio, ratio);
    const j00 = (sx * vy - tx * uy) / determinant, j01 = (tx * ux - sx * vx) / determinant;
    const j10 = (sy * vy - ty * uy) / determinant, j11 = (ty * ux - sy * vx) / determinant;
    const trace = j00 * j00 + j01 * j01 + j10 * j10 + j11 * j11;
    const maximum = (trace + Math.sqrt(Math.max(0, trace * trace - 4 * ratio * ratio))) / 2;
    maxAnisotropy = Math.max(maxAnisotropy, Math.abs(ratio) > 1e-15 ? maximum / Math.abs(ratio) : Infinity);
  }
  return {folded, minimumAreaRatio, maxAnisotropy, maxDisplacement};
}

function safeScale(points, targets, triangles, minimumAreaRatio, originalAreas) {
  let limit = 1;
  for (let index = 0; index < triangles.length; index++) {
    const [a, b, c] = triangles[index];
    const p = points[a], u = points[b], v = points[c];
    const ux = u.x - p.x, uy = u.y - p.y, vx = v.x - p.x, vy = v.y - p.y;
    const ax = targets[a].x - p.x, ay = targets[a].y - p.y;
    const dux = targets[b].x - u.x - ax, duy = targets[b].y - u.y - ay;
    const dvx = targets[c].x - v.x - ax, dvy = targets[c].y - v.y - ay;
    const base = cross(ux, uy, vx, vy);
    const A = cross(dux, duy, dvx, dvy) / base;
    const B = (cross(dux, duy, vx, vy) + cross(ux, uy, dvx, dvy)) / base;
    // Every composition stage retains the configured fraction of the original area.
    const C = 1 - minimumAreaRatio * (originalAreas ? originalAreas[index] / base : 1);
    let roots = [];
    if (Math.abs(A) < 1e-12) {
      if (B < 0) roots = [-C / B];
    } else {
      const discriminant = B * B - 4 * A * C;
      if (discriminant >= 0) {
        const q = -.5 * (B + (B >= 0 ? 1 : -1) * Math.sqrt(discriminant));
        roots = q === 0 ? [-B / (2 * A)] : [q / A, C / q];
      }
    }
    for (const root of roots) if (root > 0 && root <= limit) limit = Math.max(0, root * (1 - 1e-6));
  }
  return limit;
}

function controlProgress(current, source, destination) {
  let remaining = 0, initial = 0, maximum = 0, weightSum = 0;
  for (let i = 0; i < current.length; i++) {
    const weight = source[i].weight ?? 1;
    if (weight === 0) continue;
    const error = Math.hypot(current[i].x - destination[i].x, current[i].y - destination[i].y);
    remaining += error * error * weight; maximum = Math.max(maximum, error); weightSum += weight;
    initial += ((source[i].x - destination[i].x) ** 2 + (source[i].y - destination[i].y) ** 2) * weight;
  }
  return {
    remainingControlRmsPx: Math.sqrt(remaining / Math.max(Number.MIN_VALUE, weightSum)),
    remainingControlMaxPx: maximum,
    achievedControlFraction: initial > 1e-12 ? clamp(1 - Math.sqrt(remaining / initial), 0, 1) : remaining < 1e-12 ? 1 : 0
  };
}

function meshControlProgress(source, destination, targets, xs, ys) {
  const evaluated = [], original = [], desired = [];
  const cell = (axis, value) => {
    let low = 0, high = axis.length - 1;
    while (high - low > 1) {const mid = (low + high) >> 1; if (axis[mid] <= value) low = mid; else high = mid;}
    return Math.min(low, axis.length - 2);
  };
  source.forEach((p, index) => {
    if ((p.weight ?? 1) === 0) return;
    if (p.x < 0 || p.x > xs.at(-1) || p.y < 0 || p.y > ys.at(-1)) return;
    const x = cell(xs, p.x), y = cell(ys, p.y), u = (p.x - xs[x]) / (xs[x + 1] - xs[x]), v = (p.y - ys[y]) / (ys[y + 1] - ys[y]);
    const a = y * xs.length + x, b = a + 1, c = a + xs.length, d = c + 1;
    let indices, weights;
    if ((x + y) % 2) {
      [indices, weights] = u + v <= 1 ? [[a, b, c], [1 - u - v, u, v]] : [[b, d, c], [1 - v, u + v - 1, 1 - u]];
    } else {
      [indices, weights] = v <= u ? [[a, b, d], [1 - u, u - v, v]] : [[a, d, c], [1 - v, u, v - u]];
    }
    evaluated.push({x: indices.reduce((sum, i, j) => sum + targets[i].x * weights[j], 0), y: indices.reduce((sum, i, j) => sum + targets[i].y * weights[j], 0)});
    original.push(p); desired.push(destination[index]);
  });
  const progress = controlProgress(evaluated, original, desired);
  return {meshControlCount: evaluated.length, meshControlRmsErrorPx: progress.remainingControlRmsPx, meshControlMaxErrorPx: progress.remainingControlMaxPx, meshAchievedControlFraction: progress.achievedControlFraction};
}

function composeStages(points, triangles, controls, source, destination, width, height, options) {
  let current = points.map(p => ({...p}));
  const tracked = source.map(p => ({...p}));
  const moving = controls.map(p => ({x: p.x, y: p.y, goalX: p.x + p.dx, goalY: p.y + p.dy, weight: p.weight ?? 1}));
  const originalAreas = triangles.map(([a, b, c]) => cross(points[b].x - points[a].x, points[b].y - points[a].y, points[c].x - points[a].x, points[c].y - points[a].y));
  const stages = []; let stoppedReason = 'stage-budget';
  for (let index = 0; index < options.incrementalStages; index++) {
    const requestedFraction = 1 / (options.incrementalStages - index);
    const stageControls = moving.map(p => ({x: p.x, y: p.y, dx: (p.goalX - p.x) * requestedFraction, dy: (p.goalY - p.y) * requestedFraction, weight: p.weight}));
    const sample = makeSampler(stageControls, width, height, options.fixedBorders, options.regularization, options.kernelRadius);
    const candidate = current.map(p => sample(p.x, p.y));
    const acceptedScale = options.preventFolds === false ? 1 : safeScale(current, candidate, triangles, options.minimumAreaRatio, originalAreas);
    if (acceptedScale < 1e-6) {stoppedReason = 'positive-area-limit'; break;}
    for (let i = 0; i < current.length; i++) {
      candidate[i].x = current[i].x + (candidate[i].x - current[i].x) * acceptedScale;
      candidate[i].y = current[i].y + (candidate[i].y - current[i].y) * acceptedScale;
    }
    // Transport controls through the same accepted field as mesh vertices, including border overrides.
    for (const collection of [moving, tracked]) for (const p of collection) {
      const q = sample(p.x, p.y);
      p.x += (q.x - p.x) * acceptedScale; p.y += (q.y - p.y) * acceptedScale;
    }
    current = candidate;
    const progress = controlProgress(tracked, source, destination);
    stages.push({stage: index + 1, requestedFraction, acceptedScale, ...progress});
    if (progress.remainingControlMaxPx < 1e-4) {stoppedReason = 'control-targets-reached'; break;}
  }
  return {targets: current, diagnostics: {stages: stages.length, requestedStages: options.incrementalStages, stageDiagnostics: stages, stoppedReason, minimumStageScale: stages.length ? Math.min(...stages.map(s => s.acceptedScale)) : 0, ...controlProgress(tracked, source, destination)}};
}

/**
 * Sample an affine moving-least-squares displacement field on a regular grid.
 * roi is {x, y, width, height}, in source pixels. Frame borders are fixed by default.
 * topologyScale below one means the requested shape was reduced to keep positive area.
 * incrementalStages (1..12) composes small fields; its progress is achievedControlFraction,
 * not a global topologyScale. meshControlMaxErrorPx includes grid interpolation error.
 * source[i].weight is a nonnegative confidence, default 1; zero weights are inactive.
 * kernelRadius is in the same coordinate units as source, default 0 (interpolating MLS).
 * Duplicate coordinates average displacement by confidence. Finite kernels sum their
 * confidence, matching the limit of nearby controls; zero-radius MLS keeps maximum confidence.
 */
export function buildSmoothField(source, destination, width, height, options = {}) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new RangeError('Positive finite frame dimensions required');
  if (!Array.isArray(source) || !Array.isArray(destination) || source.length !== destination.length) throw new TypeError('Control point arrays must have equal lengths');
  const fixedBorders = options.fixedBorders !== false;
  const regularization = options.regularization ?? 1e-6;
  const kernelRadius = options.kernelRadius ?? 0;
  const minimumAreaRatio = options.minimumAreaRatio ?? .025;
  const maxVertices = options.maxVertices ?? 10000;
  const incrementalStages = options.incrementalStages ?? 0;
  if (!Number.isInteger(incrementalStages) || incrementalStages < 0 || incrementalStages > 12) throw new RangeError('incrementalStages must be an integer from 0 to 12');
  let step = options.step ?? Math.min(width, height) / 64, coarseStep = options.coarseStep ?? step * 4;
  if (![step, coarseStep, regularization, kernelRadius, minimumAreaRatio, maxVertices].every(Number.isFinite) || step <= 0 || coarseStep <= 0 || regularization < 0 || kernelRadius < 0 || minimumAreaRatio <= 0 || minimumAreaRatio >= 1 || maxVertices < 16) throw new RangeError('Invalid grid or regularization options');
  const roi = options.roi ?? {x: 0, y: 0, width, height};
  if (![roi.x, roi.y, roi.width, roi.height].every(Number.isFinite) || roi.width < 0 || roi.height < 0) throw new RangeError('ROI must have finite nonnegative dimensions');
  const x0 = clamp(roi.x, 0, width), x1 = clamp(roi.x + roi.width, x0, width);
  const y0 = clamp(roi.y, 0, height), y1 = clamp(roi.y + roi.height, y0, height);
  const controlsByPosition = new Map();
  for (let i = 0; i < source.length; i++) {
    const p = source[i], q = destination[i];
    if (![p?.x, p?.y, q?.x, q?.y].every(Number.isFinite)) throw new TypeError('Control coordinates must be finite');
    const weight = p.weight ?? 1;
    if (!Number.isFinite(weight) || weight < 0) throw new RangeError('Control weights must be finite and nonnegative');
    if (weight === 0) continue;
    const key = `${p.x},${p.y}`, old = controlsByPosition.get(key);
    if (old) {old.dx += (q.x - p.x) * weight; old.dy += (q.y - p.y) * weight; old.weightSum += weight; old.weight = Math.max(old.weight, weight);}
    else controlsByPosition.set(key, {x: p.x, y: p.y, dx: (q.x - p.x) * weight, dy: (q.y - p.y) * weight, weightSum: weight, weight});
  }
  for (const control of controlsByPosition.values()) {
    control.dx /= control.weightSum; control.dy /= control.weightSum;
    if (kernelRadius > 0) control.weight = control.weightSum;
  }
  if (fixedBorders) {
    const boundaryStep = Math.max(coarseStep, Math.max(width, height) / 8);
    for (const [length, horizontal] of [[width, true], [height, false]]) {
      const count = Math.ceil(length / boundaryStep);
      for (let i = 0; i <= count; i++) for (const opposite of [false, true]) {
        const x = horizontal ? length * i / count : opposite ? width : 0;
        const y = horizontal ? opposite ? height : 0 : length * i / count;
        controlsByPosition.set(`${x},${y}`, {x, y, dx: 0, dy: 0, weight: 1});
      }
    }
  }
  const countAxis = (size, start, end, fine, coarse) => 1 + Math.ceil(start / coarse) + Math.ceil((end - start) / fine) + Math.ceil((size - end) / coarse);
  // Bound the grid before allocating even when a caller requests a tiny step.
  step = Math.max(step, Number.EPSILON * Math.max(width, height));
  coarseStep = Math.max(coarseStep, Number.EPSILON * Math.max(width, height));
  do {
    const vertices = countAxis(width, x0, x1, step, coarseStep) * countAxis(height, y0, y1, step, coarseStep);
    if (vertices <= maxVertices) break;
    const scale = Math.max(1.05, Math.sqrt(vertices / maxVertices));
    step *= scale; coarseStep *= scale;
  } while (true);
  const xs = axis(width, x0, x1, step, coarseStep), ys = axis(height, y0, y1, step, coarseStep);
  const sample = makeSampler([...controlsByPosition.values()], width, height, fixedBorders, regularization, kernelRadius);
  const points = [], targets = [], triangles = [];
  for (const y of ys) for (const x of xs) {points.push({x, y}); targets.push(sample(x, y));}
  for (let y = 0; y < ys.length - 1; y++) for (let x = 0; x < xs.length - 1; x++) {
    const a = y * xs.length + x, b = a + 1, c = a + xs.length, d = c + 1;
    if ((x + y) % 2) triangles.push([a, b, c], [b, d, c]);
    else triangles.push([a, b, d], [a, d, c]);
  }
  const raw = metrics(points, targets, triangles);
  if (incrementalStages) {
    const composition = composeStages(points, triangles, [...controlsByPosition.values()], source, destination, width, height, {fixedBorders, regularization, kernelRadius, minimumAreaRatio, incrementalStages, preventFolds: options.preventFolds});
    const final = metrics(points, composition.targets, triangles);
    return {points, targets: composition.targets, triangles, diagnostics: {
      method: 'affine-mls-incremental', vertices: points.length, triangles: triangles.length,
      controls: controlsByPosition.size, step, coarseStep, topologyScale: null,
      rawFolded: raw.folded, rawMinimumAreaRatio: raw.minimumAreaRatio, rawMaxAnisotropy: raw.maxAnisotropy,
      ...composition.diagnostics, ...meshControlProgress(source, destination, composition.targets, xs, ys), ...final
    }};
  }
  const topologyScale = options.preventFolds === false ? 1 : safeScale(points, targets, triangles, minimumAreaRatio);
  if (topologyScale < 1) for (let i = 0; i < targets.length; i++) {
    targets[i].x = points[i].x + (targets[i].x - points[i].x) * topologyScale;
    targets[i].y = points[i].y + (targets[i].y - points[i].y) * topologyScale;
  }
  const final = topologyScale === 1 ? raw : metrics(points, targets, triangles);
  return {points, targets, triangles, diagnostics: {
    method: 'affine-mls', vertices: points.length, triangles: triangles.length,
    controls: controlsByPosition.size, step, coarseStep, topologyScale,
    rawFolded: raw.folded, rawMinimumAreaRatio: raw.minimumAreaRatio, rawMaxAnisotropy: raw.maxAnisotropy,
    ...final
  }};
}
