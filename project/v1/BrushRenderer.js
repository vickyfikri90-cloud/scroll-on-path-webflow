/** @version v1 — ribbon/strip mesh engine (archived) */
/**
 * BrushRenderer
 * -------------
 * Reusable WebGL brush-on-path engine (OGL).
 *
 * Public API:
 *   const brush = new BrushRenderer({ container, brush, path });
 *   await brush.ready;
 *   brush.setProgress(0.5);
 *   brush.setSettings({ ... });
 *   brush.resize();
 *   brush.destroy();
 *
 * The renderer knows NOTHING about scrolling — only normalized progress.
 */

import {
  Renderer,
  Camera,
  Transform,
  Geometry,
  Program,
  Mesh,
  Color,
} from "https://esm.sh/ogl@1.0.6";

import { samplePath } from "./PathSampler.js";
import { generateBrushMesh } from "./MeshGenerator.js";
import { MeshDeformer } from "./MeshDeformer.js";

const VERT = /* glsl */ `
  attribute vec3 position;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    gl_FragColor = vec4(uColor, uOpacity);
  }
`;

/** Default runtime settings (also mirrored by ControlPanel JSON). */
export const DEFAULT_SETTINGS = {
  pathSizeVw: 80,
  brushSizeVw: 2.5,
  pageHeightVh: 300,
  pathScale: 1,
  wormholeSize: 0.12,
  stretchWidth: 0.18,
  debug: false,
  brushColor: "#EEEB5D",
  samples: 512,
  segments: 96,
  version: "v1",
};

function parseColor(hex) {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
}

function vwToPx(vw) {
  return (vw / 100) * window.innerWidth;
}

export class BrushRenderer {
  /**
   * @param {Object} options
   * @param {string|HTMLElement} options.container
   * @param {string|File} options.brush
   * @param {string|File} options.path
   * @param {Partial<typeof DEFAULT_SETTINGS>} [options.settings]
   */
  constructor(options) {
    this.version = "v1";
    this.container =
      typeof options.container === "string"
        ? document.querySelector(options.container)
        : options.container;

    if (!this.container) {
      throw new Error("BrushRenderer: container not found");
    }

    this._brushSource = options.brush;
    this._pathSource = options.path;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(options.settings || {}),
      version: "v1",
    };

    this.progress = 0;
    this._disposed = false;
    this._raf = 0;
    this._needsDeform = true;
    this._fit = { scale: 1, offsetX: 0, offsetY: 0 };

    this.deformer = new MeshDeformer();
    this.pathSample = null;
    this.brushMesh = null;
    this.positions = null;
    this.taperBuffer = null;

    this._initGL();
    this.ready = this._loadAssets();
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                         */
  /* ------------------------------------------------------------------ */

  /** @param {number} value  normalized [0..1] */
  setProgress(value) {
    const next = Math.min(1, Math.max(0, value));
    if (Math.abs(next - this.progress) < 1e-6) return;
    this.progress = next;
    this._needsDeform = true;
  }

  /** Merge settings and mark dirty. Reloads assets if brush/path URLs change. */
  async setSettings(partial) {
    const prev = { ...this.settings };
    Object.assign(this.settings, partial);

    const brushChanged =
      partial.brush != null && partial.brush !== this._brushSource;
    const pathChanged =
      partial.path != null && partial.path !== this._pathSource;

    if (partial.brush != null) this._brushSource = partial.brush;
    if (partial.path != null) this._pathSource = partial.path;

    if (brushChanged || pathChanged) {
      await this.reloadAssets();
      return;
    }

    if (
      partial.samples != null &&
      partial.samples !== prev.samples
    ) {
      await this.reloadAssets();
      return;
    }

    if (
      partial.segments != null &&
      partial.segments !== prev.segments
    ) {
      await this.reloadAssets();
      return;
    }

    this._updateFit();
    this._needsDeform = true;
    this._syncDebugVisibility();
  }

  async reloadAssets() {
    await this._loadAssets();
  }

