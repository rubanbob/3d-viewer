import * as THREE from 'three';

export const COLOR_PRESETS = [
  { id: 'original', name: 'Original Textures & Colors', gradient: 'linear-gradient(135deg, #f43f5e 0%, #eab308 50%, #06b6d4 100%)' },
  { id: 'titanium', name: 'Titanium', hex: '#8a99ad', metalness: 0.4, roughness: 0.35 },
  { id: 'graphite', name: 'Graphite', hex: '#2b303c', metalness: 0.2, roughness: 0.6 },
  { id: 'blue', name: 'Slate Blue', hex: '#2563eb', metalness: 0.1, roughness: 0.4 },
  { id: 'green', name: 'Emerald', hex: '#059669', metalness: 0.15, roughness: 0.45 },
  { id: 'orange', name: 'Safety Orange', hex: '#ea580c', metalness: 0.05, roughness: 0.5 },
  { id: 'gold', name: 'Brass / Gold', hex: '#d97706', metalness: 0.8, roughness: 0.25 },
  { id: 'clay', name: 'Matte Clay', hex: '#e2e8f0', metalness: 0.0, roughness: 0.85 },
  { id: 'ruby', name: 'Crimson Ruby', hex: '#be123c', metalness: 0.2, roughness: 0.3 }
];

export class MaterialManager {
  constructor() {
    this.renderMode = 'solid'; // 'solid', 'flat', 'wireframe_overlay', 'wireframe_only', 'points', 'normals', 'xray'
    this.currentPreset = 'original'; // 'original' or preset id or 'custom'
    this.currentColor = '#8a99ad';
    this.metalness = 0.35;
    this.roughness = 0.30;
    this.opacity = 1.0;
    this.doubleSided = true;
    this.wireframeColor = '#38bdf8';
    this.pointSize = 3.0;

    // 3D Builder Display Properties
    this.shading = true;     // 1. Shading (lit vs unlit basic)
    this.reflection = true;  // 2. Reflection (specular reflections vs matte)
    this.smoothing = true;   // 3. Smoothing (smooth normals vs flat faceted faces)

    // Cache of original materials cloned directly from the loaded model
    this.originalMaterialsMap = new Map();
    // Cache of wireframe overlays created for meshes
    this.wireframeOverlays = [];
    this.pointsOverlays = [];
  }

  registerModel(rootObject, preferOriginal = true) {
    this.clearOverlays();
    this.originalMaterialsMap.clear();

    let hasTexturesOrColors = false;

    rootObject.traverse((child) => {
      if (child.isMesh && child.material) {
        if (Array.isArray(child.material)) {
          const clones = child.material.map(m => {
            if (m.map || m.roughnessMap || m.normalMap || m.metalnessMap || m.emissiveMap) {
              hasTexturesOrColors = true;
            }
            if (m.color && m.color.getHex() !== 0xffffff) {
              hasTexturesOrColors = true;
            }
            return m.clone();
          });
          this.originalMaterialsMap.set(child, clones);
        } else {
          const m = child.material;
          if (m.map || m.roughnessMap || m.normalMap || m.metalnessMap || m.emissiveMap) {
            hasTexturesOrColors = true;
          }
          if (m.color && m.color.getHex() !== 0xffffff) {
            hasTexturesOrColors = true;
          }
          if (child.geometry && (child.geometry.attributes.color || child.geometry.attributes.uv)) {
            hasTexturesOrColors = true;
          }
          this.originalMaterialsMap.set(child, m.clone());
        }
      }
    });

    if (preferOriginal || hasTexturesOrColors) {
      this.currentPreset = 'original';
    } else {
      this.currentPreset = 'titanium';
      this.currentColor = '#8a99ad';
      this.metalness = 0.4;
      this.roughness = 0.35;
    }

    this.applyCurrentSettings(rootObject);
    return this.currentPreset;
  }

  clearOverlays() {
    this.wireframeOverlays.forEach(({ mesh, overlay }) => {
      mesh.remove(overlay);
      if (overlay.geometry) overlay.geometry.dispose();
      if (overlay.material) overlay.material.dispose();
    });
    this.wireframeOverlays = [];

    this.pointsOverlays.forEach(({ mesh, overlay }) => {
      mesh.remove(overlay);
      if (overlay.material) overlay.material.dispose();
    });
    this.pointsOverlays = [];
  }

