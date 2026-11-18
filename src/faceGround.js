import * as THREE from 'three';

export class FaceGroundTool {
  constructor(scene, camera, domElement, getModelGroup, onGroundComplete) {
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;
    this.getModelGroup = getModelGroup;
    this.onGroundComplete = onGroundComplete;

    this.active = false;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Visual Helpers for hover
    this.helperGroup = new THREE.Group();
    this.helperGroup.name = 'FaceGroundHelperGroup';
    this.scene.add(this.helperGroup);

    // Triangle highlight mesh
    const triGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(9);
    triGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.triMaterial = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.65,
      depthTest: false
    });
    this.triMesh = new THREE.Mesh(triGeo, this.triMaterial);
    this.triMesh.visible = false;
    this.helperGroup.add(this.triMesh);

    // Triangle edges wireframe
    this.triWireMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      linewidth: 2,
      depthTest: false,
      transparent: true,
      opacity: 0.9
    });
    this.triWire = new THREE.LineLoop(triGeo.clone(), this.triWireMaterial);
    this.triWire.visible = false;
    this.helperGroup.add(this.triWire);

    // Normal arrow helper
    this.normalArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(),
      15,
      0x22c55e,
      4,
      2
    );
    this.normalArrow.visible = false;
    this.helperGroup.add(this.normalArrow);

    // Current hovered face data
    this.hoveredHit = null;

    // Animation state
    this.animating = false;
    this.animStartTime = 0;
    this.animDuration = 350;
    this.startQuat = new THREE.Quaternion();
    this.targetQuat = new THREE.Quaternion();
    this.startPos = new THREE.Vector3();
    this.targetPos = new THREE.Vector3();

    // Bind event handlers
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
  }

  setActive(active) {
    if (this.active === active) return;
    this.active = active;

    if (active) {
      this.domElement.addEventListener('pointermove', this.onPointerMove);
      this.domElement.addEventListener('pointerdown', this.onPointerDown);
      window.addEventListener('keydown', this.onKeyDown);
      this.domElement.style.cursor = 'crosshair';
    } else {
      this.domElement.removeEventListener('pointermove', this.onPointerMove);
      this.domElement.removeEventListener('pointerdown', this.onPointerDown);
      window.removeEventListener('keydown', this.onKeyDown);
      this.domElement.style.cursor = 'default';
      this.hideHelpers();
    }
  }

  hideHelpers() {
    this.triMesh.visible = false;
    this.triWire.visible = false;
    this.normalArrow.visible = false;
    this.hoveredHit = null;
  }

  onKeyDown(e) {
    if (e.key === 'Escape' && this.active) {
      this.setActive(false);
      if (this.onGroundComplete) {
        this.onGroundComplete({ cancelled: true });
      }
    }
  }

  getIntersection(e) {
    const rect = this.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const modelGroup = this.getModelGroup();
    if (!modelGroup) return null;

    const meshes = [];
    modelGroup.traverse((child) => {
      if (child.isMesh && child.visible) {
        meshes.push(child);
      }
    });

    const intersects = this.raycaster.intersectObjects(meshes, true);
    return intersects.length > 0 ? intersects[0] : null;
  }

  onPointerMove(e) {
    if (!this.active || this.animating) return;

    const hit = this.getIntersection(e);
    if (!hit || !hit.face) {
      this.hideHelpers();
      return;
    }

    this.hoveredHit = hit;
    const mesh = hit.object;
    const geom = mesh.geometry;
    const posAttr = geom.attributes.position;

    // Get 3 vertices of the face in world coordinates
    const vA = new THREE.Vector3();
    const vB = new THREE.Vector3();
    const vC = new THREE.Vector3();

    vA.fromBufferAttribute(posAttr, hit.face.a).applyMatrix4(mesh.matrixWorld);
    vB.fromBufferAttribute(posAttr, hit.face.b).applyMatrix4(mesh.matrixWorld);
    vC.fromBufferAttribute(posAttr, hit.face.c).applyMatrix4(mesh.matrixWorld);

    // Update triangle vertices
    const positions = new Float32Array([
      vA.x, vA.y, vA.z,
      vB.x, vB.y, vB.z,
      vC.x, vC.y, vC.z
    ]);

    this.triMesh.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.triMesh.geometry.computeVertexNormals();
    this.triMesh.visible = true;

    this.triWire.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.triWire.visible = true;

    // Calculate world normal
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    const worldNormal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();

    // Center of triangle
    const faceCenter = new THREE.Vector3()
      .addVectors(vA, vB)
      .add(vC)
      .divideScalar(3);

    // Scale arrow according to model size
    const box = new THREE.Box3().setFromObject(this.getModelGroup());
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z) || 50;
    const arrowLength = Math.max(10, maxDim * 0.15);

    this.normalArrow.position.copy(faceCenter);
    this.normalArrow.setDirection(worldNormal);
    this.normalArrow.setLength(arrowLength, arrowLength * 0.3, arrowLength * 0.15);
    this.normalArrow.visible = true;
  }

  onPointerDown(e) {
    if (!this.active || this.animating || e.button !== 0) return;

    const hit = this.getIntersection(e);
    if (!hit || !hit.face) return;

    this.groundModelToFace(hit);
  }

  groundModelToFace(hit) {
    const modelGroup = this.getModelGroup();
    if (!modelGroup) return;

    const mesh = hit.object;
    // Calculate world normal of the selected face
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    const worldNormal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();

    // We want the face normal to point DOWN (-Y) so the selected face rests flat against the ground plane
    const down = new THREE.Vector3(0, -1, 0);
    const rotationQuat = new THREE.Quaternion().setFromUnitVectors(worldNormal, down);

    // Compute target transformation
    this.startQuat.copy(modelGroup.quaternion);
    this.startPos.copy(modelGroup.position);

    // Clone modelGroup to compute final aligned position
    const tempGroup = new THREE.Group();
    tempGroup.quaternion.copy(modelGroup.quaternion).premultiply(rotationQuat);
    tempGroup.position.copy(modelGroup.position);

    // Attach children temporarily or compute bounding box mathematically
    // In Three.js, applying rotation around origin:
    const targetQ = modelGroup.quaternion.clone().premultiply(rotationQuat);

    // To find target position: apply rotation to modelGroup momentarily
    modelGroup.quaternion.copy(targetQ);
    modelGroup.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(modelGroup);
    const center = new THREE.Vector3();
    box.getCenter(center);

    const targetP = new THREE.Vector3(
      modelGroup.position.x - center.x,
      modelGroup.position.y - box.min.y,
      modelGroup.position.z - center.z
    );

    // Restore start position & quaternion for smooth animation
    modelGroup.quaternion.copy(this.startQuat);
    modelGroup.position.copy(this.startPos);
    modelGroup.updateMatrixWorld(true);

    this.targetQuat.copy(targetQ);
    this.targetPos.copy(targetP);

    this.hideHelpers();
    this.animating = true;
    this.animStartTime = performance.now();
  }

  update(time) {
    if (!this.animating) return;

    const elapsed = time - this.animStartTime;
    const progress = Math.min(1, elapsed / this.animDuration);
    // Smooth ease out cubic
    const ease = 1 - Math.pow(1 - progress, 3);

    const modelGroup = this.getModelGroup();
    if (!modelGroup) {
      this.animating = false;
      return;
    }

    modelGroup.quaternion.slerpQuaternions(this.startQuat, this.targetQuat, ease);
    modelGroup.position.lerpVectors(this.startPos, this.targetPos, ease);
    modelGroup.updateMatrixWorld(true);

    if (progress >= 1) {
      modelGroup.quaternion.copy(this.targetQuat);
      modelGroup.position.copy(this.targetPos);
      modelGroup.updateMatrixWorld(true);
      this.animating = false;
      this.setActive(false);
      if (this.onGroundComplete) {
        this.onGroundComplete({ cancelled: false, modelGroup });
      }
    }
  }

  destroy() {
    this.setActive(false);
    this.scene.remove(this.helperGroup);
  }
}
