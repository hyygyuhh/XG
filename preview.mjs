import { createEffectRenderer, faceFromLandmarks } from './engine.mjs';

const byId = id => document.getElementById(id);
const canvas = byId('output');
const video = byId('video');
const status = byId('status');
const camera = byId('camera');
const photo = byId('photo');
const progress = byId('progress');
const sourceCanvas = document.createElement('canvas');
sourceCanvas.width = canvas.width;
sourceCanvas.height = canvas.height;
const ctx = sourceCanvas.getContext('2d');
const manifest = await fetch('./templates.json').then(response => {
  if (!response.ok) throw new Error('无法读取模板');
  return response.json();
});
const renderer = createEffectRenderer(canvas, manifest);
const illustration = new Image();
illustration.src = './portrait.svg';
await illustration.decode();
const illustrationFace = {
  forehead: { x: 320, y: 148 },
  faceCenter: { x: 320, y: 261 },
  lowerFace: { x: 320, y: 312 },
  eyes: [{ x: 265, y: 223 }, { x: 375, y: 223 }],
  cheeks: [{ x: 246, y: 265 }, { x: 394, y: 265 }],
  mouth: { x: 320, y: 298 },
  width: 213,
  roll: 0
};

let mode = 'demo';
let stream;
let face;
let detector;
let detectorMode;
let detectorBackend;
let preferredBackend = 'GPU';
let handDetector;
let hands = [];
let lastFrameAt = -Infinity;
let lastVideoTime = -1;
let lastTrackAt = -Infinity;
let lastNewFrameWallTime = -Infinity;
let lastObservedVideoTime = -1;
let cameraFrameCallback;
let cameraStalled = false;

function setStatus(message) {
  if (status.textContent !== message) status.textContent = message;
}

function stopCamera() {
  if (cameraFrameCallback !== undefined) video.cancelVideoFrameCallback?.(cameraFrameCallback);
  cameraFrameCallback = undefined;
  lastNewFrameWallTime = -Infinity;
  lastObservedVideoTime = -1;
  cameraStalled = false;
  stream?.getTracks().forEach(track => track.stop());
  stream = undefined;
  video.srcObject = null;
  lastVideoTime = -1;
  lastTrackAt = -Infinity;
  lastFrameAt = -Infinity;
  hands = [];
  camera.textContent = '开启摄像头';
}

function drawSource(media, width, height, mirror = false) {
  const scale = Math.min(canvas.width / width, canvas.height / height);
  const w = width * scale;
  const h = height * scale;
  const x = (canvas.width - w) / 2;
  const y = (canvas.height - h) / 2;
  ctx.fillStyle = '#151320';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  if (mirror) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(media, x, y, w, h);
  ctx.restore();
  return point => ({ x: x + (mirror ? 1 - point.x : point.x) * w, y: y + point.y * h });
}

function showDemo() {
  stopCamera();
  renderer.stop();
  mode = 'demo';
  face = illustrationFace;
  drawSource(illustration, 640, 480);
  byId('source').textContent = '内置插画';
  setStatus('开启摄像头后可体验双手拉嘴');
}

function closeDetectors() {
  for (const model of [detector, handDetector]) {
    try { model?.close(); } catch {}
  }
  detector = handDetector = undefined;
  detectorMode = detectorBackend = undefined;
}

async function setupDetector(nextMode, forceCPU = false) {
  if (forceCPU) {
    preferredBackend = 'CPU';
    closeDetectors();
  }
  try {
    if (!detector || !handDetector) {
      const { FaceLandmarker, HandLandmarker, FilesetResolver } = await import('./vendor/vision_bundle.mjs');
      const files = await FilesetResolver.forVisionTasks('./vendor/wasm');
      const delegate = preferredBackend;
      let nextFace, nextHands;
      try {
        nextFace = await FaceLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: './vendor/face_landmarker.task', delegate },
          runningMode: nextMode,
          numFaces: 1
        });
        nextHands = await HandLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: './vendor/hand_landmarker.task', delegate },
          runningMode: nextMode,
          numHands: 2
        });
      } catch (error) {
        for (const model of [nextFace, nextHands]) {
          try { model?.close(); } catch {}
        }
        throw error;
      }
      detector = nextFace;
      handDetector = nextHands;
      detectorMode = nextMode;
      detectorBackend = delegate;
    } else if (detectorMode !== nextMode) {
      await detector.setOptions({ runningMode: nextMode });
      await handDetector.setOptions({ runningMode: nextMode });
      detectorMode = nextMode;
    }
  } catch (error) {
    const failedBackend = detectorBackend ?? preferredBackend;
    closeDetectors();
    if (failedBackend !== 'GPU') throw error;
    await setupDetector(nextMode, true);
  }
}

