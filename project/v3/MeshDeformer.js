/** @version v3 — exact SVG + local portal width taper */
/**
 * MeshDeformer (v3)
 * -----------------
 * Same as v2 (exact SVG mesh along path), but portal handling is different:
 *
 *   DO NOT collapse vertices toward a single point (that causes triangle fans).
 *
 *   Near each path portal, scale brush WIDTH → 0 with a smooth falloff
 *   over a configurable radius. Outside that radius, geometry is unchanged.
 *
 *   Vertices beyond the path are extrapolated along the end tangents so the
 *   mesh keeps its along-path spacing while width is already zero.
 */

import { evaluateAtDistance } from "./PathSampler.js";

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Smooth hermite falloff 0→1 */
function smootherstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / Math.max(edge1 - edge0, 1e-8));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Sample path at `dist`, extrapolating past the ends with endpoint tangents.
 * Never snaps many vertices onto one point.
 */
function sampleExtrapolated(sample, dist, outPos, outTan, outNor) {
  const pathLen = sample.totalLength;

  if (dist >= 0 && dist <= pathLen) {
    evaluateAtDistance(sample, dist, outPos, outTan, outNor);
    return;
  }

  if (dist < 0) {
    evaluateAtDistance(sample, 0, outPos, outTan, outNor);
    outPos.x += outTan.x * dist;
    outPos.y += outTan.y * dist;
    return;
  }

  evaluateAtDistance(sample, pathLen, outPos, outTan, outNor);
  const extra = dist - pathLen;
  outPos.x += outTan.x * extra;
  outPos.y += outTan.y * extra;
}

/**
 * Width scale from portal proximity only.
 * radius = wormholeSize * brushLength (configurable via control panel).
 */
function portalWidthScale(dist, pathLen, radius) {
  if (radius <= 1e-8) {
    // Hard portals: full width on path, zero outside — still no collapse
    if (dist < 0 || dist > pathLen) return 0;
    return 1;
  }

  let scale = 1;

  // Entrance portal (path start)
  if (dist <= 0) scale = 0;
  else if (dist < radius) scale = smootherstep(0, radius, dist);

  // Exit portal (path end)
  if (dist >= pathLen) scale = 0;
  else if (dist > pathLen - radius) {
    scale = Math.min(scale, smootherstep(0, radius, pathLen - dist));
  }

  return scale;
}

/**
 * @typedef {Object} DeformParamsV3
 * @property {number} progress
 * @property {number} brushLengthWorld
 * @property {number} svgScale
 * @property {number} pathScale
 * @property {number} wormholeSize  - portal taper radius as fraction of brush length
 */

export class MeshDeformer {
  constructor() {
    this._pos = { x: 0, y: 0 };
    this._tan = { x: 1, y: 0 };
    this._nor = { x: 0, y: 1 };
  }

  /**
   * @param {object} mesh
   * @param {object} pathSample
   * @param {Float32Array} outPositions
   * @param {Float32Array} outAlpha
   * @param {DeformParamsV3} params
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
    const radius =
      Math.min(Math.max(wormholeSize, 0), 0.49) * brushLen;

    const p = clamp01(progress);
    const headDist = p * (pathLen + brushLen);

    const { along01, lateral, vertexCount } = mesh;
    const thick = svgScale * pathScale;

    for (let i = 0; i < vertexCount; i++) {
      const u = along01[i];
      const dist = headDist - (1 - u) * brushLen;

      sampleExtrapolated(
        pathSample,
        dist,
        this._pos,
        this._tan,
        this._nor
      );

      // Localized width taper at portals ONLY — silhouette otherwise intact
      const widthScale = portalWidthScale(dist, pathLen, radius);
      const offset = lateral[i] * thick * widthScale;

      const o = i * 3;
      outPositions[o] = this._pos.x + this._nor.x * offset;
      outPositions[o + 1] = this._pos.y + this._nor.y * offset;
      outPositions[o + 2] = 0;

      // Alpha follows width for soft AA; geometry itself is never collapsed
      outAlpha[i] = widthScale > 0.001 ? 1 : 0;
    }
  }
}

export default MeshDeformer;
