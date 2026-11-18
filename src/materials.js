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
    this.metalness = 0.3;
    this.roughness = 0.4;
    this.opacity = 1.0;
    this.doubleSided = true;
    this.wireframeColor = '#38bdf8';
    this.pointSize = 3.0;

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

  applyCurrentSettings(rootObject, clippingPlanes = []) {
    this.clearOverlays();

    rootObject.traverse((child) => {
      if (!child.isMesh) return;

      const side = this.doubleSided ? THREE.DoubleSide : THREE.FrontSide;

      if (this.renderMode === 'normals') {
        child.visible = true;
        child.material = new THREE.MeshNormalMaterial({
          side,
          clippingPlanes,
          clipShadows: true
        });
      } else if (this.renderMode === 'wireframe_only') {
        child.visible = true;
        child.material = new THREE.MeshBasicMaterial({
          color: new THREE.Color(this.currentColor === 'original' ? '#38bdf8' : this.currentColor),
          wireframe: true,
          clippingPlanes
        });
      } else if (this.renderMode === 'points') {
        child.visible = false;
        const pointsMat = new THREE.PointsMaterial({
          color: new THREE.Color(this.currentColor === 'original' ? '#38bdf8' : this.currentColor),
          size: this.pointSize,
          sizeAttenuation: true,
          clippingPlanes
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
          roughness: 0.1,
          metalness: 0.1,
          side: THREE.DoubleSide,
          depthWrite: false,
          clippingPlanes
        });
      } else {
        // Solid or Flat or Wireframe Overlay
        child.visible = true;

        if (this.currentPreset === 'original' && this.originalMaterialsMap.has(child)) {
          // Use authentic original GLTF/GLB materials & textures
          const orig = this.originalMaterialsMap.get(child);
          if (Array.isArray(orig)) {
            child.material = orig.map(m => {
              const clone = m.clone();
              clone.clippingPlanes = clippingPlanes;
              clone.clipShadows = true;
              clone.side = side;
              if (this.renderMode === 'flat') clone.flatShading = true;
              clone.needsUpdate = true;
              return clone;
            });
          } else {
            const clone = orig.clone();
            clone.clippingPlanes = clippingPlanes;
            clone.clipShadows = true;
            clone.side = side;
            if (this.renderMode === 'flat') clone.flatShading = true;
            clone.needsUpdate = true;
            child.material = clone;
          }
        } else {
          // User selected custom monochrome color or preset
          const mat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(this.currentColor),
            roughness: this.roughness,
            metalness: this.metalness,
            flatShading: this.renderMode === 'flat',
            side,
            clippingPlanes,
            clipShadows: true
          });
          child.material = mat;
        }

        if (this.renderMode === 'wireframe_overlay') {
          // Add wireframe overlay over existing material
          const wireframeMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(this.wireframeColor),
            wireframe: true,
            transparent: true,
            opacity: 0.45,
            clippingPlanes
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

  setRenderMode(mode, rootObject, clippingPlanes) {
    this.renderMode = mode;
    if (rootObject) this.applyCurrentSettings(rootObject, clippingPlanes);
  }

  setColor(hex, rootObject, clippingPlanes) {
    this.currentPreset = 'custom';
    this.currentColor = hex;
    if (rootObject) this.applyCurrentSettings(rootObject, clippingPlanes);
  }

  setPreset(presetId, rootObject, clippingPlanes) {
    this.currentPreset = presetId;
    if (presetId === 'original') {
      if (rootObject) this.applyCurrentSettings(rootObject, clippingPlanes);
      return;
    }

    const preset = COLOR_PRESETS.find(p => p.id === presetId);
    if (preset) {
      this.currentColor = preset.hex;
      this.metalness = preset.metalness;
      this.roughness = preset.roughness;
      if (rootObject) this.applyCurrentSettings(rootObject, clippingPlanes);
    }
  }

  setRoughness(val, rootObject, clippingPlanes) {
    this.roughness = val;
    if (rootObject) this.applyCurrentSettings(rootObject, clippingPlanes);
  }

  setMetalness(val, rootObject, clippingPlanes) {
    this.metalness = val;
    if (rootObject) this.applyCurrentSettings(rootObject, clippingPlanes);
  }

  setDoubleSided(val, rootObject, clippingPlanes) {
    this.doubleSided = val;
    if (rootObject) this.applyCurrentSettings(rootObject, clippingPlanes);
  }
}