async function detectWithFallback(nextMode, action) {
  await setupDetector(nextMode);
  try { return action(); }
  catch (error) {
    if (detectorBackend !== 'GPU') {
      closeDetectors();
      throw error;
    }
    await setupDetector(nextMode, true);
    try { return action(); }
    catch (retryError) { closeDetectors(); throw retryError; }
  }
}

function startCameraFrameMonitor() {
  if (cameraFrameCallback !== undefined) video.cancelVideoFrameCallback?.(cameraFrameCallback);
  cameraFrameCallback = undefined;
  lastNewFrameWallTime = performance.now();
  lastObservedVideoTime = video.currentTime;
  cameraStalled = false;
  if (!video.requestVideoFrameCallback) return;
  const trackedStream = stream;
  const onFrame = () => {
    if (video.srcObject !== trackedStream) return;
    lastNewFrameWallTime = performance.now();
    cameraFrameCallback = video.requestVideoFrameCallback(onFrame);
  };
  cameraFrameCallback = video.requestVideoFrameCallback(onFrame);
}

async function warmCamera() {
  const frame = await detectWithFallback('VIDEO', () => {
    const videoTime = video.currentTime;
    drawSource(video, video.videoWidth, video.videoHeight, true);
    const warmTimestamp = performance.now();
    const project = point => ({ x: point.x * sourceCanvas.width, y: point.y * sourceCanvas.height });
    const nextFace = trackedFace(detector.detectForVideo(sourceCanvas, warmTimestamp), project);
    const nextHands = trackedHands(handDetector.detectForVideo(sourceCanvas, warmTimestamp), project);
    return { nextFace, nextHands, videoTime, warmTimestamp };
  });
  face = frame.nextFace;
  hands = frame.nextHands;
  lastVideoTime = frame.videoTime;
  lastTrackAt = lastFrameAt = frame.warmTimestamp;
  startCameraFrameMonitor();
}

async function recoverCameraTracking(error) {
  renderer.stop();
  face = null;
  hands = [];
  if (detectorBackend !== 'GPU') {
    closeDetectors();
    console.error(error);
    showDemo();
    setStatus('人脸追踪中断，已返回插画预览');
    return;
  }
  await withInputLoading('正在恢复人脸和手部跟踪…', async () => {
    await setupDetector('VIDEO', true);
    if (mode !== 'camera' || !stream) return;
    await warmCamera();
    setStatus(face ? '已跟踪人脸，可点选动作' : '等待人脸进入画面');
  });
}

function trackedHands(result, project) {
  return result.landmarks.map(hand => hand.map(project));
}

function trackedFace(result, project) {
  const points = result.faceLandmarks[0];
  return points ? faceFromLandmarks(points, project) : null;
}

async function withInputLoading(label, action) {
  camera.disabled = photo.disabled = byId('demo').disabled = true;
  status.classList.add('loading');
  setStatus(label);
  try {
    await action();
  } catch (error) {
    console.error(error);
    showDemo();
    const cameraErrors = { NotAllowedError: '摄像头权限未开启', NotFoundError: '找不到可用摄像头', NotReadableError: '摄像头暂不可用' };
    setStatus(cameraErrors[error.name] || '输入加载失败，已返回插画预览');
  } finally {
    status.classList.remove('loading');
    camera.disabled = photo.disabled = byId('demo').disabled = false;
  }
}

camera.addEventListener('click', () => {
  if (mode === 'camera') {
    showDemo();
    return;
  }
  void withInputLoading('正在加载摄像头和跟踪模型…', async () => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('摄像头需要 HTTPS 或 localhost');
    await setupDetector('VIDEO');
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false
    });
    video.srcObject = stream;
    await video.play();
    await warmCamera();
    mode = 'camera';
    renderer.stop();
    byId('source').textContent = '摄像头';
    camera.textContent = '关闭摄像头';
    setStatus('正在识别人脸');
  });
});

