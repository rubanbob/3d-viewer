import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

import { analyzeModel, calculateEstimatedWeight, MATERIAL_DENSITIES } from './analysis.js';
import { MaterialManager, COLOR_PRESETS } from './materials.js';
import { FaceGroundTool } from './faceGround.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { VideoTurntableRecorder } from './videoRecorder.js';

class B08App {
  constructor() {
    this.currentModelName = 'Stanford_Bunny_sample.stl';
    this.currentAnalysis = null;
    this.currentUnit = 'mm'; // 'mm', 'cm', 'in'
    this.autoRotate = false;
    this.isOrtho = false;
    this.shadingEnabled = true;
    this.shadowsEnabled = true;

    // Background & Environment Image State
    this.customBgTexture = null;
    this.customBgDataUrl = null;
    this.customBgMode = '360'; // '360' or 'backdrop'
    this.customBgEnvLighting = true;
    this.customBgBlur = 0.0;
    this.customBgIntensity = 1.0;
    this.currentBgType = 'studio';
    this.textureLoader = new THREE.TextureLoader();

    // Viewport & Three.js setup
    this.canvas = document.getElementById('webgl-canvas');
    this.container = document.getElementById('viewport-container');

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    const aspect = window.innerWidth / window.innerHeight;
    this.perspectiveCamera = new THREE.PerspectiveCamera(45, aspect, 0.1, 5000);
    this.perspectiveCamera.position.set(120, 90, 150);

    const frustumSize = 200;
    this.orthographicCamera = new THREE.OrthographicCamera(
      (frustumSize * aspect) / -2,
      (frustumSize * aspect) / 2,
      frustumSize / 2,
      frustumSize / -2,
      0.1,
      5000
    );
    this.orthographicCamera.position.copy(this.perspectiveCamera.position);

    this.camera = this.perspectiveCamera;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      preserveDrawingBuffer: true,
      alpha: true
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    // Controls
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.target.set(0, 0, 0);
    this.controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN
    };

    // Lights
    this.setupLighting();

    // Environment: Grid & Shadow Receiver
    this.setupEnvironment();

    // Model group
    this.modelGroup = new THREE.Group();
    this.modelGroup.name = 'CurrentModelGroup';
    this.scene.add(this.modelGroup);

    // Tools & Managers
    this.materialManager = new MaterialManager();
    this.faceGroundTool = new FaceGroundTool(
      this.scene,
      this.camera,
      this.canvas,
      () => this.modelGroup,
      (res) => {
        const btnCenter = document.getElementById('btn-tool-center');
        if (btnCenter) btnCenter.classList.remove('active');
        if (!res.cancelled) {
          this.runAnalysis();
          this.showToast('Model grounded to selected face & centered!');
        }
      }
    );

    // Setup Loaders
    this.stlLoader = new STLLoader();
    this.objLoader = new OBJLoader();
    this.mtlLoader = new MTLLoader();
    this.gltfLoader = new GLTFLoader();
    this.plyLoader = new PLYLoader();
    this.threeMfLoader = new ThreeMFLoader();
    this.fbxLoader = new FBXLoader();

    // Exporters
    this.stlExporter = new STLExporter();
    this.objExporter = new OBJExporter();
    this.gltfExporter = new GLTFExporter();

    // Video Turntable Recorder & Framing Tool
    this.videoRecorder = new VideoTurntableRecorder(this);

    // Performance FPS Counter
    this.fpsFrames = 0;
    this.fpsLastTime = performance.now();
    this.fpsDisplay = document.getElementById('fps-display');

    // Camera animation state
    this.animatingCamera = false;
    this.camStartPos = new THREE.Vector3();
    this.camTargetPos = new THREE.Vector3();
    this.camStartLook = new THREE.Vector3();
    this.camTargetLook = new THREE.Vector3();
    this.camAnimStartTime = 0;
    this.camAnimDuration = 600;

    // Bind UI & Events
    this.initUI();
    this.setupEventListeners();

