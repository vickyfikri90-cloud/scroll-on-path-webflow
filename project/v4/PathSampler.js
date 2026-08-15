/** @version v4 — adaptive sampling + flip-stabilized Frenet frames */
/**
 * PathSampler (v4)
 * ----------------
 * Issues on sharp corners are often caused by:
 *   1) sparse uniform samples across high curvature
 *   2) Frenet normals that flip when curvature sign changes
 *
 * This sampler:
 *   - adaptively densifies samples near sharp turns
 *   - builds left normals from tangents
 *   - stabilizes consecutive normals (prevents 180° flips)
 *
 * Expensive work runs once at init / path reload.
 */

const DEFAULT_BASE_SAMPLES = 256;
const DEFAULT_MAX_SAMPLES = 2048;
const DEFAULT_ANGLE_THRESH_DEG = 6;

async function loadSvgText(source) {
  if (source instanceof File) return source.text();
  const res = await fetch(source);
  if (!res.ok) throw new Error(`Failed to load path SVG: ${source} (${res.status})`);
  return res.text();
}

function parseSvgPath(svgText) {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svg = doc.querySelector("svg");
  const pathEl = doc.querySelector("path");
  if (!pathEl) throw new Error("PathSampler: no <path> found in SVG");
  const d = pathEl.getAttribute("d");
  if (!d) throw new Error("PathSampler: path has empty `d`");
  const viewBox =
    svg?.getAttribute("viewBox") ||
    `0 0 ${svg?.getAttribute("width") || 100} ${svg?.getAttribute("height") || 100}`;
  return { d, viewBox };
}

function createMeasurablePath(d, viewBox) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", viewBox);
  svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;";
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", d);
  svg.appendChild(path);
  document.body.appendChild(svg);
  return { svg, path };
}

function tangentAt(path, dist, totalLength, epsilon) {
  const d0 = Math.max(0, dist - epsilon);
  const d1 = Math.min(totalLength, dist + epsilon);
  const p0 = path.getPointAtLength(d0);
  const p1 = path.getPointAtLength(d1);
  let tx = p1.x - p0.x;
  let ty = p1.y - p0.y;
  const len = Math.hypot(tx, ty) || 1;
  return { x: tx / len, y: ty / len };
}

/**
 * Adaptive arc-length distances: denser where the path turns sharply.
 */
function buildAdaptiveDistances(path, totalLength, options) {
  const baseSamples = Math.max(16, options.baseSamples ?? DEFAULT_BASE_SAMPLES);
  const maxSamples = Math.max(baseSamples, options.maxSamples ?? DEFAULT_MAX_SAMPLES);
  const angleThresh =
    ((options.angleThreshDeg ?? DEFAULT_ANGLE_THRESH_DEG) * Math.PI) / 180;
  const minStep = totalLength / maxSamples;
  const epsilon = Math.max(totalLength * 1e-4, 0.01);

  let distances = new Array(baseSamples + 1);
  for (let i = 0; i <= baseSamples; i++) {
    distances[i] = (i / baseSamples) * totalLength;
  }

  // Iteratively split segments that bend too much
  for (let pass = 0; pass < 6; pass++) {
    if (distances.length >= maxSamples + 1) break;
    const next = [distances[0]];
    let splitAny = false;

    for (let i = 0; i < distances.length - 1; i++) {
      const d0 = distances[i];
      const d1 = distances[i + 1];
      const t0 = tangentAt(path, d0, totalLength, epsilon);
      const t1 = tangentAt(path, d1, totalLength, epsilon);
      const dot = Math.max(-1, Math.min(1, t0.x * t1.x + t0.y * t1.y));
      const ang = Math.acos(dot);
      const span = d1 - d0;

      if (ang > angleThresh && span > minStep * 1.01 && next.length < maxSamples) {
        next.push((d0 + d1) * 0.5);
        splitAny = true;
      }
      next.push(d1);
    }

    distances = next;
    if (!splitAny) break;
  }

  // Ensure exact endpoints
  distances[0] = 0;
  distances[distances.length - 1] = totalLength;
  return distances;
}

/**
 * Left normal from tangent, then flip-stabilize along the chain (Frenet fix).
 */
