/** @version v1 — ribbon/strip mesh engine (archived) */
/**
 * MeshGenerator
 * -------------
 * Converts a brush SVG (filled silhouette designed in Illustrator) into a
 * deformable strip mesh with CONSTANT topology.
 *
 * Strategy:
 * 1. Flatten the brush outline once via getPointAtLength
 * 2. Slice vertically along the brush's long axis
 * 3. At each station, record top/bottom extents → a 2-row ribbon mesh
 *
 * Vertex attributes (local brush space, never rebuilt at runtime):
 *   - along   [0..1]  : 0 = brush tail, 1 = brush head
 *   - across  [-1..1] : signed offset from local centerline
 *   - halfWidth       : original half-thickness at this station (SVG units)
 */

const DEFAULT_SEGMENTS = 96;
const OUTLINE_SAMPLES = 2048;

/**
 * @typedef {Object} BrushMesh
 * @property {Float32Array} localPositions  - placeholder XY (topology reference)
 * @property {Float32Array} along           - per-vertex along [0..1]
 * @property {Float32Array} across          - per-vertex across [-1..1]
 * @property {Float32Array} halfWidths      - per-vertex original half-width
 * @property {Uint32Array|Uint16Array} indices
 * @property {number} vertexCount
 * @property {number} segments
 * @property {{x:number,y:number,width:number,height:number}} bounds
 * @property {number} brushLength           - SVG-unit length along X
 * @property {number} maxHalfWidth          - max half-width in SVG units
 */

async function loadSvgText(source) {
  if (source instanceof File) return source.text();
  const res = await fetch(source);
  if (!res.ok) throw new Error(`Failed to load brush SVG: ${source} (${res.status})`);
  return res.text();
}

function parseBrushPath(svgText) {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svg = doc.querySelector("svg");
  const pathEl = doc.querySelector("path");
  if (!pathEl) throw new Error("MeshGenerator: no <path> found in brush SVG");
  const d = pathEl.getAttribute("d");
  if (!d) throw new Error("MeshGenerator: brush path has empty `d`");

  const viewBox =
    svg?.getAttribute("viewBox") ||
    `0 0 ${svg?.getAttribute("width") || 100} ${svg?.getAttribute("height") || 10}`;

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
 * Build a width profile by bucketing outline samples along X.
 * @param {SVGPathElement} path
 * @param {number} segments
 */
function buildWidthProfile(path, segments) {
  const total = path.getTotalLength();
  const outline = new Array(OUTLINE_SAMPLES);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < OUTLINE_SAMPLES; i++) {
    const p = path.getPointAtLength((i / OUTLINE_SAMPLES) * total);
    outline[i] = p;
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  const brushLength = Math.max(maxX - minX, 1e-6);
  const stations = [];

  for (let s = 0; s <= segments; s++) {
    const along = s / segments;
    const x = minX + along * brushLength;

    // Collect outline points near this X station
    const band = brushLength / segments;
    let top = -Infinity;
    let bottom = Infinity;
    let hits = 0;

    for (let i = 0; i < OUTLINE_SAMPLES; i++) {
      const p = outline[i];
      if (Math.abs(p.x - x) <= band * 0.75) {
        top = Math.max(top, p.y);
        bottom = Math.min(bottom, p.y);
        hits++;
      }
    }

    // Fallback: nearest outline points if band was empty
    if (hits < 2) {
      top = -Infinity;
      bottom = Infinity;
      for (let i = 0; i < OUTLINE_SAMPLES; i++) {
        const p = outline[i];
        if (Math.abs(p.x - x) < band * 2) {
          top = Math.max(top, p.y);
          bottom = Math.min(bottom, p.y);
        }
      }
    }

    if (!Number.isFinite(top) || !Number.isFinite(bottom)) {
      const midY = (minY + maxY) * 0.5;
      top = midY + (maxY - minY) * 0.15;
      bottom = midY - (maxY - minY) * 0.15;
    }

    const center = (top + bottom) * 0.5;
    const halfWidth = Math.max((top - bottom) * 0.5, 1e-4);

    stations.push({ along, x, center, halfWidth, top, bottom });
  }

  // Smooth half-widths slightly to avoid jagged mesh from sparse bins
  const smoothed = stations.map((st) => ({ ...st }));
  for (let i = 1; i < stations.length - 1; i++) {
    smoothed[i].halfWidth =
      stations[i - 1].halfWidth * 0.25 +
      stations[i].halfWidth * 0.5 +
      stations[i + 1].halfWidth * 0.25;
    smoothed[i].center =
      stations[i - 1].center * 0.25 +
      stations[i].center * 0.5 +
      stations[i + 1].center * 0.25;
  }

  return {
    stations: smoothed,
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    brushLength,
  };
}

/**
 * Generate a constant-topology brush mesh from an SVG source.
 * @param {string|File} source
 * @param {{segments?: number}} [options]
 * @returns {Promise<BrushMesh>}
 */
export async function generateBrushMesh(source, options = {}) {
  const segments = Math.max(4, options.segments ?? DEFAULT_SEGMENTS);
  const svgText = await loadSvgText(source);
  const { d, viewBox } = parseBrushPath(svgText);
  const { svg, path } = createMeasurablePath(d, viewBox);

  try {
    const { stations, bounds, brushLength } = buildWidthProfile(path, segments);

    // 2 vertices per station (bottom / top) → constant topology
    const vertexCount = (segments + 1) * 2;
    const localPositions = new Float32Array(vertexCount * 2);
    const along = new Float32Array(vertexCount);
    const across = new Float32Array(vertexCount);
    const halfWidths = new Float32Array(vertexCount);

    let maxHalfWidth = 0;

    for (let s = 0; s <= segments; s++) {
      const st = stations[s];
      maxHalfWidth = Math.max(maxHalfWidth, st.halfWidth);

      const iBottom = s * 2;
      const iTop = s * 2 + 1;

      // Local reference positions (undeformed strip in brush space)
      localPositions[iBottom * 2] = st.x;
      localPositions[iBottom * 2 + 1] = st.center - st.halfWidth;
      localPositions[iTop * 2] = st.x;
      localPositions[iTop * 2 + 1] = st.center + st.halfWidth;

      along[iBottom] = st.along;
      along[iTop] = st.along;
      across[iBottom] = -1;
      across[iTop] = 1;
      halfWidths[iBottom] = st.halfWidth;
      halfWidths[iTop] = st.halfWidth;
    }

    // Triangle list (two tris per quad)
    const quadCount = segments;
    const indexCount = quadCount * 6;
    const indices =
      vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);

    for (let s = 0; s < segments; s++) {
      const bl = s * 2;
      const tl = s * 2 + 1;
      const br = (s + 1) * 2;
      const tr = (s + 1) * 2 + 1;
      const base = s * 6;
      // CCW winding
      indices[base] = bl;
      indices[base + 1] = br;
      indices[base + 2] = tl;
      indices[base + 3] = tl;
      indices[base + 4] = br;
      indices[base + 5] = tr;
    }

    return {
      localPositions,
      along,
      across,
      halfWidths,
      indices,
      vertexCount,
      segments,
      bounds,
      brushLength,
      maxHalfWidth,
    };
  } finally {
    svg.remove();
  }
}

export default { generateBrushMesh };
