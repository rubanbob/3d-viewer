import * as THREE from 'three';

export class VideoTurntableRecorder {
  constructor(app) {
    this.app = app;
    this.scene = app.scene;
    this.camera = app.camera;
    this.renderer = app.renderer;
    this.canvas = app.canvas;

    // Configuration
    this.aspectRatio = '1:1'; // '1:1', '16:9', '9:16', '4:3', 'free'
    this.resolution = 1080;
    this.duration = 10.0; // Max 10s
    this.loop360 = true;
    this.isFrameGuideVisible = false;

    // Recording State
    this.isRecording = false;
    this.recorder = null;
    this.recordedChunks = [];
    this.recordingStartTime = 0;
    this.recordingStartQuat = new THREE.Quaternion();
    this.recordingStartPos = new THREE.Vector3();
    this.priorAutoRotate = false;

    // Offscreen recording canvas
    this.recordCanvas = document.createElement('canvas');
    this.recordCtx = this.recordCanvas.getContext('2d', { alpha: false });

    // DOM Elements
    this.frameOverlay = document.getElementById('frame-overlay');
    this.frameBox = document.getElementById('frame-box');
    this.frameBadge = document.getElementById('frame-badge');
    this.maskTop = document.getElementById('mask-top');
    this.maskBottom = document.getElementById('mask-bottom');
    this.maskLeft = document.getElementById('mask-left');
    this.maskRight = document.getElementById('mask-right');

    this.recordingHud = document.getElementById('recording-hud');
    this.recTimerElem = document.getElementById('rec-timer');
    this.recProgressFill = document.getElementById('rec-progress-fill');

    // Bind resize
    this.updateFrameBounds = this.updateFrameBounds.bind(this);
    window.addEventListener('resize', this.updateFrameBounds);
  }

  setAspectRatio(ratio) {
    this.aspectRatio = ratio;
    this.updateFrameBounds();
  }

  setFrameGuideVisible(visible) {
    this.isFrameGuideVisible = visible;
    if (this.frameOverlay) {
      this.frameOverlay.style.display = visible ? 'block' : 'none';
      if (visible) this.updateFrameBounds();
    }
  }

  getAspectNumeric() {
    switch (this.aspectRatio) {
      case '1:1': return 1.0;
      case '16:9': return 16 / 9;
      case '9:16': return 9 / 16;
      case '4:3': return 4 / 3;
      case 'free':
      default:
        return window.innerWidth / window.innerHeight;
    }
  }

  getOutputDimensions() {
    const r = this.getAspectNumeric();
    const base = this.resolution; // e.g. 1080

    let outW, outH;
    if (this.aspectRatio === '1:1') {
      outW = base;
      outH = base;
    } else if (this.aspectRatio === '16:9') {
      outW = Math.round(base * (16 / 9));
      outH = base;
    } else if (this.aspectRatio === '9:16') {
      outW = base;
      outH = Math.round(base * (16 / 9));
    } else if (this.aspectRatio === '4:3') {
      outW = Math.round(base * (4 / 3));
      outH = base;
    } else {
      // Free viewport
      const vRatio = window.innerWidth / window.innerHeight;
      if (vRatio >= 1) {
        outH = base;
        outW = Math.round(base * vRatio);
      } else {
        outW = base;
        outH = Math.round(base / vRatio);
      }
    }

    // Ensure dimensions are even for video encoders
    outW = outW % 2 === 0 ? outW : outW + 1;
    outH = outH % 2 === 0 ? outH : outH + 1;
    return { width: outW, height: outH };
  }

  updateFrameBounds() {
    if (!this.isFrameGuideVisible && !this.isRecording) return;

    const W = window.innerWidth;
    const H = window.innerHeight;
    const r = this.getAspectNumeric();

    const margin = 40;
    const maxW = W - margin * 2;
    const maxH = H - margin * 2;

    let boxW, boxH;
    if (this.aspectRatio === 'free') {
      boxW = W;
      boxH = H;
    } else if (maxW / maxH > r) {
      boxH = maxH;
      boxW = boxH * r;
    } else {
      boxW = maxW;
      boxH = boxW / r;
    }

    const boxX = (W - boxW) / 2;
    const boxY = (H - boxH) / 2;

    this.frameRect = { x: boxX, y: boxY, width: boxW, height: boxH };

    if (this.frameBox) {
      this.frameBox.style.left = `${boxX}px`;
      this.frameBox.style.top = `${boxY}px`;
      this.frameBox.style.width = `${boxW}px`;
      this.frameBox.style.height = `${boxH}px`;
    }

    if (this.maskTop) {
      this.maskTop.style.height = `${Math.max(0, boxY)}px`;
    }
    if (this.maskBottom) {
      this.maskBottom.style.top = `${boxY + boxH}px`;
      this.maskBottom.style.height = `${Math.max(0, H - (boxY + boxH))}px`;
    }
    if (this.maskLeft) {
      this.maskLeft.style.top = `${boxY}px`;
      this.maskLeft.style.height = `${boxH}px`;
      this.maskLeft.style.width = `${Math.max(0, boxX)}px`;
    }
    if (this.maskRight) {
      this.maskRight.style.left = `${boxX + boxW}px`;
      this.maskRight.style.top = `${boxY}px`;
      this.maskRight.style.height = `${boxH}px`;
      this.maskRight.style.width = `${Math.max(0, W - (boxX + boxW))}px`;
    }

    const dims = this.getOutputDimensions();
    if (this.frameBadge) {
      this.frameBadge.textContent = `${this.aspectRatio} (${dims.width} × ${dims.height})`;
    }
    const labelDim = document.getElementById('label-frame-dim');
    if (labelDim) {
      labelDim.textContent = `${dims.width} × ${dims.height}`;
    }
  }