  applyCurrentSettings(rootObject) {
    this.clearOverlays();

    const isFlat = !this.smoothing || this.renderMode === 'flat';
    const effectiveRoughness = this.reflection ? 0.30 : 1.0;
    const effectiveMetalness = this.reflection ? 0.35 : 0.0;
    const effectiveEnvIntensity = this.reflection ? 1.0 : 0.0;
    const side = THREE.DoubleSide;

    rootObject.traverse((child) => {
      if (!child.isMesh) return;

      // When smoothing is enabled, ensure vertex normals exist
      if (this.smoothing && child.geometry && (!child.geometry.attributes.normal || child.geometry.attributes.normal.count === 0)) {
        child.geometry.computeVertexNormals();
      }

      if (this.renderMode === 'normals') {
        child.visible = true;
        child.material = new THREE.MeshNormalMaterial({
          side,
          flatShading: isFlat
        });
      } else if (this.renderMode === 'wireframe_only') {
        child.visible = true;
        child.material = new THREE.MeshBasicMaterial({
          color: new THREE.Color(this.currentColor === 'original' ? '#38bdf8' : this.currentColor),
          wireframe: true,
          side
        });
      } else if (this.renderMode === 'points') {
        child.visible = false;
        const pointsMat = new THREE.PointsMaterial({
          color: new THREE.Color(this.currentColor === 'original' ? '#38bdf8' : this.currentColor),
          size: this.pointSize,
          sizeAttenuation: true
        });
        const points = new THREE.Points(child.geometry, pointsMat);
        child.parent.add(points);
        this.pointsOverlays.push({ mesh: child.parent, overlay: points });
      } else if (this.renderMode === 'xray') {
        child.visible = true;
        child.material = new THREE.MeshPhysicalMaterial({
          color: new THREE.Color(this.currentColor === 'original' ? '#8a99ad' : this.currentColor),
          transparent: true,
          opacity: 0.35,
          transmission: 0.6,
          roughness: effectiveRoughness,
          metalness: effectiveMetalness,
          side,
          depthWrite: false,
          flatShading: isFlat
        });
      } else {
        // Solid or Flat or Wireframe Overlay
        child.visible = true;

        if (!this.shading) {
          // Unshaded / Unlit Mode (3D Builder Shading = OFF)
          if (this.currentPreset === 'original' && this.originalMaterialsMap.has(child)) {
            const orig = this.originalMaterialsMap.get(child);
            const makeBasic = (m) => new THREE.MeshBasicMaterial({
              map: m.map || null,
              color: m.map ? 0xffffff : (m.color ? m.color : 0xffffff),
              side
            });
            if (Array.isArray(orig)) {
              child.material = orig.map(makeBasic);
            } else {
              child.material = makeBasic(orig);
            }
          } else {
            child.material = new THREE.MeshBasicMaterial({
              color: new THREE.Color(this.currentColor),
              side
            });
          }
        } else {
          // Shaded Mode (3D Builder Shading = ON)
          if (this.currentPreset === 'original' && this.originalMaterialsMap.has(child)) {
            // Authentic original GLTF/GLB materials
            const orig = this.originalMaterialsMap.get(child);
            const processMat = (m) => {
              const clone = m.clone();
              clone.side = side;
              clone.flatShading = isFlat;
              if (clone.roughness !== undefined) {
                clone.roughness = this.reflection ? (m.roughness !== undefined ? m.roughness : 0.35) : 1.0;
              }
              if (clone.metalness !== undefined) {
                clone.metalness = this.reflection ? (m.metalness !== undefined ? m.metalness : 0.2) : 0.0;
              }
              if (clone.envMapIntensity !== undefined) {
                clone.envMapIntensity = effectiveEnvIntensity;
              }
              clone.needsUpdate = true;
              return clone;
            };

            if (Array.isArray(orig)) {
              child.material = orig.map(processMat);
            } else {
              child.material = processMat(orig);
            }
          } else {
            // Preset or custom monochrome color
            const mat = new THREE.MeshStandardMaterial({
              color: new THREE.Color(this.currentColor),
              roughness: effectiveRoughness,
              metalness: effectiveMetalness,
              envMapIntensity: effectiveEnvIntensity,
              flatShading: isFlat,
              side
            });
            child.material = mat;
          }
        }

        if (this.renderMode === 'wireframe_overlay') {
          const wireframeMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(this.wireframeColor),
            wireframe: true,
            transparent: true,
            opacity: 0.45
          });
          const wireMesh = new THREE.Mesh(child.geometry, wireframeMat);
          wireMesh.matrixAutoUpdate = false;
          wireMesh.matrix.copy(child.matrix);
          child.add(wireMesh);
          this.wireframeOverlays.push({ mesh: child, overlay: wireMesh });
        }
      }
    });
  }

  setShading(val, rootObject) {
    this.shading = val;
    if (rootObject) this.applyCurrentSettings(rootObject);
  }

  setReflection(val, rootObject) {
    this.reflection = val;
    if (rootObject) this.applyCurrentSettings(rootObject);
  }

  setSmoothing(val, rootObject) {
    this.smoothing = val;
    if (val && this.renderMode === 'flat') {
      this.renderMode = 'solid';
    } else if (!val && this.renderMode === 'solid') {
      this.renderMode = 'flat';
    }
    if (rootObject) this.applyCurrentSettings(rootObject);
  }

  setRenderMode(mode, rootObject) {
    this.renderMode = mode;
    if (mode === 'flat') {
      this.smoothing = false;
    } else if (mode === 'solid') {
      this.smoothing = true;
    }
    if (rootObject) this.applyCurrentSettings(rootObject);
  }

  setColor(hex, rootObject) {
    this.currentPreset = 'custom';
    this.currentColor = hex;
    if (rootObject) this.applyCurrentSettings(rootObject);
  }

  setPreset(presetId, rootObject) {
    this.currentPreset = presetId;
    if (presetId === 'original') {
      if (rootObject) this.applyCurrentSettings(rootObject);
      return;
    }

    const preset = COLOR_PRESETS.find(p => p.id === presetId);
    if (preset) {
      this.currentColor = preset.hex;
      if (rootObject) this.applyCurrentSettings(rootObject);
    }
  }
}
