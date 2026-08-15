/** @version v6 — textured ribbon mesh (constant topology) */
/**
 * RibbonMesh
 * ----------
 * Lightweight strip used only as a warp cage for the brush texture.
 * Topology is constant — never rebuilt during animation.
 *
 * UV:
 *   u = along brush [0..1] (tail→head)
 *   v = across brush [0..1]
 */

/**
 * @param {{segments?: number, slices?: number}} [options]
 */
export function createRibbonMesh(options = {}) {
  const segments = Math.max(4, options.segments ?? 128);
  const slices = Math.max(1, options.slices ?? 2); // quads across width
  const cols = segments + 1;
  const rows = slices + 1;
  const vertexCount = cols * rows;

  const localAlong = new Float32Array(vertexCount); // 0..1
  const localAcross = new Float32Array(vertexCount); // -1..1
  const uvs = new Float32Array(vertexCount * 2);
  const positions = new Float32Array(vertexCount * 3);

  for (let y = 0; y < rows; y++) {
    const v = y / slices;
    const across = v * 2 - 1;
    for (let x = 0; x < cols; x++) {
      const u = x / segments;
      const i = y * cols + x;
      localAlong[i] = u;
      localAcross[i] = across;
      uvs[i * 2] = u;
      uvs[i * 2 + 1] = v;
      positions[i * 3] = u;
      positions[i * 3 + 1] = across;
      positions[i * 3 + 2] = 0;
    }
  }

  const quadCount = segments * slices;
  const indices =
    vertexCount > 65535
      ? new Uint32Array(quadCount * 6)
      : new Uint16Array(quadCount * 6);

  let o = 0;
  for (let y = 0; y < slices; y++) {
    for (let x = 0; x < segments; x++) {
      const i00 = y * cols + x;
      const i10 = i00 + 1;
      const i01 = i00 + cols;
      const i11 = i01 + 1;
      indices[o++] = i00;
      indices[o++] = i10;
      indices[o++] = i01;
      indices[o++] = i01;
      indices[o++] = i10;
      indices[o++] = i11;
    }
  }

  return {
    localAlong,
    localAcross,
    uvs,
    positions,
    indices,
    vertexCount,
    segments,
    slices,
    // Aliases so deformer can share logic with along01/lateral style
    along01: localAlong,
    across: localAcross,
  };
}

export default { createRibbonMesh };
