import * as THREE from 'three';

export const MATERIAL_DENSITIES = {
  pla: { name: 'PLA (Polylactic Acid)', density: 1.24, unit: 'g/cm³' },
  abs: { name: 'ABS Plastic', density: 1.04, unit: 'g/cm³' },
  petg: { name: 'PETG', density: 1.27, unit: 'g/cm³' },
  tpu: { name: 'TPU (Flexible)', density: 1.21, unit: 'g/cm³' },
  resin: { name: 'Standard Resin', density: 1.15, unit: 'g/cm³' },
  nylon: { name: 'Nylon (PA12)', density: 1.14, unit: 'g/cm³' },
  aluminum: { name: 'Aluminum (6061)', density: 2.70, unit: 'g/cm³' },
  steel: { name: 'Stainless Steel', density: 7.85, unit: 'g/cm³' },
  gold: { name: 'Gold (24K)', density: 19.32, unit: 'g/cm³' },
  custom: { name: 'Custom Density', density: 1.00, unit: 'g/cm³' }
};

export function analyzeModel(rootObject) {
  let totalTriangles = 0;
  let totalVertices = 0;
  let totalSurfaceArea = 0;
  let totalVolume = 0;
  let isWatertight = true;
  let openEdgesCount = 0;

  const edgeMap = new Map(); // key -> count of sharing faces

  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const edge1 = new THREE.Vector3();
  const edge2 = new THREE.Vector3();
  const cross = new THREE.Vector3();

  rootObject.updateMatrixWorld(true);

  rootObject.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;

    let geometry = child.geometry;
    if (!geometry.attributes.position) return;

    const pos = geometry.attributes.position;
    const index = geometry.index;
    const worldMatrix = child.matrixWorld;

    const meshVertexCount = pos.count;
    totalVertices += meshVertexCount;

    const faceCount = index ? index.count / 3 : pos.count / 3;
    totalTriangles += Math.floor(faceCount);

    let signedVolume = 0;
    let surfaceArea = 0;

    const getVertex = (i, target) => {
      target.fromBufferAttribute(pos, i);
      target.applyMatrix4(worldMatrix);
    };

    const addEdge = (idx1, idx2) => {
      // undirected canonical edge key
      const key = idx1 < idx2 ? `${idx1}_${idx2}` : `${idx2}_${idx1}`;
      edgeMap.set(key, (edgeMap.get(key) || 0) + 1);
    };

    for (let f = 0; f < faceCount; f++) {
      let iA, iB, iC;
      if (index) {
        iA = index.getX(f * 3);
        iB = index.getX(f * 3 + 1);
        iC = index.getX(f * 3 + 2);
      } else {
        iA = f * 3;
        iB = f * 3 + 1;
        iC = f * 3 + 2;
      }

      getVertex(iA, vA);
      getVertex(iB, vB);
      getVertex(iC, vC);

      // Area of triangle: 0.5 * |(vB - vA) x (vC - vA)|
      edge1.subVectors(vB, vA);
      edge2.subVectors(vC, vA);
      cross.crossVectors(edge1, edge2);
      surfaceArea += 0.5 * cross.length();

      // Signed volume of tetrahedron: 1/6 * (vA . (vB x vC))
      cross.crossVectors(vB, vC);
      signedVolume += (1.0 / 6.0) * vA.dot(cross);

      // Watertight check (edge sharing)
      addEdge(iA, iB);
      addEdge(iB, iC);
      addEdge(iC, iA);
    }

    totalSurfaceArea += surfaceArea;
    totalVolume += Math.abs(signedVolume);
  });

  // Evaluate watertightness: In a closed 2-manifold, every edge must belong to exactly 2 triangles
  for (const count of edgeMap.values()) {
    if (count !== 2) {
      openEdgesCount++;
      isWatertight = false;
    }
  }

  // Calculate overall bounding box
  const box = new THREE.Box3().setFromObject(rootObject);
  const size = new THREE.Vector3();
  box.getSize(size);

  const center = new THREE.Vector3();
  box.getCenter(center);

  // Default unit assumption: Three.js coordinates in mm
  // Volume in mm3 -> cm3 is divide by 1000
  // Surface area in mm2 -> cm2 is divide by 100
  const volumeMm3 = totalVolume;
  const volumeCm3 = totalVolume / 1000.0;
  const surfaceAreaMm2 = totalSurfaceArea;
  const surfaceAreaCm2 = totalSurfaceArea / 100.0;

  return {
    triangles: totalTriangles,
    vertices: totalVertices,
    dimensions: {
      x: size.x,
      y: size.y,
      z: size.z,
      width: size.x,
      height: size.y,
      depth: size.z
    },
    boundingBox: box,
    center: center,
    surfaceAreaMm2,
    surfaceAreaCm2,
    volumeMm3,
    volumeCm3,
    isWatertight,
    openEdgesCount
  };
}

export function calculateEstimatedWeight(volumeCm3, densityGramsPerCm3, infillPercent = 100) {
  // Approximate effective volume based on shell thickness and infill
  // For solid object (100% infill):
  const infillRatio = Math.max(0, Math.min(100, infillPercent)) / 100.0;
  // Realistic estimate: 20% shell walls + 80% interior at infill ratio
  const effectiveRatio = infillRatio === 1 ? 1 : 0.25 + 0.75 * infillRatio;
  const massGrams = volumeCm3 * densityGramsPerCm3 * effectiveRatio;
  return massGrams;
}
