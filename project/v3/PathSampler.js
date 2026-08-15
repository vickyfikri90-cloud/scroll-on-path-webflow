/** @version v3 — exact SVG tessellation engine */
/**
 * PathSampler
 * -----------
 * Loads an SVG path once, samples it at uniform arc-length intervals,
 * and caches positions / tangents / normals / cumulative distances.
 */

const DEFAULT_SAMPLES = 512;

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

/**
 * @param {string|File} source
 * @param {{samples?: number}} [options]
 */
export async function samplePath(source, options = {}) {
  const sampleCount = Math.max(8, options.samples ?? DEFAULT_SAMPLES);
  const svgText = await loadSvgText(source);
  const { d, viewBox } = parseSvgPath(svgText);
  const { svg, path } = createMeasurablePath(d, viewBox);

  try {
    const totalLength = path.getTotalLength();
    if (!(totalLength > 0)) throw new Error("PathSampler: path total length is zero");

    const count = sampleCount + 1;
    const positions = new Float32Array(count * 2);
    const tangents = new Float32Array(count * 2);
    const normals = new Float32Array(count * 2);
    const distances = new Float32Array(count);
    const epsilon = Math.max(totalLength * 1e-4, 0.01);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < count; i++) {
      const t = i / sampleCount;
      const dist = t * totalLength;
      const pt = path.getPointAtLength(dist);

      const d0 = Math.max(0, dist - epsilon);
      const d1 = Math.min(totalLength, dist + epsilon);
      const p0 = path.getPointAtLength(d0);
      const p1 = path.getPointAtLength(d1);
      let tx = p1.x - p0.x;
      let ty = p1.y - p0.y;
      const len = Math.hypot(tx, ty) || 1;
      tx /= len;
      ty /= len;

      const nx = -ty;
      const ny = tx;

      const oi = i * 2;
      positions[oi] = pt.x;
      positions[oi + 1] = pt.y;
      tangents[oi] = tx;
      tangents[oi + 1] = ty;
      normals[oi] = nx;
      normals[oi + 1] = ny;
      distances[i] = dist;

      minX = Math.min(minX, pt.x);
      minY = Math.min(minY, pt.y);
      maxX = Math.max(maxX, pt.x);
      maxY = Math.max(maxY, pt.y);
    }

    return {
      positions,
      tangents,
      normals,
      distances,
      count,
      totalLength,
      bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
      viewBox,
    };
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
}

export default { samplePath, evaluateAtDistance };
