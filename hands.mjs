const fingers = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
const palm = [0, 1, 5, 9, 13, 17];

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (n, low, high) => Math.min(high, Math.max(low, n));

export function handContact(face, hands, mode, base) {
  if (!hands.length || !mode) return 0;
  const targets = mode === 'press-pull' ? (base < 0 ? 'press' : 'pull') : mode;
  const cos = Math.cos(face.roll);
  const sin = Math.sin(face.roll);
  const cues = targets === 'press' ? [8, 9, 12] : targets === 'lift' ? [4, 8] : [8];
  const anchor = targets === 'press' || targets === 'lift' ? face.forehead : face.mouth;
  if (!anchor) return 0;
  let response = 0;
  for (const hand of hands) {
    for (const index of cues) {
      const dx = hand[index].x - anchor.x;
      const dy = hand[index].y - anchor.y;
      const x = Math.abs(dx * cos + dy * sin) / face.width;
      const y = (dy * cos - dx * sin) / face.width;
      if (targets === 'press' || targets === 'lift') {
        if (x > 0.74 || y > 0.2 || y < -0.72) continue;
        response = Math.max(response, 1 - Math.abs(y + 0.17) / 0.55);
      } else {
        const expected = targets === 'claw' ? 0.69 : 0.43;
        const proximity = 1 - Math.hypot((x - expected) / 0.48, y / 0.32);
        response = Math.max(response, proximity);
      }
    }
  }
  return clamp(response, 0, 1);
}

function drawHandMask(ctx, hand) {
  const palmWidth = distance(hand[5], hand[17]);
  if (palmWidth < 3) return;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, palmWidth * 0.29);
  ctx.beginPath();
  for (const index of palm) ctx.lineTo(hand[index].x, hand[index].y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  for (const [fingerIndex, finger] of fingers.entries()) {
    for (let i = 0; i < finger.length - 1; i++) {
      const start = hand[finger[i]];
      const end = hand[finger[i + 1]];
      const ratio = (fingerIndex === 0 ? 0.36 : 0.34) - i * 0.020;
      ctx.lineWidth = Math.max(2, palmWidth * ratio);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }
  }
}

export function drawHandsMask(layer, width, height, hands) {
  if (layer.canvas.width !== width || layer.canvas.height !== height) {
    layer.canvas.width = width;
    layer.canvas.height = height;
  }
  layer.clearRect(0, 0, width, height);
  layer.save();
  layer.filter = 'blur(3px)';
  for (const hand of hands) drawHandMask(layer, hand);
  layer.restore();
  return layer.canvas;
}
