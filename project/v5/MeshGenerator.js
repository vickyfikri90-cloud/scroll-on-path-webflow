/** @version v5 — exact SVG tessellation engine */
/**
 * MeshGenerator
 * -------------
 * Tessellates the Illustrator brush SVG into a triangle mesh that preserves
 * the original silhouette — including compound paths (multiple subpaths).
 *
 * Each subpath is sampled & triangulated independently, then merged.
 * No smoothing / simplification of the artwork.
 */

import earcut from "https://esm.sh/earcut@2.2.4";

const OUTLINE_SAMPLES_PER_UNIT = 6;
const MIN_SAMPLES = 128;
const MAX_SAMPLES = 4096;

async function loadSvgText(source) {
  if (source instanceof File) return source.text();
  const res = await fetch(source);
  if (!res.ok) throw new Error(`Failed to load brush SVG: ${source} (${res.status})`);
  return res.text();
}

function parseBrushSvg(svgText) {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svg = doc.querySelector("svg");
  const pathEl = doc.querySelector("path");
  if (!pathEl) throw new Error("MeshGenerator: no <path> found in brush SVG");
  const d = pathEl.getAttribute("d");
  if (!d) throw new Error("MeshGenerator: brush path has empty `d`");

  const viewBox =
    svg?.getAttribute("viewBox") ||
    `0 0 ${svg?.getAttribute("width") || 100} ${svg?.getAttribute("height") || 10}`;

  const fill = pathEl.getAttribute("fill") || "#EEEB5D";
  return { d, viewBox, fill: fill === "none" ? "#EEEB5D" : fill };
}

/**
 * Split a path `d` into subpath strings (each starting with M/m).
 * Illustrator brushes often ship as compound paths.
 */
function splitSubpaths(d) {
  const trimmed = d.trim();
  if (!trimmed) return [];
  // Keep the command letter with each chunk
  const parts = trimmed.split(/(?=[Mm])/).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : [trimmed];
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
 * Dense outline for one subpath — spacing based on length, no smoothing.
 * @param {SVGPathElement} path
 */
function sampleOutline(path) {
  const total = path.getTotalLength();
  if (!(total > 0)) return null;

  const n = Math.min(
    MAX_SAMPLES,
    Math.max(MIN_SAMPLES, Math.ceil(total * OUTLINE_SAMPLES_PER_UNIT))
  );

  const pts = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < n; i++) {
    const p = path.getPointAtLength((i / n) * total);
    if (pts.length) {
      const prev = pts[pts.length - 1];
      if (Math.hypot(p.x - prev.x, p.y - prev.y) < 1e-5) continue;
    }
    pts.push({ x: p.x, y: p.y });
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  if (pts.length < 3) return null;

  // Detect closed subpath
  const first = pts[0];
  const last = pts[pts.length - 1];
  const closed =
    Math.hypot(first.x - last.x, first.y - last.y) < Math.max(total * 0.002, 0.05);

  if (closed) {
    // Drop near-duplicate closing point for earcut
    if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-3) {
      pts.pop();
    }
  } else {
    // Open strokes can't be filled as a polygon — skip
    return null;
  }

  if (pts.length < 3) return null;

  return {
    pts,
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    area: polygonArea(pts),
  };
}

function polygonArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  }
  return a * 0.5;
}

/** Force CCW (positive area) for earcut exterior. */
function toCCW(pts) {
  if (polygonArea(pts) < 0) pts.reverse();
  return pts;
}

/** Force CW (negative area) for earcut holes. */
function toCW(pts) {
  if (polygonArea(pts) > 0) pts.reverse();
  return pts;
}

function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x;
    const yi = pts[i].y;
    const xj = pts[j].x;
    const yj = pts[j].y;
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Group rings into exteriors + holes, then triangulate.
 * Separate islands become separate exteriors.
 */
function triangulateRings(rings) {
  // Largest area first
  const sorted = rings
    .map((r) => ({ ...r, absArea: Math.abs(r.area) }))
    .sort((a, b) => b.absArea - a.absArea);

  const used = new Set();
  const allPositions = [];
  const allIndices = [];
  let indexOffset = 0;

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue;
    const outer = sorted[i];
    used.add(i);

    const holes = [];
    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(j)) continue;
      const cand = sorted[j];
      // Hole if its centroid is inside the outer ring
      let cx = 0;
      let cy = 0;
      for (const p of cand.pts) {
        cx += p.x;
        cy += p.y;
      }
      cx /= cand.pts.length;
      cy /= cand.pts.length;
      if (pointInPoly(cx, cy, outer.pts)) {
        holes.push(cand);
        used.add(j);
      }
    }

    const outerPts = toCCW(outer.pts.slice());
    const flat = [];
    const holeIndices = [];

    for (const p of outerPts) {
      flat.push(p.x, p.y);
    }

    for (const hole of holes) {
      holeIndices.push(flat.length / 2);
      const holePts = toCW(hole.pts.slice());
      for (const p of holePts) {
        flat.push(p.x, p.y);
      }
    }

    const tri = earcut(flat, holeIndices.length ? holeIndices : undefined);
    if (!tri.length) continue;

    const vertCount = flat.length / 2;
    for (let v = 0; v < vertCount; v++) {
      allPositions.push(flat[v * 2], flat[v * 2 + 1]);
    }
    for (let t = 0; t < tri.length; t++) {
      allIndices.push(tri[t] + indexOffset);
    }
    indexOffset += vertCount;
  }

  return { allPositions, allIndices };
}

/**
 * @param {string|File} source
 */
export async function generateBrushMesh(source) {
  const svgText = await loadSvgText(source);
  const { d, viewBox, fill } = parseBrushSvg(svgText);
  const subpaths = splitSubpaths(d);

  const rings = [];
  const temps = [];

  try {
    for (const sub of subpaths) {
      const { svg, path } = createMeasurablePath(sub, viewBox);
      temps.push(svg);
      const outline = sampleOutline(path);
      if (outline) rings.push(outline);
    }

    if (!rings.length) {
      throw new Error("MeshGenerator: no closed subpaths to triangulate");
    }

    const { allPositions, allIndices } = triangulateRings(rings);
    if (!allIndices.length) {
      throw new Error("MeshGenerator: triangulation produced no triangles");
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < allPositions.length; i += 2) {
      const x = allPositions[i];
      const y = allPositions[i + 1];
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }

    const bounds = {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
    const brushLength = Math.max(bounds.width, 1e-6);
    const originY = bounds.y + bounds.height * 0.5;

    const vertexCount = allPositions.length / 2;
    const localPositions = new Float32Array(allPositions);
    const along01 = new Float32Array(vertexCount);
    const lateral = new Float32Array(vertexCount);

    for (let i = 0; i < vertexCount; i++) {
      const x = localPositions[i * 2];
      const y = localPositions[i * 2 + 1];
      along01[i] = (x - bounds.x) / brushLength;
      lateral[i] = y - originY;
    }

    const indices =
      vertexCount > 65535
        ? new Uint32Array(allIndices)
        : new Uint16Array(allIndices);

    return {
      localPositions,
      along01,
      lateral,
      indices,
      vertexCount,
      bounds,
      brushLength,
      brushHeight: Math.max(bounds.height, 1e-6),
      originY,
      fill,
      segments: 0,
      triangleCount: (allIndices.length / 3) | 0,
      subpathCount: rings.length,
    };
  } finally {
    for (const svg of temps) svg.remove();
  }
}

export default { generateBrushMesh };
