/** @version v4 — adaptive frames + live portal taper params */
/**
 * MeshDeformer (v4)
 * -----------------
 * Exact SVG mesh along path (no vertex collapse).
 *
 * Portal taper is fully parameterized and live-tunable (no mesh rebuild):
 *   portalRadius, taperLength, taperStrength, minimumScale, easing,
 *   frontTaper, backTaper
 *
 * Orientation comes from the path sample (stabilized Frenet in v4).
 */

import { evaluateAtDistance } from "./PathSampler.js";

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function clamp(x, a, b) {
  return x < a ? a : x > b ? b : x;
}

/** @type {Record<string, (t:number)=>number>} */
export const EASING_FNS = {
  linear: (t) => t,
  smoothstep: (t) => t * t * (3 - 2 * t),
  smootherstep: (t) => t * t * t * (t * (t * 6 - 15) + 10),
  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => 1 - (1 - t) * (1 - t),
  easeInOutCubic: (t) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  easeOutExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
};

export const EASING_OPTIONS = Object.keys(EASING_FNS);

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
 * Width scale near one portal mouth.
 * @param {number} distFromPortal  0 at mouth, increasing away from portal along path
 * @param {number} falloffLen
 * @param {object} taper
 */
function taperFromPortal(distFromPortal, falloffLen, taper) {
  const ease = EASING_FNS[taper.easing] || EASING_FNS.smootherstep;
  const minS = clamp(taper.minimumScale, 0, 1);
  const strength = clamp(taper.taperStrength, 0, 2);

  if (distFromPortal <= 0) {
    return minS;
  }
  if (falloffLen <= 1e-8 || distFromPortal >= falloffLen) {
    return 1;
  }

  const t = ease(clamp01(distFromPortal / falloffLen));
  // Raw blend from minimumScale → 1
  let scale = minS + (1 - minS) * t;
  // Strength: 0 = no taper (always 1), 1 = full curve, >1 = extra pinch
  scale = 1 - strength * (1 - scale);
  return clamp(scale, 0, 1);
}

/**
 * Combine front/back portal tapers.
 */
export function computeWidthScale(dist, pathLen, brushLen, taper) {
  const portalRadius = Math.max(0, taper.portalRadius) * brushLen;
  const taperLength = Math.max(0, taper.taperLength) * brushLen;
  // Falloff length cannot exceed portal influence radius
  const falloff = Math.min(
    taperLength > 0 ? taperLength : portalRadius,
    portalRadius > 0 ? portalRadius : taperLength
  );

  let scale = 1;

  // Outside the path: fully inside portals
  if (dist < 0) {
    return taper.backTaper ? clamp(taper.minimumScale, 0, 1) : 1;
  }
  if (dist > pathLen) {
    return taper.frontTaper ? clamp(taper.minimumScale, 0, 1) : 1;
  }

  if (taper.backTaper && falloff > 0) {
    scale = Math.min(scale, taperFromPortal(dist, falloff, taper));
  }
  if (taper.frontTaper && falloff > 0) {
    scale = Math.min(scale, taperFromPortal(pathLen - dist, falloff, taper));
  }

  return scale;
}

export const DEFAULT_TAPER = {
  portalRadius: 0.14,
  taperLength: 0.14,
  taperStrength: 1,
  minimumScale: 0,
  easing: "smootherstep",
  frontTaper: true,
  backTaper: true,
};

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
   * @param {object} params
   */
  deform(mesh, pathSample, outPositions, outAlpha, params) {
    const {
      progress,
      brushLengthWorld,
      svgScale,
      pathScale,
      portalRadius = DEFAULT_TAPER.portalRadius,
      taperLength = DEFAULT_TAPER.taperLength,
      taperStrength = DEFAULT_TAPER.taperStrength,
      minimumScale = DEFAULT_TAPER.minimumScale,
      easing = DEFAULT_TAPER.easing,
      frontTaper = DEFAULT_TAPER.frontTaper,
      backTaper = DEFAULT_TAPER.backTaper,
    } = params;

    const pathLen = pathSample.totalLength;
    const brushLen = Math.max(brushLengthWorld, 1e-6);
    const p = clamp01(progress);
    const headDist = p * (pathLen + brushLen);

    const taper = {
      portalRadius,
      taperLength,
      taperStrength,
      minimumScale,
      easing,
      frontTaper: !!frontTaper,
      backTaper: !!backTaper,
    };

    const { along01, lateral, vertexCount } = mesh;
    const thick = svgScale * pathScale;

    for (let i = 0; i < vertexCount; i++) {
      const u = along01[i];
      const dist = headDist - (1 - u) * brushLen;

      sampleExtrapolated(pathSample, dist, this._pos, this._tan, this._nor);

      const widthScale = computeWidthScale(dist, pathLen, brushLen, taper);
      const offset = lateral[i] * thick * widthScale;

      const o = i * 3;
      outPositions[o] = this._pos.x + this._nor.x * offset;
      outPositions[o + 1] = this._pos.y + this._nor.y * offset;
      outPositions[o + 2] = 0;

      outAlpha[i] = widthScale > 0.001 ? 1 : 0;
    }
  }
}

export default MeshDeformer;