photo.addEventListener('change', () => {
  const file = photo.files[0];
  if (!file) return;
  photo.value = '';
  void withInputLoading('正在识别照片…', async () => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    try {
      image.src = objectUrl;
      await image.decode();
      stopCamera();
      renderer.stop();
      mode = 'photo';
      face = null;
      await setupDetector('IMAGE');
      const project = drawSource(image, image.naturalWidth, image.naturalHeight);
      const tracked = await detectWithFallback('IMAGE', () => {
        const nextFace = trackedFace(detector.detect(image), project);
        const nextHands = nextFace ? trackedHands(handDetector.detect(image), project) : [];
        return { nextFace, nextHands };
      });
      face = tracked.nextFace;
      hands = tracked.nextHands;
      byId('source').textContent = '人物照片';
      setStatus(face ? '已定位人脸，可点选动作' : '未找到人脸，请换一张清晰的单人照');
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  });
});

byId('demo').addEventListener('click', showDemo);
window.addEventListener('pagehide', showDemo);

const buttons = manifest.templates.map((template, index) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'effect';
  button.dataset.id = template.id;
  button.style.setProperty('--tint', template.color);
  button.setAttribute('aria-pressed', 'false');
  button.innerHTML = '<span class="number"></span><span><b></b><small></small></span><span class="time"></span>';
  button.querySelector('.number').textContent = String(index + 1).padStart(2, '0');
  button.querySelector('b').textContent = template.name;
  button.querySelector('small').textContent = template.description;
  button.querySelector('.time').textContent = template.id === 'stretch-smile' ? '跟随动作' : (template.durationMs / 1000).toFixed(1) + ' 秒';
  button.addEventListener('click', () => {
    if (camera.disabled || !face || (template.id === 'stretch-smile' && mode !== 'camera')) return;
    renderer.trigger(template.id);
  });
  byId('actions').append(button);
  return button;
});

function updateCamera(now, playing) {
  const wallNow = performance.now();
  const videoTime = video.currentTime;
  if (!video.requestVideoFrameCallback && video.readyState >= 2 && videoTime !== lastObservedVideoTime) {
    lastObservedVideoTime = videoTime;
    lastNewFrameWallTime = wallNow;
  }
  if (wallNow - lastNewFrameWallTime > 500) {
    if (!cameraStalled) {
      cameraStalled = true;
      renderer.stop();
      face = null;
      hands = [];
      lastFrameAt = -Infinity;
      setStatus('摄像头画面中断，等待输入恢复');
    }
    return;
  }
  if (video.readyState < 2 || videoTime === lastVideoTime) return;
  if (now - lastTrackAt < (playing ? 25 : 50)) return;
  drawSource(video, video.videoWidth, video.videoHeight, true);
  const sampleAt = performance.now();
  lastTrackAt = now;
  lastVideoTime = videoTime;
  lastFrameAt = sampleAt;
  try {
    const project = point => ({ x: point.x * sourceCanvas.width, y: point.y * sourceCanvas.height });
    face = trackedFace(detector.detectForVideo(sourceCanvas, sampleAt), project);
    if (face && playing) {
      hands = trackedHands(handDetector.detectForVideo(sourceCanvas, sampleAt), project);
    } else {
      hands = [];
    }
    cameraStalled = false;
    setStatus(face ? '已跟踪人脸，可点选动作' : '等待人脸进入画面');
  } catch (error) {
    void recoverCameraTracking(error);
  }
}

function render(now) {
  const playing = renderer.isPlaying(now);
  if (mode === 'camera' && !camera.disabled) updateCamera(now, playing);
  const frameTime = mode === 'camera' && playing && Number.isFinite(lastFrameAt) ? lastFrameAt : now;
  let active;
  try { active = renderer.draw(sourceCanvas, face, frameTime, hands); }
  catch(error) { renderer.stop(); setStatus(error.message || '特效渲染失败'); console.error(error); }
  if (active?.state) setStatus(({waiting:'等待双手接触嘴角',contact:'已接触，向两侧拉动',pulling:'跟随拉嘴动作',release:'松手恢复'})[active.state]);
  progress.max = active?.durationMs ?? 2000;
  progress.value = active?.ms ?? 0;
  for (const button of buttons) {
    button.disabled = camera.disabled || !face || (button.dataset.id === 'stretch-smile' && mode !== 'camera');
    const playing = String(button.dataset.id === active?.id);
    if (button.getAttribute('aria-pressed') !== playing) button.setAttribute('aria-pressed', playing);
  }
  requestAnimationFrame(render);
}

showDemo();
requestAnimationFrame(render);
