/** @version v2 — exact SVG tessellation engine */
/**
 * MeshDeformer
 * ------------
 * Bends the tessellated brush along a cached path WITHOUT changing its shape.
 *
 * - Length is fixed (from SVG proportions × uniform scale)
 * - No stretch, no reveal, no ribbon growth
 * - Wormholes live on the PATH (start & end only)
 * - Vertices whose arc-distance falls outside [0, pathLen] are clipped
 *   (hidden inside the portal) — the brush silhouette itself is never tapered
 */

import { evaluateAtDistance } from "./PathSampler.js";

/**
 * @typedef {Object} DeformParamsV2
 * @property {number} progress
 * @property {number} brushLengthWorld  - fixed arc length the brush occupies
 * @property {number} svgScale          - SVG units → path/world units (uniform)
 * @property {number} pathScale         - thickness multiplier (lateral only)
 * @property {number} wormholeSize      - soft portal fade as fraction of brush length
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
   * @param {Float32Array} outPositions  xyz
   * @param {Float32Array} outAlpha      per-vertex visibility [0..1]
   * @param {DeformParamsV2} params
   */
  deform(mesh, pathSample, outPositions, outAlpha, params) {
    const {
      progress,
      brushLengthWorld,
      svgScale,
      pathScale,
      wormholeSize,
    } = params;

    const pathLen = pathSample.totalLength;
    const brushLen = Math.max(brushLengthWorld, 1e-6);
    // Soft edge only at path portals (not a brush reshape)
    const portalFade = Math.min(Math.max(wormholeSize, 0), 0.49) * brushLen;

    const p = Math.min(1, Math.max(0, progress));
    // Head travels pathLen+brushLen so the brush can fully enter & fully exit
    const headDist = p * (pathLen + brushLen);

    const { along01, lateral, vertexCount } = mesh;
    const thick = svgScale * pathScale;

    for (let i = 0; i < vertexCount; i++) {
      const u = along01[i]; // 0=tail … 1=head
      const dist = headDist - (1 - u) * brushLen;

      // Portal clip — outside the path is inside a wormhole (hidden)
      let alpha = 1;
      if (dist < 0 || dist > pathLen) {
        alpha = 0;
      } else if (portalFade > 1e-6) {
        if (dist < portalFade) alpha = dist / portalFade;
        if (dist > pathLen - portalFade) {
          alpha = Math.min(alpha, (pathLen - dist) / portalFade);
        }
      }

      const lookup = dist < 0 ? 0 : dist > pathLen ? pathLen : dist;
      evaluateAtDistance(pathSample, lookup, this._pos, this._tan, this._nor);

      // Preserve original lateral offset from SVG (no profile rebuild)
      const offset = lateral[i] * thick;

      const o = i * 3;
      if (alpha <= 0) {
        // Collapse to portal mouth — zero-area contribution when clipped
        outPositions[o] = this._pos.x;
        outPositions[o + 1] = this._pos.y;
        outPositions[o + 2] = 0;
      } else {
        outPositions[o] = this._pos.x + this._nor.x * offset;
        outPositions[o + 1] = this._pos.y + this._nor.y * offset;
        outPositions[o + 2] = 0;
      }

      outAlpha[i] = alpha;
    }
  }
}

export default MeshDeformer;
