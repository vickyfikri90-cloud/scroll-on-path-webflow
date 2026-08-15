/** @version v6 — texture ribbon deformer + live portal taper */
/**
 * MeshDeformer (v6)
 * -----------------
 * Warps a textured ribbon along a cached path (sticker-on-wire).
 * No vertex collapse — portal taper only scales WIDTH.
 *
 * Live taper uniforms/params (no mesh / texture rebuild):
 *   portalRadius, taperLength, minimumScale, falloff, easing,
 *   frontPortalEnabled, backPortalEnabled
 */

import { evaluateAtDistance } from "./PathSampler.js";

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function clamp(x, a, b) {
  return x < a ? a : x > b ? b : x;
}

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

export const DEFAULT_TAPER = {
  portalRadius: 0.14,
  taperLength: 0.14,
  minimumScale: 0,
  falloff: 1,
  easing: "smootherstep",
  frontPortalEnabled: true,
  backPortalEnabled: true,
};

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

function taperFromPortal(distFromPortal, falloffLen, taper) {
  const ease = EASING_FNS[taper.easing] || EASING_FNS.smootherstep;
  const minS = clamp(taper.minimumScale, 0, 1);
  const falloff = Math.max(0.05, taper.falloff ?? 1);

  if (distFromPortal <= 0) return minS;
  if (falloffLen <= 1e-8 || distFromPortal >= falloffLen) return 1;

  let t = ease(clamp01(distFromPortal / falloffLen));
  // falloff > 1 = sharper late rise; < 1 = gentler
  t = Math.pow(t, falloff);
  return clamp(minS + (1 - minS) * t, 0, 1);
}

export function computeWidthScale(dist, pathLen, brushLen, taper) {
  const portalRadius = Math.max(0, taper.portalRadius) * brushLen;
  const taperLength = Math.max(0, taper.taperLength) * brushLen;
  const falloffLen = Math.min(
    taperLength > 0 ? taperLength : portalRadius,
    portalRadius > 0 ? portalRadius : taperLength
  );

  const back = taper.backPortalEnabled ?? taper.backTaper ?? true;
  const front = taper.frontPortalEnabled ?? taper.frontTaper ?? true;

  if (dist < 0) return back ? clamp(taper.minimumScale, 0, 1) : 1;
  if (dist > pathLen) return front ? clamp(taper.minimumScale, 0, 1) : 1;

  let scale = 1;
  if (back && falloffLen > 0) {
    scale = Math.min(scale, taperFromPortal(dist, falloffLen, taper));
  }
  if (front && falloffLen > 0) {
    scale = Math.min(scale, taperFromPortal(pathLen - dist, falloffLen, taper));
  }
  return scale;
}

export class MeshDeformer {
  constructor() {
    this._pos = { x: 0, y: 0 };
    this._tan = { x: 1, y: 0 };
    this._nor = { x: 0, y: 1 };
  }

  /**
   * @param {object} ribbon  from createRibbonMesh
   * @param {object} pathSample
   * @param {Float32Array} outPositions
   * @param {Float32Array} outAlpha
   * @param {object} params
   */
  deform(ribbon, pathSample, outPositions, outAlpha, params) {
    const pathLen = pathSample.totalLength;
    const brushLen = Math.max(params.brushLengthWorld, 1e-6);
    const halfWidth = Math.max(params.halfWidthWorld, 1e-6);
    const p = clamp01(params.progress);
    const headDist = p * (pathLen + brushLen);

    const taper = {
      portalRadius: params.portalRadius ?? DEFAULT_TAPER.portalRadius,
      taperLength: params.taperLength ?? DEFAULT_TAPER.taperLength,
      minimumScale: params.minimumScale ?? DEFAULT_TAPER.minimumScale,
      falloff: params.falloff ?? DEFAULT_TAPER.falloff,
      easing: params.easing ?? DEFAULT_TAPER.easing,
      frontPortalEnabled:
        params.frontPortalEnabled ?? params.frontTaper ?? true,
      backPortalEnabled: params.backPortalEnabled ?? params.backTaper ?? true,
    };

    const along = ribbon.along01 || ribbon.localAlong;
    const across = ribbon.across || ribbon.localAcross;
    const n = ribbon.vertexCount;

    for (let i = 0; i < n; i++) {
      const u = along[i];
      const dist = headDist - (1 - u) * brushLen;

      sampleExtrapolated(pathSample, dist, this._pos, this._tan, this._nor);

      const widthScale = computeWidthScale(dist, pathLen, brushLen, taper);
      const offset = across[i] * halfWidth * widthScale;

      const o = i * 3;
      outPositions[o] = this._pos.x + this._nor.x * offset;
      outPositions[o + 1] = this._pos.y + this._nor.y * offset;
      outPositions[o + 2] = 0;
      outAlpha[i] = widthScale > 0.001 ? 1 : 0;
    }
  }
}

export default MeshDeformer;