    // Start render loop
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);

    // Load initial bundled Stanford Bunny model
    this.loadSample('bunny');
  }

  setupLighting() {
    // Generate default PBR studio environment for realistic materials and textures
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    pmremGenerator.compileEquirectangularShader();
    this.defaultEnvironment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.defaultEnvironment;

    this.hemiLight = new THREE.HemisphereLight(0xffffff, 0x334155, 0.9);
    this.scene.add(this.hemiLight);

    // Standard 3-point key light (used in navy, black, white, custom modes)
    this.dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    this.dirLight.position.set(150, 200, 150);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 2048;
    this.dirLight.shadow.mapSize.height = 2048;
    this.dirLight.shadow.camera.near = 10;
    this.dirLight.shadow.camera.far = 1000;
    const d = 120;
    this.dirLight.shadow.camera.left = -d;
    this.dirLight.shadow.camera.right = d;
    this.dirLight.shadow.camera.top = d;
    this.dirLight.shadow.camera.bottom = -d;
    this.dirLight.shadow.bias = -0.0005;
    this.scene.add(this.dirLight);

    // Standard fill light
    this.fillLight = new THREE.DirectionalLight(0x94a3b8, 0.6);
    this.fillLight.position.set(-100, 50, -100);
    this.scene.add(this.fillLight);

    // Dedicated Top Studio Light for "Studio Light" mode (Full black with 1 top studio light)
    this.topStudioLight = new THREE.DirectionalLight(0xffffff, 2.6);
    this.topStudioLight.position.set(0, 260, 0);
    this.topStudioLight.target.position.set(0, 0, 0);
    this.topStudioLight.castShadow = true;
    this.topStudioLight.shadow.mapSize.width = 2048;
    this.topStudioLight.shadow.mapSize.height = 2048;
    this.topStudioLight.shadow.camera.near = 10;
    this.topStudioLight.shadow.camera.far = 800;
    this.topStudioLight.shadow.camera.left = -d;
    this.topStudioLight.shadow.camera.right = d;
    this.topStudioLight.shadow.camera.top = d;
    this.topStudioLight.shadow.camera.bottom = -d;
    this.topStudioLight.shadow.bias = -0.0005;
    this.scene.add(this.topStudioLight);
    this.scene.add(this.topStudioLight.target);

    // Top Studio Spotlight for focused overhead beam & smooth radial falloff
    this.topStudioSpot = new THREE.SpotLight(0xffffff, 3.2, 800, Math.PI / 3.8, 0.5, 1.2);
    this.topStudioSpot.position.set(0, 240, 0);
    this.topStudioSpot.target.position.set(0, 0, 0);
    this.scene.add(this.topStudioSpot);
    this.scene.add(this.topStudioSpot.target);

    // Apply initial background & lighting state
    this.setBackground(this.currentBgType);
  }

  setupEnvironment() {
    // Grid Helper
    this.gridHelper = new THREE.GridHelper(200, 40, 0x38bdf8, 0x334155);
    this.gridHelper.position.y = 0;
    this.scene.add(this.gridHelper);

    // Ground Shadow Receiver Plane
    const planeGeo = new THREE.PlaneGeometry(600, 600);
    const planeMat = new THREE.ShadowMaterial({ opacity: 0.35 });
    this.shadowPlane = new THREE.Mesh(planeGeo, planeMat);
    this.shadowPlane.rotation.x = -Math.PI / 2;
    this.shadowPlane.position.y = -0.05;
    this.shadowPlane.receiveShadow = true;
    this.scene.add(this.shadowPlane);
  }

  applyShadowState(enabled) {
    if (this.shadowPlane) this.shadowPlane.visible = enabled;
    if (this.dirLight) this.dirLight.castShadow = enabled;
    if (this.topStudioLight) this.topStudioLight.castShadow = enabled;
    if (this.modelGroup) {
      this.modelGroup.traverse(child => {
        if (child.isMesh) {
          child.castShadow = enabled;
          child.receiveShadow = enabled;
        }
      });
    }
  }

  getVisibleMeshes() {
    const meshes = [];
    this.modelGroup.traverse((child) => {
      if (child.isMesh && child.visible) {
        meshes.push(child);
      }
    });
    return meshes;
  }

  clearCurrentModel() {
    this.faceGroundTool.setActive(false);
    const btnCenter = document.getElementById('btn-tool-center');
    if (btnCenter) btnCenter.classList.remove('active');
    while (this.modelGroup.children.length > 0) {
      const child = this.modelGroup.children[0];
      this.modelGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    }
  }

  processLoadedObject(object, name, fileSizeText = '', isTexturedFormat = false) {
    this.clearCurrentModel();
    this.currentModelName = name;
    document.getElementById('model-name-text').textContent = name;
    document.getElementById('status-model-format').textContent = `Format: ${name.split('.').pop().toUpperCase()}`;
    if (fileSizeText) {
      document.getElementById('status-filesize').textContent = `Size: ${fileSizeText}`;
    }

    const shadowActive = this.shadingEnabled && this.shadowsEnabled;
    object.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = shadowActive;
        child.receiveShadow = shadowActive;
        if (!child.geometry.attributes.normal) {
          child.geometry.computeVertexNormals();
        }
      }
    });

    this.modelGroup.add(object);

    // Center and ground the model
    const box = new THREE.Box3().setFromObject(this.modelGroup);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);

    // Center on X and Z, ground on Y (bottom of model at y=0)
    object.position.x -= center.x;
    object.position.z -= center.z;
    object.position.y -= box.min.y;

    // Recalculate aligned bounding box
    const alignedBox = new THREE.Box3().setFromObject(this.modelGroup);
    alignedBox.getSize(size);

    // Scale grid to fit model
    const maxDim = Math.max(size.x, size.y, size.z);
    const gridSize = Math.max(100, Math.ceil((maxDim * 2.2) / 10) * 10);
    this.scene.remove(this.gridHelper);
    this.gridHelper = new THREE.GridHelper(gridSize, 40, 0x38bdf8, 0x334155);
    this.scene.add(this.gridHelper);

    // Update light shadow bounds & top studio light position to fit model
    const shadowD = Math.max(120, maxDim * 1.5);
    if (this.dirLight && this.dirLight.shadow) {
      this.dirLight.shadow.camera.left = -shadowD;
      this.dirLight.shadow.camera.right = shadowD;
      this.dirLight.shadow.camera.top = shadowD;
      this.dirLight.shadow.camera.bottom = -shadowD;
      this.dirLight.shadow.camera.updateProjectionMatrix();
    }
    if (this.topStudioLight) {
      this.topStudioLight.position.set(0, Math.max(260, maxDim * 2.5), 0);
      if (this.topStudioLight.shadow) {
        this.topStudioLight.shadow.camera.left = -shadowD;
        this.topStudioLight.shadow.camera.right = shadowD;
        this.topStudioLight.shadow.camera.top = shadowD;
        this.topStudioLight.shadow.camera.bottom = -shadowD;
        this.topStudioLight.shadow.camera.updateProjectionMatrix();
      }
    }
    if (this.topStudioSpot) {
      this.topStudioSpot.position.set(0, Math.max(240, maxDim * 2.2), 0);
    }

    // Register with material manager and update UI swatches
    const activePreset = this.materialManager.registerModel(this.modelGroup, isTexturedFormat);
    document.querySelectorAll('.color-swatch').forEach(swatch => {
      swatch.classList.toggle('active', swatch.dataset.presetId === activePreset);
    });

    // Run geometric analysis
    this.runAnalysis();

    // Fit camera
    this.fitCameraToModel(alignedBox);

    this.hideLoading();
    this.showToast(`Loaded ${name}`);
  }

  fitCameraToModel(box) {
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);

    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = this.perspectiveCamera.fov * (Math.PI / 180);
    let cameraDistance = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.6;

    const offset = new THREE.Vector3(1, 0.75, 1.2).normalize().multiplyScalar(cameraDistance);
    const targetPos = center.clone().add(offset);

    this.controls.target.copy(center);
    this.perspectiveCamera.position.copy(targetPos);
    this.perspectiveCamera.near = cameraDistance / 100;
    this.perspectiveCamera.far = cameraDistance * 20;
    this.perspectiveCamera.updateProjectionMatrix();

    // Sync Ortho
    this.updateOrthoCameraFrustum(cameraDistance);
    this.orthographicCamera.position.copy(targetPos);
    this.orthographicCamera.lookAt(center);

    this.controls.update();
  }

  updateOrthoCameraFrustum(distance) {
    const aspect = window.innerWidth / window.innerHeight;
    const frustumSize = distance * 0.8;
    this.orthographicCamera.left = (-frustumSize * aspect) / 2;
    this.orthographicCamera.right = (frustumSize * aspect) / 2;
    this.orthographicCamera.top = frustumSize / 2;
    this.orthographicCamera.bottom = -frustumSize / 2;
    this.orthographicCamera.updateProjectionMatrix();
  }

  runAnalysis() {
    this.currentAnalysis = analyzeModel(this.modelGroup);
    this.updateAnalysisUI();
  }

  updateAnalysisUI() {
    if (!this.currentAnalysis) return;

    const a = this.currentAnalysis;
    const unit = this.currentUnit;
    let factor = 1.0;
    let unitLabel = 'mm';

    if (unit === 'cm') {
      factor = 0.1;
      unitLabel = 'cm';
    } else if (unit === 'in') {
      factor = 1.0 / 25.4;
      unitLabel = 'in';
    }

    document.getElementById('dimension-unit-badge').textContent = unitLabel;
    document.getElementById('stat-dim-x').innerHTML = `${(a.dimensions.width * factor).toFixed(2)} <small>${unitLabel}</small>`;
    document.getElementById('stat-dim-y').innerHTML = `${(a.dimensions.height * factor).toFixed(2)} <small>${unitLabel}</small>`;
    document.getElementById('stat-dim-z').innerHTML = `${(a.dimensions.depth * factor).toFixed(2)} <small>${unitLabel}</small>`;

    document.getElementById('stat-triangles').textContent = a.triangles.toLocaleString();
    document.getElementById('stat-vertices').textContent = a.vertices.toLocaleString();
    document.getElementById('status-polycount').textContent = `${a.triangles.toLocaleString()} Triangles`;

    document.getElementById('stat-area').innerHTML = `${a.surfaceAreaCm2.toFixed(2)} <small>cm²</small>`;
    document.getElementById('stat-volume').innerHTML = `${a.volumeCm3.toFixed(2)} <small>cm³</small>`;

    // Watertight Status Banner
    const banner = document.getElementById('stat-watertight-banner');
    if (a.isWatertight) {
      banner.className = 'status-banner success';
      banner.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
        <span>Watertight Mesh (Manifold 3D-Print Ready)</span>
      `;
    } else {
      banner.className = 'status-banner warning';
      banner.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
        <span>Open Edges Detected (${a.openEdgesCount} non-manifold edges)</span>
      `;
    }

    this.updateEstimatedWeight();
  }

  updateEstimatedWeight() {
    if (!this.currentAnalysis) return;
    const materialKey = document.getElementById('select-weight-material').value;
    const matInfo = MATERIAL_DENSITIES[materialKey] || MATERIAL_DENSITIES.pla;
    const infill = parseInt(document.getElementById('input-infill').value, 10);
    document.getElementById('infill-value-label').textContent = `${infill}%`;

    const massGrams = calculateEstimatedWeight(this.currentAnalysis.volumeCm3, matInfo.density, infill);
    const weightElem = document.getElementById('stat-estimated-weight');

    if (massGrams >= 1000) {
      weightElem.innerHTML = `${(massGrams / 1000).toFixed(3)} <small>kg</small>`;
    } else {
      weightElem.innerHTML = `${massGrams.toFixed(2)} <small>g</small>`;
    }
  }

  loadSample(sampleId) {
    this.showLoading(`Loading ${sampleId}...`);

    if (sampleId === 'bunny') {
      this.stlLoader.load(
        './models/Stanford_Bunny_sample.stl',
        (geometry) => {
          const mat = new THREE.MeshStandardMaterial({ color: 0x8a99ad });
          const mesh = new THREE.Mesh(geometry, mat);
          this.processLoadedObject(mesh, 'Stanford_Bunny_sample.stl', '5.6 MB');
        },
        undefined,
        (err) => {
          console.error(err);
          // Fallback to procedural sample if local asset path varies
          this.createProceduralSample('bunny');
        }
      );
    } else if (sampleId === 'gear') {
      this.createProceduralGear();
    } else if (sampleId === 'torus') {
      this.createProceduralTorus();
    } else if (sampleId === 'teapot') {
      this.createProceduralTeapot();
    }
  }

  createProceduralGear() {
    const teeth = 18;
    const innerRadius = 15;
    const outerRadius = 35;
    const toothHeight = 6;
    const thickness = 12;

    const shape = new THREE.Shape();
    const toothAngle = (Math.PI * 2) / teeth;

    for (let i = 0; i < teeth; i++) {
      const a0 = i * toothAngle;
      const a1 = a0 + toothAngle * 0.25;
      const a2 = a0 + toothAngle * 0.5;
      const a3 = a0 + toothAngle * 0.75;

      const rIn = outerRadius - toothHeight;
      const rOut = outerRadius;

      if (i === 0) shape.moveTo(Math.cos(a0) * rIn, Math.sin(a0) * rIn);
      else shape.lineTo(Math.cos(a0) * rIn, Math.sin(a0) * rIn);

      shape.lineTo(Math.cos(a1) * rOut, Math.sin(a1) * rOut);
      shape.lineTo(Math.cos(a2) * rOut, Math.sin(a2) * rOut);
      shape.lineTo(Math.cos(a3) * rIn, Math.sin(a3) * rIn);
    }
    shape.closePath();

    // Center hole
    const hole = new THREE.Path();
    hole.absarc(0, 0, innerRadius, 0, Math.PI * 2, true);
    shape.holes.push(hole);

    const extrudeSettings = { depth: thickness, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: 0.8, bevelThickness: 0.8 };
    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geometry.rotateX(Math.PI / 2);

    const mat = new THREE.MeshStandardMaterial({ color: 0x8a99ad, metalness: 0.7, roughness: 0.25 });
    const mesh = new THREE.Mesh(geometry, mat);
    this.processLoadedObject(mesh, 'Mechanical_Spur_Gear.stl', 'Procedural CAD');
  }

  createProceduralTorus() {
    const geometry = new THREE.TorusKnotGeometry(25, 8, 120, 24, 2, 3);
    const mat = new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.8, roughness: 0.2 });
    const mesh = new THREE.Mesh(geometry, mat);
    this.processLoadedObject(mesh, 'Torus_Knot.obj', 'Parametric Math');
  }

  createProceduralTeapot() {
    // Elegant procedural parametric flask / teapot representation
    const group = new THREE.Group();
    const bodyGeo = new THREE.SphereGeometry(24, 32, 24);
    bodyGeo.scale(1, 0.75, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.3, metalness: 0.1 });
    const body = new THREE.Mesh(bodyGeo, mat);
    body.position.y = 18;
    group.add(body);

    const neckGeo = new THREE.CylinderGeometry(8, 12, 14, 32);
    const neck = new THREE.Mesh(neckGeo, mat);
    neck.position.y = 35;
    group.add(neck);

    const lidGeo = new THREE.ConeGeometry(9, 6, 32);
    const lid = new THREE.Mesh(lidGeo, mat);
    lid.position.y = 43;
    group.add(lid);

    const spoutGeo = new THREE.TorusGeometry(14, 3, 16, 32, Math.PI * 0.7);
    const spout = new THREE.Mesh(spoutGeo, mat);
    spout.position.set(-18, 22, 0);
    spout.rotation.z = Math.PI * 0.85;
    group.add(spout);

    const handleGeo = new THREE.TorusGeometry(16, 3, 16, 32, Math.PI * 0.9);
    const handle = new THREE.Mesh(handleGeo, mat);
    handle.position.set(22, 20, 0);
    handle.rotation.z = -Math.PI * 0.45;
    group.add(handle);

    this.processLoadedObject(group, 'Utah_Teapot_Model.obj', 'Composite');
  }

  createProceduralSample(fallbackName) {
    this.createProceduralGear();
  }

  loadFiles(fileList) {
    if (!fileList || fileList.length === 0) return;

    this.showLoading('Reading 3D file...');

    const files = Array.from(fileList);
    const primaryFile = files.find(f => {
      const ext = f.name.split('.').pop().toLowerCase();
      return ['stl', 'obj', 'gltf', 'glb', 'ply', '3mf', 'fbx'].includes(ext);
    }) || files[0];

    const ext = primaryFile.name.split('.').pop().toLowerCase();
    const fileSizeMB = (primaryFile.size / (1024 * 1024)).toFixed(2) + ' MB';

    const reader = new FileReader();

    if (ext === 'stl') {
      reader.onload = (e) => {
        try {
          const geom = this.stlLoader.parse(e.target.result);
          const mat = new THREE.MeshStandardMaterial({ color: 0x8a99ad });
          const mesh = new THREE.Mesh(geom, mat);
          this.processLoadedObject(mesh, primaryFile.name, fileSizeMB);
        } catch (err) {
          this.hideLoading();
          alert('Failed to parse STL: ' + err.message);
        }
      };
      reader.readAsArrayBuffer(primaryFile);
    } else if (ext === 'ply') {
      reader.onload = (e) => {
        try {
          const geom = this.plyLoader.parse(e.target.result);
          const mat = new THREE.MeshStandardMaterial({ color: 0x8a99ad });
          const mesh = new THREE.Mesh(geom, mat);
          this.processLoadedObject(mesh, primaryFile.name, fileSizeMB);
        } catch (err) {
          this.hideLoading();
          alert('Failed to parse PLY: ' + err.message);
        }
      };
      reader.readAsArrayBuffer(primaryFile);
    } else if (ext === 'gltf' || ext === 'glb') {
      reader.onload = (e) => {
        this.gltfLoader.parse(
          e.target.result,
          '',
          (gltf) => {
            this.processLoadedObject(gltf.scene, primaryFile.name, fileSizeMB, true);
          },
          (err) => {
            this.hideLoading();
            alert('Failed to parse GLTF: ' + err.message);
          }
        );
      };
      reader.readAsArrayBuffer(primaryFile);
    } else if (ext === 'obj') {
      // Check if there is an MTL companion file
      const mtlFile = files.find(f => f.name.toLowerCase().endsWith('.mtl'));
      if (mtlFile) {
        const mtlReader = new FileReader();
        mtlReader.onload = (me) => {
          try {
            const materials = this.mtlLoader.parse(me.target.result);
            materials.preload();
            this.objLoader.setMaterials(materials);

            reader.onload = (oe) => {
              const obj = this.objLoader.parse(oe.target.result);
              this.processLoadedObject(obj, primaryFile.name, fileSizeMB, true);
            };
            reader.readAsText(primaryFile);
          } catch (err) {
            console.warn('MTL parsing failed, falling back to basic OBJ:', err);
            reader.onload = (oe) => {
              const obj = this.objLoader.parse(oe.target.result);
              this.processLoadedObject(obj, primaryFile.name, fileSizeMB, false);
            };
            reader.readAsText(primaryFile);
          }
        };
        mtlReader.readAsText(mtlFile);
      } else {
        reader.onload = (e) => {
          try {
            const obj = this.objLoader.parse(e.target.result);
            this.processLoadedObject(obj, primaryFile.name, fileSizeMB, false);
          } catch (err) {
            this.hideLoading();
            alert('Failed to parse OBJ: ' + err.message);
          }
        };
        reader.readAsText(primaryFile);
      }
    } else if (ext === '3mf') {
      reader.onload = (e) => {
        try {
          const obj = this.threeMfLoader.parse(e.target.result);
          this.processLoadedObject(obj, primaryFile.name, fileSizeMB, true);
        } catch (err) {
          this.hideLoading();
          alert('Failed to parse 3MF: ' + err.message);
        }
      };
      reader.readAsArrayBuffer(primaryFile);
    } else {
      this.hideLoading();
      alert(`Format .${ext} is not supported directly in the browser yet.`);
    }
  }

  exportModel(format) {
    if (!this.modelGroup || this.modelGroup.children.length === 0) {
      alert('No model loaded to export.');
      return;
    }

    const baseName = this.currentModelName.replace(/\.[^/.]+$/, "");

    if (format === 'stl') {
      const result = this.stlExporter.parse(this.modelGroup, { binary: true });
      this.downloadBlob(new Blob([result], { type: 'application/octet-stream' }), `${baseName}_export.stl`);
      this.showToast('Exported STL successfully!');
    } else if (format === 'obj') {
      const result = this.objExporter.parse(this.modelGroup);
      this.downloadBlob(new Blob([result], { type: 'text/plain' }), `${baseName}_export.obj`);
      this.showToast('Exported OBJ successfully!');
    } else if (format === 'gltf') {
      this.gltfExporter.parse(
        this.modelGroup,
        (gltf) => {
          const output = JSON.stringify(gltf, null, 2);
          this.downloadBlob(new Blob([output], { type: 'application/json' }), `${baseName}_export.gltf`);
          this.showToast('Exported GLTF successfully!');
        },
        (err) => {
          console.error(err);
          alert('Export GLTF error: ' + err.message);
        },
        { binary: false }
      );
    }
  }

  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  captureSnapshot() {
    this.renderer.render(this.scene, this.camera);

    const finishDownload = (dataUrl) => {
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `B08_${this.currentModelName.replace(/\.[^/.]+$/, "")}_snapshot.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      this.showToast('Snapshot saved as PNG!');
    };

    if (this.currentBgType === 'custom-image' && this.customBgMode === 'backdrop' && this.customBgDataUrl) {
      const offscreen = document.createElement('canvas');
      offscreen.width = this.canvas.width;
      offscreen.height = this.canvas.height;
      const ctx = offscreen.getContext('2d');
      const img = new Image();
      img.onload = () => {
        const hRatio = offscreen.width / img.width;
        const vRatio = offscreen.height / img.height;
        const ratio = Math.max(hRatio, vRatio);
        const centerShift_x = (offscreen.width - img.width * ratio) / 2;
        const centerShift_y = (offscreen.height - img.height * ratio) / 2;
        ctx.drawImage(img, 0, 0, img.width, img.height,
                      centerShift_x, centerShift_y, img.width * ratio, img.height * ratio);
        ctx.drawImage(this.canvas, 0, 0);
        finishDownload(offscreen.toDataURL('image/png'));
      };
      img.src = this.customBgDataUrl;
    } else {
      finishDownload(this.canvas.toDataURL('image/png'));
    }
  }

  setCameraPreset(preset) {
    const box = new THREE.Box3().setFromObject(this.modelGroup);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z) || 100;
    const dist = maxDim * 1.8;

    const targetPos = center.clone();

    switch (preset) {
      case 'front':
        targetPos.z += dist;
        break;
      case 'back':
        targetPos.z -= dist;
        break;
      case 'top':
        targetPos.y += dist;
        break;
      case 'bottom':
        targetPos.y -= dist;
        break;
      case 'left':
        targetPos.x -= dist;
        break;
      case 'right':
        targetPos.x += dist;
        break;
      case 'isometric':
      default:
        targetPos.add(new THREE.Vector3(1, 0.75, 1.2).normalize().multiplyScalar(dist));
        break;
    }

    this.animateCameraTo(targetPos, center);
  }

  animateCameraTo(targetPos, targetLookAt) {
    this.animatingCamera = true;
    this.camAnimStartTime = performance.now();
    this.camStartPos.copy(this.camera.position);
    this.camTargetPos.copy(targetPos);
    this.camStartLook.copy(this.controls.target);
    this.camTargetLook.copy(targetLookAt);
  }

  toggleProjection() {
    this.isOrtho = !this.isOrtho;
    const oldCam = this.camera;
    const newCam = this.isOrtho ? this.orthographicCamera : this.perspectiveCamera;

    newCam.position.copy(oldCam.position);
    newCam.rotation.copy(oldCam.rotation);

    if (this.isOrtho) {
      const dist = oldCam.position.distanceTo(this.controls.target);
      this.updateOrthoCameraFrustum(dist);
    }

    this.camera = newCam;
    this.controls.object = newCam;
    this.faceGroundTool.camera = newCam;
    this.controls.update();

    const btn = document.getElementById('btn-proj-toggle');
    btn.classList.toggle('active', this.isOrtho);
    this.showToast(`Camera: ${this.isOrtho ? 'Orthographic' : 'Perspective'}`);
  }

  applyCustomBackground() {
    if (!this.customBgTexture) return;

    this.container.style.backgroundImage = 'none';

    if (this.customBgMode === '360') {
      this.scene.background = this.customBgTexture;
      this.scene.backgroundBlurriness = this.customBgBlur;
      this.scene.backgroundIntensity = this.customBgIntensity;
    } else {
      this.scene.background = null;
      this.container.style.backgroundImage = `url("${this.customBgDataUrl}")`;
      this.container.style.backgroundSize = 'cover';
      this.container.style.backgroundPosition = 'center';
      this.container.style.backgroundRepeat = 'no-repeat';
    }

    if (this.customBgEnvLighting) {
      this.scene.environment = this.customBgTexture;
      this.scene.environmentIntensity = this.customBgIntensity;
    } else {
      this.scene.environment = null;
    }
  }

  setBackground(bgType) {
    this.currentBgType = bgType;
    this.container.style.backgroundImage = 'none';

    if (bgType === 'custom-image') {
      if (this.topStudioLight) this.topStudioLight.visible = false;
      if (this.topStudioSpot) this.topStudioSpot.visible = false;
      if (this.dirLight) this.dirLight.visible = true;
      if (this.fillLight) this.fillLight.visible = true;
      if (this.hemiLight) this.hemiLight.intensity = 0.9;
      this.applyCustomBackground();
      return;
    }

    // Revert to default studio environment if using solid background
    this.scene.environment = this.defaultEnvironment;
    this.scene.backgroundBlurriness = 0;
    this.scene.backgroundIntensity = 1;

    if (bgType === 'studio') {
      // Full black background with 1 top studio light
      this.scene.background = new THREE.Color(0x000000);
      if (this.topStudioLight) this.topStudioLight.visible = true;
      if (this.topStudioSpot) this.topStudioSpot.visible = true;
      if (this.dirLight) this.dirLight.visible = false;
      if (this.fillLight) this.fillLight.visible = false;
      if (this.hemiLight) this.hemiLight.intensity = 0.08;
      this.scene.environmentIntensity = 0.2;
    } else {
      // Standard multi-light environment for other solid backgrounds
      if (this.topStudioLight) this.topStudioLight.visible = false;
      if (this.topStudioSpot) this.topStudioSpot.visible = false;
      if (this.dirLight) this.dirLight.visible = true;
      if (this.fillLight) this.fillLight.visible = true;
      if (this.hemiLight) this.hemiLight.intensity = 0.9;
      this.scene.environmentIntensity = 1.0;

      switch (bgType) {
        case 'navy':
          this.scene.background = new THREE.Color(0x0f172a);
          break;
        case 'black':
          this.scene.background = new THREE.Color(0x050508);
          break;
        case 'white':
          this.scene.background = new THREE.Color(0xf8fafc);
          break;
      }
    }
  }

  rotateModelAroundGround(angleRad) {
    if (!this.modelGroup) return;
    const rotQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angleRad);
    this.modelGroup.position.applyQuaternion(rotQuat);
    this.modelGroup.quaternion.premultiply(rotQuat);
    this.modelGroup.updateMatrixWorld(true);
  }

  initUI() {
    // Generate color swatches
    const container = document.getElementById('color-presets-container');
    COLOR_PRESETS.forEach((preset) => {
      const swatch = document.createElement('div');
      swatch.className = `color-swatch ${preset.id === 'original' ? 'active' : ''}`;
      if (preset.gradient) {
        swatch.style.background = preset.gradient;
      } else {
        swatch.style.backgroundColor = preset.hex;
      }
      swatch.title = preset.name;
      swatch.dataset.presetId = preset.id;
      swatch.addEventListener('click', () => {
        document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
        this.materialManager.setPreset(preset.id, this.modelGroup);
      });
      container.appendChild(swatch);
    });

    // Wire up tabs
    document.querySelectorAll('.panel-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.panel-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

        btn.classList.add('active');
        const target = btn.dataset.tab;
        document.getElementById(target).classList.add('active');
      });
    });
  }

  setupEventListeners() {
    // Window Resize
    window.addEventListener('resize', () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const aspect = width / height;

      this.perspectiveCamera.aspect = aspect;
      this.perspectiveCamera.updateProjectionMatrix();

      const dist = this.camera.position.distanceTo(this.controls.target);
      this.updateOrthoCameraFrustum(dist);

      this.renderer.setSize(width, height);
    });

    // File Input
    const fileInput = document.getElementById('file-input');
    document.getElementById('btn-open-file').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      this.loadFiles(e.target.files);
      fileInput.value = '';
    });

    // Sample Models Dropdown
    const samplesBtn = document.getElementById('btn-samples');
    const samplesDropdown = document.getElementById('samples-dropdown');
    samplesBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      samplesDropdown.classList.toggle('show');
    });
    samplesDropdown.querySelectorAll('.view-sub-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.loadSample(btn.dataset.sample);
        samplesDropdown.classList.remove('show');
      });
    });

    // Turntable Toggle
    const turntableBtn = document.getElementById('btn-turntable');
    turntableBtn.addEventListener('click', () => {
      this.autoRotate = !this.autoRotate;
      turntableBtn.classList.toggle('active', this.autoRotate);
    });

    // Reset View Button
    document.getElementById('btn-reset-view').addEventListener('click', () => {
      this.setCameraPreset('isometric');
    });

    // Snapshot Button
    document.getElementById('btn-snapshot').addEventListener('click', () => {
      this.captureSnapshot();
    });

    // Export Modal Buttons
    const exportModal = document.getElementById('modal-export');
    document.getElementById('btn-export-modal').addEventListener('click', () => {
      exportModal.classList.add('show');
    });
    document.getElementById('btn-export-stl').addEventListener('click', () => {
      this.exportModel('stl');
      exportModal.classList.remove('show');
    });
    document.getElementById('btn-export-obj').addEventListener('click', () => {
      this.exportModel('obj');
      exportModal.classList.remove('show');
    });
    document.getElementById('btn-export-gltf').addEventListener('click', () => {
      this.exportModel('gltf');
      exportModal.classList.remove('show');
    });

    // Close Modals
    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById(btn.dataset.close).classList.remove('show');
      });
    });

    // Shortcuts Modal
    const shortcutsModal = document.getElementById('modal-shortcuts');
    document.getElementById('btn-shortcuts-modal').addEventListener('click', () => {
      shortcutsModal.classList.add('show');
    });

    // Side Panel Toggle
    const sidePanel = document.getElementById('side-panel');
    document.getElementById('btn-toggle-panel').addEventListener('click', () => {
      sidePanel.classList.toggle('collapsed');
      sidePanel.classList.toggle('open-mobile');
    });

    // Views Flyout
    const viewsToggle = document.getElementById('btn-views-toggle');
    const viewsFlyout = document.getElementById('views-flyout');
    viewsToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      viewsFlyout.classList.toggle('show');
    });
    viewsFlyout.querySelectorAll('.view-sub-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.setCameraPreset(btn.dataset.view);
        viewsFlyout.classList.remove('show');
      });
    });

    // Projection Toggle
    document.getElementById('btn-proj-toggle').addEventListener('click', () => {
      this.toggleProjection();
    });

    // Shading Flyout
    const shadingToggle = document.getElementById('btn-shading-toggle');
    const shadingFlyout = document.getElementById('shading-flyout');
    shadingToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      shadingFlyout.classList.toggle('show');
    });
    shadingFlyout.querySelectorAll('.view-sub-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        shadingFlyout.querySelectorAll('.view-sub-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.materialManager.setRenderMode(btn.dataset.mode, this.modelGroup);
        const checkSmoothing = document.getElementById('check-smoothing');
        if (checkSmoothing) {
          checkSmoothing.checked = this.materialManager.smoothing;
        }
        shadingFlyout.classList.remove('show');
      });
    });

    // Ground to Selected Face & Center Button
    const btnCenter = document.getElementById('btn-tool-center');
    btnCenter.addEventListener('click', () => {
      const willBeActive = !this.faceGroundTool.active;
      this.faceGroundTool.setActive(willBeActive);
      btnCenter.classList.toggle('active', willBeActive);
      if (willBeActive) {
        this.showToast('Click any face on the model to lay it flat on the ground (ESC to cancel)');
      }
    });

    // Rotate 90 deg around ground grid
    document.getElementById('btn-tool-rotate-y').addEventListener('click', () => {
      this.rotateModelAroundGround(Math.PI / 2);
      this.runAnalysis();
    });

    // Unit Selector (mm, cm, in)
    document.getElementById('select-unit').addEventListener('change', (e) => {
      this.currentUnit = e.target.value;
      this.updateAnalysisUI();
    });

    // Weight Estimator Material & Infill
    document.getElementById('select-weight-material').addEventListener('change', () => this.updateEstimatedWeight());
    document.getElementById('input-infill').addEventListener('input', () => this.updateEstimatedWeight());

    // Appearance Controls
    document.getElementById('custom-color-picker').addEventListener('input', (e) => {
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      this.materialManager.setColor(e.target.value, this.modelGroup);
    });

    // Surface Properties (3D Builder Style: Shading, Shadow, Reflection, Smoothing)
    const checkShading = document.getElementById('check-shading');
    const checkShadow = document.getElementById('check-shadow');
    const rowShadow = document.getElementById('row-shadow');
    const checkReflection = document.getElementById('check-reflection');
    const checkSmoothing = document.getElementById('check-smoothing');

    if (checkShading) {
      checkShading.addEventListener('change', (e) => {
        this.shadingEnabled = e.target.checked;
        this.materialManager.setShading(this.shadingEnabled, this.modelGroup);

        if (rowShadow && checkShadow) {
          if (this.shadingEnabled) {
            rowShadow.style.opacity = '1';
            rowShadow.style.pointerEvents = 'auto';
            checkShadow.disabled = false;
            this.applyShadowState(checkShadow.checked);
          } else {
            rowShadow.style.opacity = '0.35';
            rowShadow.style.pointerEvents = 'none';
            checkShadow.disabled = true;
            this.applyShadowState(false);
          }
        }
      });
    }

    if (checkShadow) {
      checkShadow.addEventListener('change', (e) => {
        this.shadowsEnabled = e.target.checked;
        if (this.shadingEnabled) {
          this.applyShadowState(this.shadowsEnabled);
        }
      });
    }

    if (checkReflection) {
      checkReflection.addEventListener('change', (e) => {
        this.materialManager.setReflection(e.target.checked, this.modelGroup);
      });
    }

    if (checkSmoothing) {
      checkSmoothing.addEventListener('change', (e) => {
        this.materialManager.setSmoothing(e.target.checked, this.modelGroup);
        if (shadingFlyout) {
          shadingFlyout.querySelectorAll('.view-sub-btn').forEach(btn => {
            if (btn.dataset.mode === 'solid') btn.classList.toggle('active', e.target.checked);
            if (btn.dataset.mode === 'flat') btn.classList.toggle('active', !e.target.checked);
          });
        }
      });
    }

    // Background Selector
    document.querySelectorAll('#bg-selector .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#bg-selector .seg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.setBackground(btn.dataset.bg);
      });
    });

    // Custom Background Image Upload & Controls
    const bgImageInput = document.getElementById('bg-image-input');
    const btnUploadBg = document.getElementById('btn-upload-bg-image');
    const segBtnCustomBg = document.getElementById('seg-btn-custom-bg');
    const customImageControls = document.getElementById('custom-image-controls');
    const bgThumbnail = document.getElementById('bg-thumbnail');
    const bgImageFilename = document.getElementById('bg-image-filename');
    const btnRemoveBg = document.getElementById('btn-remove-bg-image');

    btnUploadBg.addEventListener('click', () => bgImageInput.click());

    bgImageInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (re) => {
        const dataUrl = re.target.result;
        this.customBgDataUrl = dataUrl;

        this.textureLoader.load(dataUrl, (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.mapping = THREE.EquirectangularReflectionMapping;
          texture.needsUpdate = true;

          if (this.customBgTexture) {
            this.customBgTexture.dispose();
          }
          this.customBgTexture = texture;

          // Update UI
          bgThumbnail.src = dataUrl;
          bgImageFilename.textContent = file.name;
          customImageControls.style.display = 'flex';
          segBtnCustomBg.style.display = 'inline-block';

          // Select custom image in segmented control
          document.querySelectorAll('#bg-selector .seg-btn').forEach(b => b.classList.remove('active'));
          segBtnCustomBg.classList.add('active');

          this.setBackground('custom-image');
          this.showToast('Custom environment image applied!');
        });
      };
      reader.readAsDataURL(file);
      bgImageInput.value = '';
    });

    btnRemoveBg.addEventListener('click', () => {
      if (this.customBgTexture) {
        this.customBgTexture.dispose();
        this.customBgTexture = null;
      }
      this.customBgDataUrl = null;
      customImageControls.style.display = 'none';
      segBtnCustomBg.style.display = 'none';

      // Revert to studio light
      document.querySelectorAll('#bg-selector .seg-btn').forEach(b => b.classList.remove('active'));
      const defaultBtn = document.querySelector('#bg-selector .seg-btn[data-bg="studio"]');
      if (defaultBtn) defaultBtn.classList.add('active');

      this.setBackground('studio');
      this.showToast('Background image removed');
    });

    // Display mode: 360 vs 2D backdrop
    document.querySelectorAll('#bg-mode-selector .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#bg-mode-selector .seg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.customBgMode = btn.dataset.mode;
        document.getElementById('bg-blur-container').style.display = this.customBgMode === '360' ? 'flex' : 'none';
        if (this.currentBgType === 'custom-image') {
          this.applyCustomBackground();
        }
      });
    });

    // Environment Lighting toggle
    document.getElementById('check-bg-env-lighting').addEventListener('change', (e) => {
      this.customBgEnvLighting = e.target.checked;
      if (this.currentBgType === 'custom-image') {
        this.applyCustomBackground();
      }
    });

    // Background blur slider
    document.getElementById('input-bg-blur').addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      document.getElementById('bg-blur-label').textContent = `${val}%`;
      this.customBgBlur = val / 100;
      if (this.currentBgType === 'custom-image' && this.customBgMode === '360') {
        this.scene.backgroundBlurriness = this.customBgBlur;
      }
    });

    // Background intensity slider
    document.getElementById('input-bg-intensity').addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      document.getElementById('bg-intensity-label').textContent = `${val}%`;
      this.customBgIntensity = val / 100;
      if (this.currentBgType === 'custom-image') {
        if (this.customBgMode === '360') {
          this.scene.backgroundIntensity = this.customBgIntensity;
        }
        if (this.scene.environment) {
          this.scene.environmentIntensity = this.customBgIntensity;
        }
      }
    });

    // Environment Toggles
    document.getElementById('check-grid').addEventListener('change', (e) => {
      this.gridHelper.visible = e.target.checked;
    });

    // Video Turntable Recorder & Framing Controls
    const modalVideo = document.getElementById('modal-video-record');
    const btnVideoRecord = document.getElementById('btn-video-record');
    const btnFrameToggle = document.getElementById('btn-frame-toggle');
    const checkFrameGuide = document.getElementById('check-frame-guide');
    const inputVideoDuration = document.getElementById('input-video-duration');
    const videoDurationLabel = document.getElementById('video-duration-label');
    const checkLoop360 = document.getElementById('check-loop-360');
    const selectVideoQuality = document.getElementById('select-video-quality');
    const btnFitFrame = document.getElementById('btn-fit-frame');
    const btnStartRecordAction = document.getElementById('btn-start-record-action');
    const btnStopRecording = document.getElementById('btn-stop-recording');

    if (btnVideoRecord) {
      btnVideoRecord.addEventListener('click', () => {
        modalVideo.classList.add('show');
        if (checkFrameGuide && checkFrameGuide.checked) {
          this.videoRecorder.setFrameGuideVisible(true);
          if (btnFrameToggle) btnFrameToggle.classList.add('active');
        }
      });
    }

    if (btnFrameToggle) {
      btnFrameToggle.addEventListener('click', () => {
        const next = !this.videoRecorder.isFrameGuideVisible;
        this.videoRecorder.setFrameGuideVisible(next);
        btnFrameToggle.classList.toggle('active', next);
        if (checkFrameGuide) checkFrameGuide.checked = next;
        this.showToast(next ? `Framing Guide Enabled (${this.videoRecorder.aspectRatio})` : 'Framing Guide Disabled');
      });
    }

    if (checkFrameGuide) {
      checkFrameGuide.addEventListener('change', (e) => {
        this.videoRecorder.setFrameGuideVisible(e.target.checked);
        if (btnFrameToggle) btnFrameToggle.classList.toggle('active', e.target.checked);
      });
    }

    document.querySelectorAll('#frame-aspect-selector .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#frame-aspect-selector .seg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.videoRecorder.setAspectRatio(btn.dataset.ratio);
      });
    });

    if (inputVideoDuration) {
      inputVideoDuration.addEventListener('input', (e) => {
        const val = Math.min(10.0, Math.max(1.0, parseFloat(e.target.value)));
        if (videoDurationLabel) videoDurationLabel.textContent = `${val.toFixed(1)} s`;
        this.videoRecorder.duration = val;
      });
    }

    if (checkLoop360) {
      checkLoop360.addEventListener('change', (e) => {
        this.videoRecorder.loop360 = e.target.checked;
      });
    }

    if (selectVideoQuality) {
      selectVideoQuality.addEventListener('change', (e) => {
        this.videoRecorder.resolution = parseInt(e.target.value, 10);
        this.videoRecorder.updateFrameBounds();
      });
    }

    if (btnFitFrame) {
      btnFitFrame.addEventListener('click', () => {
        this.videoRecorder.fitModelToFrame();
      });
    }

    if (btnStartRecordAction) {
      btnStartRecordAction.addEventListener('click', () => {
        this.videoRecorder.startRecording();
      });
    }

    if (btnStopRecording) {
      btnStopRecording.addEventListener('click', () => {
        this.videoRecorder.stopRecording();
      });
    }

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      switch (e.key.toLowerCase()) {
        case 'r':
          this.setCameraPreset('isometric');
          break;
        case '1':
          this.setCameraPreset('front');
          break;
        case '2':
          this.setCameraPreset('back');
          break;
        case '3':
          this.setCameraPreset('top');
          break;
        case '4':
          this.setCameraPreset('bottom');
          break;
        case '5':
          this.setCameraPreset('left');
          break;
        case '6':
          this.setCameraPreset('right');
          break;
        case 'w':
          const nextMode = this.materialManager.renderMode === 'wireframe_overlay' ? 'solid' : 'wireframe_overlay';
          this.materialManager.setRenderMode(nextMode, this.modelGroup);
          this.showToast(`Mode: ${nextMode}`);
          break;
        case 'p':
          this.toggleProjection();
          break;
        case ' ':
          this.autoRotate = !this.autoRotate;
          turntableBtn.classList.toggle('active', this.autoRotate);
          break;
        case 's':
          this.captureSnapshot();
          break;
        case 'g':
          btnCenter.click();
          break;
        case 'v':
          if (btnVideoRecord) btnVideoRecord.click();
          break;
        case 'f':
          if (btnFrameToggle) btnFrameToggle.click();
          break;
      }
    });

    // Close flyouts on click outside
    window.addEventListener('click', () => {
      viewsFlyout.classList.remove('show');
      shadingFlyout.classList.remove('show');
      samplesDropdown.classList.remove('show');
    });

    // Fullscreen Drag and Drop
    const dropZone = document.getElementById('drop-zone');
    let dragCounter = 0;

    window.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      dropZone.classList.add('active');
    });

    window.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        dropZone.classList.remove('active');
      }
    });

    window.addEventListener('dragover', (e) => e.preventDefault());

    window.addEventListener('drop', (e) => {
      e.preventDefault();
      dragCounter = 0;
      dropZone.classList.remove('active');
      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        this.loadFiles(e.dataTransfer.files);
      }
    });
  }

  showLoading(text) {
    document.getElementById('loading-text').textContent = text;
    document.getElementById('loading-overlay').classList.add('show');
  }

  hideLoading() {
    document.getElementById('loading-overlay').classList.remove('show');
  }

  showToast(message) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 2400);
  }

  animate(time) {
    requestAnimationFrame(this.animate);

    // Calculate FPS
    this.fpsFrames++;
    if (time - this.fpsLastTime >= 1000) {
      const fps = Math.round((this.fpsFrames * 1000) / (time - this.fpsLastTime));
      this.fpsDisplay.textContent = `${fps} FPS`;
      this.fpsFrames = 0;
      this.fpsLastTime = time;
    }

    // Auto rotate turntable around ground grid vertical axis
    if (this.autoRotate) {
      this.rotateModelAroundGround(0.008);
    }

    // Update Face-to-Ground animation
    this.faceGroundTool.update(time);

    // Update Video Turntable Recording (if active)
    if (this.videoRecorder) {
      this.videoRecorder.update(time);
    }

    // Smooth Camera Transition
    if (this.animatingCamera) {
      const elapsed = time - this.camAnimStartTime;
      const progress = Math.min(1, elapsed / this.camAnimDuration);
      // Ease out cubic
      const ease = 1 - Math.pow(1 - progress, 3);

      this.camera.position.lerpVectors(this.camStartPos, this.camTargetPos, ease);
      this.controls.target.lerpVectors(this.camStartLook, this.camTargetLook, ease);
      this.controls.update();

      if (progress >= 1) {
        this.animatingCamera = false;
      }
    } else {
      this.controls.update();
    }

    if (!this.videoRecorder || !this.videoRecorder.isRecording) {
      this.renderer.render(this.scene, this.camera);
    }
  }
}

// Initialize on DOM load
window.addEventListener('DOMContentLoaded', () => {
  new B08App();
});
