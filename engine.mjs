import { createPullController } from './pull.mjs';
import { drawPull2d, resetPull2d } from './pull-2d.mjs';
import { warmMesh } from './mesh2d.mjs';
import { handContact, drawHandsMask } from './hands.mjs';

const byX = (a, b) => a.x - b.x;
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export function faceFromLandmarks(points, project) {
  const [leftEye, rightEye] = [
    midpoint(project(points[33]), project(points[133])),
    midpoint(project(points[263]), project(points[362]))
  ].sort(byX);
  const jawLeft = project(points[234]);
  const jawRight = project(points[454]);
  const mouth = midpoint(project(points[13]), project(points[14]));
  const chin = project(points[152]);
  const nose = project(points[1]);
  return {
    landmarks: points.map(project),
    outline: [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109].map(i=>project(points[i])),
    forehead: project(points[10]),
    faceCenter: midpoint(midpoint(leftEye, rightEye), mouth),
    lowerFace: midpoint(nose, chin),
    eyes: [leftEye, rightEye],
    cheeks: [
      midpoint(project(points[205]), project(points[207])),
      midpoint(project(points[425]), project(points[427]))
    ],
    mouth,
    corners: [project(points[61]), project(points[291])],
    lips: [project(points[13]), project(points[14])],
    chin,
    width: Math.hypot(jawRight.x - jawLeft.x, jawRight.y - jawLeft.y),
    roll: Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x)
  };
}

function strengthAt(frames, ms) {
  const next = frames.findIndex(([time]) => time >= ms);
  if (next <= 0) return frames[next === 0 ? 0 : frames.length - 1][1];
  const [start, a] = frames[next - 1];
  const [end, b] = frames[next];
  const t = (ms - start) / (end - start);
  return a + (b - a) * t * t * (3 - 2 * t);
}

function warpRegion(output, scratch, point, face, region, strength, handMask, maskPatch) {
  const width = Math.max(4, Math.round(face.width * region.width));
  const height = Math.max(4, Math.round(face.width * region.height));
  const rx = width / 2;
  const ry = height / 2;
  const { canvas } = scratch;
  const shiftY = (region.offsetY ?? 0) * face.width * strength;
  const stretchX = Math.min(0.95, region.stretchX * strength);
  const stretchY = Math.min(0.95, region.stretchY * strength);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  scratch.setTransform(1, 0, 0, 1, 0, 0);
  scratch.clearRect(0, 0, width, height);
  scratch.translate(rx, ry);
  scratch.rotate(-face.roll);
  scratch.drawImage(output.canvas, -point.x, -point.y);
  const input = scratch.getImageData(0, 0, width, height).data;
  const patch = scratch.createImageData(width, height);
  let handPixels;
  if (handMask) {
    maskPatch.canvas.width = width;
    maskPatch.canvas.height = height;
    maskPatch.translate(rx, ry);
    maskPatch.rotate(-face.roll);
    maskPatch.drawImage(handMask, -point.x, -point.y);
    handPixels = maskPatch.getImageData(0, 0, width, height).data;
  }

  for (let y = 0; y < height; y++) {
    const dy = y + 0.5 - ry;
    for (let x = 0; x < width; x++) {
      const dx = x + 0.5 - rx;
      const radiusSquared = (dx / rx) ** 2 + (dy / ry) ** 2;
      if (radiusSquared >= 1) continue;
      const falloff = (1 - radiusSquared) ** 2;
      const sx = Math.min(width - 1, Math.max(0, x - dx * stretchX * falloff));
      const sy = Math.min(height - 1, Math.max(0, y - (dy * stretchY + shiftY) * falloff));
      const ix = Math.floor(sx);
      const iy = Math.floor(sy);
      const u = sx - ix;
      const v = sy - iy;
      const right = Math.min(width - 1, ix + 1);
      const below = Math.min(height - 1, iy + 1);
      const target = (y * width + x) * 4;
      let opacity = Math.min(1, (1 - radiusSquared) * 12);
      if (handPixels) {
        const sample = (Math.round(sy) * width + Math.round(sx)) * 4;
        const middle = (Math.round((y + sy) / 2) * width + Math.round((x + sx) / 2)) * 4;
        const coverage = Math.max(handPixels[sample + 3], handPixels[target + 3], handPixels[middle + 3]);
        opacity *= 1 - Math.min(1, coverage / 128);
        if (opacity < 0.005) continue;
      }
      for (let channel = 0; channel < 4; channel++) {
        const top = input[(iy * width + ix) * 4 + channel] * (1 - u) + input[(iy * width + right) * 4 + channel] * u;
        const bottom = input[(below * width + ix) * 4 + channel] * (1 - u) + input[(below * width + right) * 4 + channel] * u;
        patch.data[target + channel] = top * (1 - v) + bottom * v;
      }
      patch.data[target + 3] *= opacity;
    }
  }

  scratch.putImageData(patch, 0, 0);
  output.save();
  output.translate(point.x, point.y);
  output.rotate(face.roll);
  output.drawImage(canvas, -rx, -ry);
  output.restore();
}

export function createEffectRenderer(canvas, manifest) {
  const output = canvas.getContext('2d');
  const scratch = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const foreground = document.createElement('canvas').getContext('2d');
  const maskPatch = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const templates = new Map(manifest.templates.map(template => [template.id, template]));
  let active;

  return {
    trigger(id, now = performance.now()) {
      const template = templates.get(id);
      if (!template) return false;
      resetPull2d(canvas);
      active = { template, started: now, pull: id === 'stretch-smile' ? createPullController() : null };
      return true;
    },
    stop() { active = undefined; resetPull2d(canvas); },
    isPlaying(now = performance.now()) {
      return Boolean(active && (active.pull || now - active.started < active.template.durationMs));
    },
    draw(source, face, now = performance.now(), hands = []) {
      output.clearRect(0, 0, canvas.width, canvas.height);
      output.drawImage(source, 0, 0, canvas.width, canvas.height);
      if (face?.landmarks) warmMesh(output, source);
      if (!active) return null;
      if (active.pull) {
        const status = active.pull.update(face, hands, now);
        if (status.state === 'done') { active = undefined; resetPull2d(canvas); return null; }
        if (!face) resetPull2d(canvas);
        if (face) {
          drawPull2d(output, source, {face, hands, status, timestamp: now});
        }
        return { id: active.template.id, ms: Math.max(...(status.shapeAmount ?? status.amount))*2000, durationMs: 2000, state: status.state };
      }
      const { template, started } = active;
      const ms = Math.max(0, now - started);
      if (ms >= template.durationMs) {
        active = undefined;
        return null;
      }
      if (face && face.width >= 24) {
        const base = strengthAt(template.motion, ms);
        const contact = handContact(face, hands, template.contact, base);
        const handMask = hands.length ? drawHandsMask(foreground, canvas.width, canvas.height, hands) : null;
        for (const region of template.regions) {
          const strength = (region.motion ? strengthAt(region.motion, ms) : base) * (1 + contact * 0.22);
          if (Math.abs(strength) < 0.005) continue;
          const points = face[region.anchor];
          if (!points) continue;
          for (const point of Array.isArray(points) ? points : [points]) {
            warpRegion(output, scratch, point, face, region, strength, handMask, maskPatch);
          }
        }
      }
      return { id: template.id, ms, durationMs: template.durationMs };
    }
  };
}