  fitModelToFrame() {
    if (!this.app.modelGroup || this.app.modelGroup.children.length === 0) return;

    this.updateFrameBounds();
    const box = new THREE.Box3().setFromObject(this.app.modelGroup);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);

    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim <= 0) return;

    const frame = this.frameRect || { width: window.innerWidth, height: window.innerHeight };
    const frameAspect = frame.width / frame.height;

    const fov = this.app.perspectiveCamera.fov * (Math.PI / 180);
    // Vertical distance needed to fit height
    let distH = (maxDim / 2) / Math.tan(fov / 2);
    // Horizontal distance needed to fit width inside frame aspect
    let distW = (maxDim / 2) / (Math.tan(fov / 2) * frameAspect);
    let cameraDistance = Math.max(distH, distW) * 1.45; // 45% padding for safe rotation

    const offset = new THREE.Vector3(1, 0.65, 1.2).normalize().multiplyScalar(cameraDistance);
    const targetPos = center.clone().add(offset);

    this.app.animateCameraTo(targetPos, center);
    this.app.showToast('Model fitted to frame');
  }

  startRecording() {
    if (this.isRecording) return;

    // Ensure frame bounds are calculated
    this.updateFrameBounds();
    const outDims = this.getOutputDimensions();

    this.recordCanvas.width = outDims.width;
    this.recordCanvas.height = outDims.height;

    // Detect supported recording mimeType
    const mimeCandidates = [
      'video/mp4;codecs=avc1',
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm'
    ];
    let selectedMime = mimeCandidates.find(type => {
      try {
        return MediaRecorder.isTypeSupported(type);
      } catch (e) {
        return false;
      }
    }) || 'video/webm';

    this.recordedChunks = [];
    const stream = this.recordCanvas.captureStream(60);

    try {
      this.recorder = new MediaRecorder(stream, {
        mimeType: selectedMime,
        videoBitsPerSecond: 10000000 // 10 Mbps for crisp 3D capture
      });
    } catch (e) {
      console.warn('High bitrate rejected, falling back to default:', e);
      this.recorder = new MediaRecorder(stream);
      selectedMime = this.recorder.mimeType || 'video/webm';
    }

    this.recordedMime = selectedMime;

    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        this.recordedChunks.push(e.data);
      }
    };

    this.recorder.onstop = () => {
      this.finalizeRecording();
    };

    // Pause normal turntable if active, we handle rotation deterministically
    this.priorAutoRotate = this.app.autoRotate;
    this.app.autoRotate = false;
    const turntableBtn = document.getElementById('btn-turntable');
    if (turntableBtn) turntableBtn.classList.toggle('active', false);

    // Store starting orientation
    this.recordingStartQuat.copy(this.app.modelGroup.quaternion);
    this.recordingStartPos.copy(this.app.modelGroup.position);

    // Close configuration modal if open
    const modal = document.getElementById('modal-video-record');
    if (modal) modal.classList.remove('show');

    // Show HUD
    this.isRecording = true;
    this.recordingStartTime = performance.now();
    this.recordingLastFrameTime = this.recordingStartTime;
    this.totalRotated = 0;

    if (this.recordingHud) {
      this.recordingHud.style.display = 'flex';
      this.updateHud(0);
    }

    this.recorder.start(100);
    this.app.showToast('Recording turntable video...');
  }

  stopRecording() {
    if (!this.isRecording) return;
    this.isRecording = false;

    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.stop();
    }

    if (this.recordingHud) {
      this.recordingHud.style.display = 'none';
    }

    // Restore prior turntable state
    this.app.autoRotate = this.priorAutoRotate;
    const turntableBtn = document.getElementById('btn-turntable');
    if (turntableBtn) turntableBtn.classList.toggle('active', this.app.autoRotate);
  }

  update(time) {
    if (!this.isRecording) return;

    const elapsedMs = time - this.recordingStartTime;
    const elapsedSec = elapsedMs / 1000.0;
    const progress = Math.min(1.0, elapsedSec / this.duration);

    // Rotate model deterministically around ground axis
    const deltaMs = time - this.recordingLastFrameTime;
    this.recordingLastFrameTime = time;

    if (this.loop360) {
      // Complete exactly 360 degrees (2 * PI) over duration
      const targetTotalAngle = progress * Math.PI * 2;
      const angleStep = targetTotalAngle - this.totalRotated;
      this.totalRotated = targetTotalAngle;
      if (Math.abs(angleStep) > 0) {
        this.app.rotateModelAroundGround(angleStep);
      }
    } else {
      // Smooth standard rotation
      const speed = 0.015;
      this.app.rotateModelAroundGround(speed * (deltaMs / 16.67));
    }

    // Render 3D scene to ensure latest frame is drawn
    this.renderer.render(this.scene, this.camera);

    // Crop from WebGL canvas into offscreen record canvas
    this.captureCurrentFrame();

    // Update HUD display
    this.updateHud(elapsedSec);

    // Auto-stop when duration reached
    if (elapsedSec >= this.duration) {
      this.stopRecording();
    }
  }

  captureCurrentFrame() {
    const webglCanvas = this.canvas;
    const pixelRatio = this.renderer.getPixelRatio();

    let sx = 0, sy = 0, sw = webglCanvas.width, sh = webglCanvas.height;

    if (this.aspectRatio !== 'free' && this.frameRect) {
      sx = Math.round(this.frameRect.x * pixelRatio);
      sy = Math.round(this.frameRect.y * pixelRatio);
      sw = Math.round(this.frameRect.width * pixelRatio);
      sh = Math.round(this.frameRect.height * pixelRatio);

      // Clamp inside canvas bounds
      sx = Math.max(0, Math.min(webglCanvas.width - 1, sx));
      sy = Math.max(0, Math.min(webglCanvas.height - 1, sy));
      sw = Math.max(1, Math.min(webglCanvas.width - sx, sw));
      sh = Math.max(1, Math.min(webglCanvas.height - sy, sh));
    }

    // If in 2D backdrop mode, composite background image with opacity under the WebGL canvas
    if (this.app.currentBgType === 'custom-image' && this.app.customBgMode === 'backdrop') {
      this.recordCtx.fillStyle = '#0d0f14';
      this.recordCtx.fillRect(0, 0, this.recordCanvas.width, this.recordCanvas.height);

      const img = this.app.customBgImg;
      if (img && img.complete && img.naturalWidth > 0) {
        const hRatio = webglCanvas.width / img.width;
        const vRatio = webglCanvas.height / img.height;
        const ratio = Math.max(hRatio, vRatio);
        const centerShift_x = (webglCanvas.width - img.width * ratio) / 2;
        const centerShift_y = (webglCanvas.height - img.height * ratio) / 2;

        const scaleX = this.recordCanvas.width / sw;
        const scaleY = this.recordCanvas.height / sh;

        this.recordCtx.save();
        this.recordCtx.globalAlpha = this.app.customBgOpacity;
        this.recordCtx.drawImage(
          img,
          (centerShift_x - sx) * scaleX,
          (centerShift_y - sy) * scaleY,
          img.width * ratio * scaleX,
          img.height * ratio * scaleY
        );
        this.recordCtx.restore();
      }
    }

    // Draw slice from WebGL canvas to recording canvas
    this.recordCtx.drawImage(
      webglCanvas,
      sx, sy, sw, sh,
      0, 0, this.recordCanvas.width, this.recordCanvas.height
    );
  }

  updateHud(elapsedSec) {
    if (this.recTimerElem) {
      const cur = Math.min(this.duration, elapsedSec).toFixed(1);
      const tot = this.duration.toFixed(1);
      this.recTimerElem.textContent = `${cur}s / ${tot}s`;
    }
    if (this.recProgressFill) {
      const pct = Math.min(100, (elapsedSec / this.duration) * 100);
      this.recProgressFill.style.width = `${pct}%`;
    }
  }

  finalizeRecording() {
    if (this.recordedChunks.length === 0) {
      this.app.showToast('No video data recorded.');
      return;
    }

    const mime = this.recordedMime || 'video/webm';
    const blob = new Blob(this.recordedChunks, { type: mime });
    const ext = mime.includes('mp4') ? 'mp4' : 'webm';

    const baseName = this.app.currentModelName.replace(/\.[^/.]+$/, "");
    const safeAspect = this.aspectRatio.replace(':', 'x');
    const filename = `B08_${baseName}_turntable_${safeAspect}_${this.duration}s.${ext}`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => URL.revokeObjectURL(url), 2000);

    const sizeMB = (blob.size / (1024 * 1024)).toFixed(2);
    this.app.showToast(`Video saved: ${filename} (${sizeMB} MB)`);
  }
}