  resize() {
    if (this._disposed) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.orthographic({
      left: 0,
      right: w,
      bottom: h,
      top: 0,
      near: -1000,
      far: 1000,
    });
    this.camera.position.set(0, 0, 1);
    this._updateFit();
    this._needsDeform = true;
  }

  destroy() {
    this._disposed = true;
    cancelAnimationFrame(this._raf);
    window.removeEventListener("resize", this._onResize);
    if (this.mesh) this.scene.removeChild(this.mesh);
    if (this.debugRoot) this.scene.removeChild(this.debugRoot);
    this.renderer.gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.canvas.remove();
    if (this.debugCanvas) this.debugCanvas.remove();
  }

  getSettings() {
    return {
      ...this.settings,
      version: "v1",
      brush:
        typeof this._brushSource === "string"
          ? this._brushSource
          : this._brushSource?.name || "(file)",
      path:
        typeof this._pathSource === "string"
          ? this._pathSource
          : this._pathSource?.name || "(file)",
      progress: Number(this.progress.toFixed(4)),
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Init                                                               */
  /* ------------------------------------------------------------------ */

  _initGL() {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "brush-canvas";
    this.container.appendChild(this.canvas);

    this.renderer = new Renderer({
      canvas: this.canvas,
      width: this.container.clientWidth || 1,
      height: this.container.clientHeight || 1,
      dpr: Math.min(window.devicePixelRatio || 1, 2),
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
    });
    this.gl = this.renderer.gl;
    this.gl.clearColor(0, 0, 0, 0);

    this.camera = new Camera(this.gl);
    this.scene = new Transform();

    // 2D debug overlay (Canvas2D — cheap, independent of mesh)
    this.debugCanvas = document.createElement("canvas");
    this.debugCanvas.className = "brush-debug-canvas";
    this.debugCanvas.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:none;";
    this.container.style.position =
      this.container.style.position || "relative";
    this.container.appendChild(this.debugCanvas);
    this.debugCtx = this.debugCanvas.getContext("2d");

    this._onResize = () => this.resize();
    window.addEventListener("resize", this._onResize);
    this.resize();
    this._loop();
  }

  async _loadAssets() {
    const [pathSample, brushMesh] = await Promise.all([
      samplePath(this._pathSource, { samples: this.settings.samples }),
      generateBrushMesh(this._brushSource, {
        segments: this.settings.segments,
      }),
    ]);

    if (this._disposed) return;

    this.pathSample = pathSample;
    this.brushMesh = brushMesh;
    this.positions = new Float32Array(brushMesh.vertexCount * 3);
    this.taperBuffer = new Float32Array(brushMesh.vertexCount);

    this._buildBrushMesh();
    this._updateFit();
    this._needsDeform = true;
    this._syncDebugVisibility();
  }

  _buildBrushMesh() {
    if (this.mesh) {
      this.scene.removeChild(this.mesh);
      this.mesh = null;
    }

    const { indices, vertexCount } = this.brushMesh;
    const geometry = new Geometry(this.gl, {
      position: { size: 3, data: this.positions },
      index: { data: indices },
    });

    const [r, g, b] = parseColor(this.settings.brushColor);
    const program = new Program(this.gl, {
      vertex: VERT,
      fragment: FRAG,
      uniforms: {
        uColor: { value: [r, g, b] },
        uOpacity: { value: 1 },
      },
      transparent: true,
      cullFace: false,
      depthTest: false,
    });

    this.mesh = new Mesh(this.gl, { geometry, program });
    this.mesh.setParent(this.scene);

    // Keep a direct handle for buffer sub-updates
    this._positionAttr = geometry.attributes.position;
    this._vertexCount = vertexCount;
  }

  /* ------------------------------------------------------------------ */
  /*  Fit path into viewport using pathSizeVw                            */
  /* ------------------------------------------------------------------ */

  _updateFit() {
    if (!this.pathSample) return;

    const w = this.renderer.width;
    const h = this.renderer.height;
    const { bounds } = this.pathSample;
    const targetW = vwToPx(this.settings.pathSizeVw);
    const scale = targetW / Math.max(bounds.width, 1e-6);

    const fittedW = bounds.width * scale;
    const fittedH = bounds.height * scale;

    this._fit.scale = scale;
    this._fit.offsetX = (w - fittedW) * 0.5 - bounds.x * scale;
    this._fit.offsetY = (h - fittedH) * 0.5 - bounds.y * scale;

    if (this.mesh) {
      this.mesh.scale.set(scale, scale, 1);
      this.mesh.position.set(this._fit.offsetX, this._fit.offsetY, 0);
    }
  }

  /** Brush half-width in path SVG units (so deform stays in path space). */
  _brushSizeInPathUnits() {
    const px = vwToPx(this.settings.brushSizeVw);
    return px / Math.max(this._fit.scale, 1e-6);
  }

  /* ------------------------------------------------------------------ */
  /*  Frame loop                                                         */
  /* ------------------------------------------------------------------ */

  _loop = () => {
    if (this._disposed) return;
    this._raf = requestAnimationFrame(this._loop);

    if (this._needsDeform && this.pathSample && this.brushMesh) {
      this._deform();
      this._needsDeform = false;
    }

    this.renderer.render({ scene: this.scene, camera: this.camera });

    if (this.settings.debug) {
      this._drawDebug();
    }
  };

  _deform() {
    this.deformer.deform(
      this.brushMesh,
      this.pathSample,
      this.positions,
      {
        progress: this.progress,
        stretchWidth: this.settings.stretchWidth,
        pathScale: this.settings.pathScale,
        brushSizeWorld: this._brushSizeInPathUnits(),
        wormholeSize: this.settings.wormholeSize,
        meshHalfWidthRef: this.brushMesh.maxHalfWidth,
      },
      this.taperBuffer
    );

    // Upload positions only — topology untouched
    const attr = this._positionAttr;
    if (attr) {
      attr.needsUpdate = true;
    }
  }

  _syncDebugVisibility() {
    if (this.debugCanvas) {
      this.debugCanvas.style.display = this.settings.debug ? "block" : "none";
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Debug overlay (Canvas2D)                                           */
  /* ------------------------------------------------------------------ */

  _drawDebug() {
    const canvas = this.debugCanvas;
    const ctx = this.debugCtx;
    const w = this.renderer.width;
    const h = this.renderer.height;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    ctx.clearRect(0, 0, w, h);
    if (!this.pathSample) return;

    const { scale, offsetX, offsetY } = this._fit;
    const toScreen = (x, y) => [x * scale + offsetX, y * scale + offsetY];

    const sample = this.pathSample;
    const count = sample.count;

    // Original path polyline
    ctx.beginPath();
    ctx.strokeStyle = "rgba(255,80,80,0.85)";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < count; i++) {
      const [sx, sy] = toScreen(sample.positions[i * 2], sample.positions[i * 2 + 1]);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();

    // Sampled points + tangents + normals (every Nth for readability)
    const step = Math.max(1, Math.floor(count / 64));
    const normalLen = 18;
    const tanLen = 14;

    for (let i = 0; i < count; i += step) {
      const px = sample.positions[i * 2];
      const py = sample.positions[i * 2 + 1];
      const [sx, sy] = toScreen(px, py);

      // Point
      ctx.fillStyle = "rgba(80,180,255,0.9)";
      ctx.beginPath();
      ctx.arc(sx, sy, 2, 0, Math.PI * 2);
      ctx.fill();

      // Tangent
      const tx = sample.tangents[i * 2];
      const ty = sample.tangents[i * 2 + 1];
      ctx.strokeStyle = "rgba(80,255,120,0.7)";
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + tx * tanLen, sy + ty * tanLen);
      ctx.stroke();

      // Normal
      const nx = sample.normals[i * 2];
      const ny = sample.normals[i * 2 + 1];
      ctx.strokeStyle = "rgba(255,200,60,0.7)";
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + nx * normalLen, sy + ny * normalLen);
      ctx.stroke();
    }

    // Generated mesh wireframe
    if (this.brushMesh && this.positions) {
      const { indices, segments } = this.brushMesh;
      ctx.strokeStyle = "rgba(180,120,255,0.55)";
      ctx.lineWidth = 1;
      for (let s = 0; s < segments; s++) {
        const base = s * 6;
        // First triangle edges are enough for a strip look
        const i0 = indices[base];
        const i1 = indices[base + 1];
        const i2 = indices[base + 2];
        this._strokeTri(ctx, toScreen, i0, i1, i2);
      }

      // Taper heatmap on vertices
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      for (let i = 0; i < this.brushMesh.vertexCount; i++) {
        const t = this.taperBuffer?.[i] ?? 1;
        if (t >= 0.99) continue;
        const [sx, sy] = toScreen(this.positions[i * 3], this.positions[i * 3 + 1]);
        ctx.fillStyle = `rgba(255,60,60,${(1 - t) * 0.85})`;
        ctx.beginPath();
        ctx.arc(sx, sy, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Taper / wormhole zones on path
    const pathLen = sample.totalLength;
    const brushLen = this.settings.stretchWidth * pathLen;
    const worm = this.settings.wormholeSize * brushLen;
    this._drawPathZone(ctx, toScreen, sample, 0, worm, "rgba(255,100,0,0.35)");
    this._drawPathZone(
      ctx,
      toScreen,
      sample,
      pathLen - worm,
      pathLen,
      "rgba(255,100,0,0.35)"
    );

    // Progress readout
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(`progress ${(this.progress * 100).toFixed(1)}%`, 12, 20);
    ctx.fillText(`pathLen ${pathLen.toFixed(1)}  brushLen ${brushLen.toFixed(1)}`, 12, 36);
    ctx.fillText(`wormhole ${worm.toFixed(1)}  scale ${this.settings.pathScale}`, 12, 52);
  }

  _strokeTri(ctx, toScreen, i0, i1, i2) {
    const a = toScreen(this.positions[i0 * 3], this.positions[i0 * 3 + 1]);
    const b = toScreen(this.positions[i1 * 3], this.positions[i1 * 3 + 1]);
    const c = toScreen(this.positions[i2 * 3], this.positions[i2 * 3 + 1]);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.lineTo(c[0], c[1]);
    ctx.closePath();
    ctx.stroke();
  }

  _drawPathZone(ctx, toScreen, sample, d0, d1, fill) {
    if (d1 <= d0) return;
    const steps = 24;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const d = d0 + ((d1 - d0) * i) / steps;
      const t = d / sample.totalLength;
      const idx = Math.min(
        sample.count - 1,
        Math.max(0, Math.round(t * (sample.count - 1)))
      );
      const [sx, sy] = toScreen(
        sample.positions[idx * 2],
        sample.positions[idx * 2 + 1]
      );
      const nx = sample.normals[idx * 2];
      const ny = sample.normals[idx * 2 + 1];
      const w = 10;
      if (i === 0) ctx.moveTo(sx + nx * w, sy + ny * w);
      else ctx.lineTo(sx + nx * w, sy + ny * w);
    }
    for (let i = steps; i >= 0; i--) {
      const d = d0 + ((d1 - d0) * i) / steps;
      const t = d / sample.totalLength;
      const idx = Math.min(
        sample.count - 1,
        Math.max(0, Math.round(t * (sample.count - 1)))
      );
      const [sx, sy] = toScreen(
        sample.positions[idx * 2],
        sample.positions[idx * 2 + 1]
      );
      const nx = sample.normals[idx * 2];
      const ny = sample.normals[idx * 2 + 1];
      const w = 10;
      ctx.lineTo(sx - nx * w, sy - ny * w);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }
}

export default BrushRenderer;