function buildStabilizedFrames(path, distances, totalLength) {
  const count = distances.length;
  const positions = new Float32Array(count * 2);
  const tangents = new Float32Array(count * 2);
  const normals = new Float32Array(count * 2);
  const distArr = new Float32Array(count);
  const epsilon = Math.max(totalLength * 1e-4, 0.01);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < count; i++) {
    const dist = distances[i];
    const pt = path.getPointAtLength(dist);
    const tan = tangentAt(path, dist, totalLength, epsilon);

    // Raw Frenet-style left normal
    let nx = -tan.y;
    let ny = tan.x;

    // Flip-stabilize against previous normal (prevents sudden 180° flips)
    if (i > 0) {
      const px = normals[(i - 1) * 2];
      const py = normals[(i - 1) * 2 + 1];
      if (px * nx + py * ny < 0) {
        nx = -nx;
        ny = -ny;
      }
    }

    const oi = i * 2;
    positions[oi] = pt.x;
    positions[oi + 1] = pt.y;
    tangents[oi] = tan.x;
    tangents[oi + 1] = tan.y;
    normals[oi] = nx;
    normals[oi + 1] = ny;
    distArr[i] = dist;

    minX = Math.min(minX, pt.x);
    minY = Math.min(minY, pt.y);
    maxX = Math.max(maxX, pt.x);
    maxY = Math.max(maxY, pt.y);
  }

  return {
    positions,
    tangents,
    normals,
    distances: distArr,
    count,
    totalLength,
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    frameMode: "frenet-stabilized",
  };
}

/**
 * @param {string|File} source
 * @param {{samples?: number, baseSamples?: number, maxSamples?: number, angleThreshDeg?: number}} [options]
 */
export async function samplePath(source, options = {}) {
  const svgText = await loadSvgText(source);
  const { d, viewBox } = parseSvgPath(svgText);
  const { svg, path } = createMeasurablePath(d, viewBox);

  try {
    const totalLength = path.getTotalLength();
    if (!(totalLength > 0)) throw new Error("PathSampler: path total length is zero");

    // `samples` from UI maps to max adaptive density
    const maxSamples = Math.max(64, options.maxSamples ?? options.samples ?? DEFAULT_MAX_SAMPLES);
    const baseSamples = Math.min(
      maxSamples,
      Math.max(32, options.baseSamples ?? DEFAULT_BASE_SAMPLES)
    );

    const distances = buildAdaptiveDistances(path, totalLength, {
      baseSamples,
      maxSamples,
      angleThreshDeg: options.angleThreshDeg,
    });

    const sample = buildStabilizedFrames(path, distances, totalLength);
    sample.viewBox = viewBox;
    return sample;
  } finally {
    svg.remove();
  }
}

export function evaluateAtDistance(sample, distance, outPos, outTan, outNor) {
  const { distances, positions, tangents, normals, count, totalLength } = sample;
  const d = distance < 0 ? 0 : distance > totalLength ? totalLength : distance;

  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (distances[mid] < d) lo = mid + 1;
    else hi = mid;
  }

  const i1 = lo;
  const i0 = Math.max(0, i1 - 1);
  const d0 = distances[i0];
  const d1 = distances[i1];
  const span = d1 - d0;
  const u = span > 1e-8 ? (d - d0) / span : 0;
  const a0 = i0 * 2;
  const a1 = i1 * 2;

  outPos.x = positions[a0] + (positions[a1] - positions[a0]) * u;
  outPos.y = positions[a0 + 1] + (positions[a1 + 1] - positions[a0 + 1]) * u;
  outTan.x = tangents[a0] + (tangents[a1] - tangents[a0]) * u;
  outTan.y = tangents[a0 + 1] + (tangents[a1 + 1] - tangents[a0 + 1]) * u;
  outNor.x = normals[a0] + (normals[a1] - normals[a0]) * u;
  outNor.y = normals[a0 + 1] + (normals[a1 + 1] - normals[a0 + 1]) * u;

  const tLen = Math.hypot(outTan.x, outTan.y) || 1;
  outTan.x /= tLen;
  outTan.y /= tLen;
  const nLen = Math.hypot(outNor.x, outNor.y) || 1;
  outNor.x /= nLen;
  outNor.y /= nLen;

  // Keep normal perpendicular to tangent after lerp (reduces corner skew)
  // Project normal onto tangent-perpendicular and re-stabilize sign
  let nx = -outTan.y;
  let ny = outTan.x;
  if (nx * outNor.x + ny * outNor.y < 0) {
    nx = -nx;
    ny = -ny;
  }
  outNor.x = nx;
  outNor.y = ny;
}

export default { samplePath, evaluateAtDistance };
