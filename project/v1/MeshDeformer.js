/** @version v1 — ribbon/strip mesh engine (archived) */
/**
 * MeshDeformer
 * ------------
 * Moves brush-mesh vertices along a cached path sample.
 *
 * Rules:
 * - Brush length is FIXED (controlled by stretchWidth as a fraction of path length)
 * - Mesh does NOT stretch its silhouette — only its occupancy window moves
 * - Topology is never rebuilt
 * - Taper (wormhole) only affects the portions of the brush near path portals
 *
 * Progress model:
 *   progress 0 → brush emerging from start portal
 *   progress 1 → brush disappearing into end portal
 *
 *   headDist = progress * (pathLen + brushLen)
 *   vertexDist = headDist - (1 - along) * brushLen
 *     along=1 (head) → at headDist
 *     along=0 (tail) → at headDist - brushLen
 */

import { evaluateAtDistance } from "./PathSampler.js";

/** Smooth hermite step, 0→1 */
function smootherstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / Math.max(edge1 - edge0, 1e-8)));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * @typedef {Object} DeformParams
 * @property {number} progress       - [0..1]
 * @property {number} stretchWidth   - brush length as fraction of path total length
 * @property {number} pathScale      - thickness multiplier
 * @property {number} brushSizeWorld - base half-width in world/SVG units
 * @property {number} wormholeSize   - taper zone as fraction of brush length [0..0.5]
 * @property {number} meshHalfWidthRef - brush mesh maxHalfWidth (SVG units) for normalizing profile
 */

/**
 * Deform mesh positions into `outPositions` (Float32Array xyz or xy interleaved).
 * Allocates nothing — all scratch vectors are reused on the instance.
 */
export class MeshDeformer {
  constructor() {
    this._pos = { x: 0, y: 0 };
    this._tan = { x: 1, y: 0 };
    this._nor = { x: 0, y: 1 };
  }

  /**
   * @param {import('./MeshGenerator.js').BrushMesh} mesh
   * @param {import('./PathSampler.js').PathSample} pathSample
   * @param {Float32Array} outPositions  - length vertexCount*3 (xyz for OGL)
   * @param {DeformParams} params
   * @param {Float32Array} [outTaper]    - optional per-vertex taper [0..1] for debug
   */
  deform(mesh, pathSample, outPositions, params, outTaper = null) {
    const {
      progress,
      stretchWidth,
      pathScale,
      brushSizeWorld,
      wormholeSize,
      meshHalfWidthRef,
    } = params;

    const pathLen = pathSample.totalLength;
    const brushLen = Math.max(stretchWidth, 0.001) * pathLen;
    const worm = Math.min(Math.max(wormholeSize, 0), 0.49) * brushLen;

    // Head travels from 0 to pathLen+brushLen so the whole brush can enter & exit
    const p = Math.min(1, Math.max(0, progress));
    const headDist = p * (pathLen + brushLen);

    const { along, across, halfWidths, vertexCount } = mesh;
    const refHalf = Math.max(meshHalfWidthRef || mesh.maxHalfWidth, 1e-6);

    for (let i = 0; i < vertexCount; i++) {
      const a = along[i]; // 0=tail … 1=head
      const dist = headDist - (1 - a) * brushLen;

      // Portal taper based on distance along the PATH (wormhole at ends)
      let taper = 1;

      if (dist <= 0) {
        // Still inside start portal
        taper = 0;
      } else if (dist < worm) {
        taper = smootherstep(0, worm, dist);
      }

      if (dist >= pathLen) {
        taper = 0;
      } else if (dist > pathLen - worm) {
        taper *= smootherstep(0, worm, pathLen - dist);
      }

      // Soften mesh ends themselves (first/last portion of brush body)
      const endZone = Math.min(Math.max(wormholeSize, 0), 0.49);
      if (a < endZone) {
        taper *= smootherstep(0, endZone, a);
      } else if (a > 1 - endZone) {
        taper *= smootherstep(0, endZone, 1 - a);
      }

      // Clamp lookup onto path; off-path vertices collapse to portal mouth
      const lookup = dist < 0 ? 0 : dist > pathLen ? pathLen : dist;
      evaluateAtDistance(pathSample, lookup, this._pos, this._tan, this._nor);

      // Profile width: preserve brush silhouette ratios, scale by world size + pathScale
      const profile = halfWidths[i] / refHalf;
      const halfW = brushSizeWorld * pathScale * profile * taper;
      const offset = across[i] * halfW;

      const o = i * 3;
      outPositions[o] = this._pos.x + this._nor.x * offset;
      outPositions[o + 1] = this._pos.y + this._nor.y * offset;
      outPositions[o + 2] = 0;

      if (outTaper) outTaper[i] = taper;
    }
  }
}

export default MeshDeformer;
