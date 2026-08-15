/** @version v4 — adaptive Frenet + live taper params */
/**
 * BrushRenderer (v4)
 * ------------------
 * Exact SVG tessellation with adaptive path sampling and flip-stabilized
 * Frenet frames for sharper corners. Portal taper params are live-tunable
 * without rebuilding the mesh.
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
import { MeshDeformer, DEFAULT_TAPER, EASING_OPTIONS } from "./MeshDeformer.js";

export { EASING_OPTIONS, DEFAULT_TAPER };

const VERT = /* glsl */ `
  attribute vec3 position;
  attribute float alpha;
  varying float vAlpha;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  void main() {
    vAlpha = alpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying float vAlpha;
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    if (vAlpha <= 0.001) discard;
    gl_FragColor = vec4(uColor, uOpacity * vAlpha);
  }
`;

export const DEFAULT_SETTINGS = {
  pathSizeVw: 80,
  brushSizeVw: 1.1,
  pageHeightVh: 300,
  pathScale: 1,
  stretchWidth: 1,
  // Live taper (no mesh rebuild)
  portalRadius: DEFAULT_TAPER.portalRadius,
  taperLength: DEFAULT_TAPER.taperLength,
  taperStrength: DEFAULT_TAPER.taperStrength,
  minimumScale: DEFAULT_TAPER.minimumScale,
  easing: DEFAULT_TAPER.easing,
  frontTaper: DEFAULT_TAPER.frontTaper,
  backTaper: DEFAULT_TAPER.backTaper,
  // Legacy alias kept for JSON compatibility
  wormholeSize: DEFAULT_TAPER.portalRadius,
  debug: false,
  brushColor: null,
  samples: 1024,
  angleThreshDeg: 6,
  version: "v4",
};

function parseColor(hex) {
  const c = new Color(hex || "#EEEB5D");
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
    this.version = "v4";
    this.container =
      typeof options.container === "string"
        ? document.querySelector(options.container)
        : options.container;

    if (!this.container) throw new Error("BrushRenderer: container not found");

    this._brushSource = options.brush;
    this._pathSource = options.path;
    this.settings = { ...DEFAULT_SETTINGS, ...(options.settings || {}), version: "v4" };

    this.progress = 0;
    this._disposed = false;
    this._raf = 0;
    this._needsDeform = true;
    this._fit = { scale: 1, offsetX: 0, offsetY: 0 };

    this.deformer = new MeshDeformer();
    this.pathSample = null;
    this.brushMesh = null;
    this.positions = null;
    this.alphas = null;

    this._initGL();
    this.ready = this._loadAssets();
  }

  setProgress(value) {
    const next = Math.min(1, Math.max(0, value));
    if (Math.abs(next - this.progress) < 1e-6) return;
    this.progress = next;
    this._needsDeform = true;
  }

  async setSettings(partial) {
    const prev = { ...this.settings };
    Object.assign(this.settings, partial);

    if (partial.brush != null) this._brushSource = partial.brush;
    if (partial.path != null) this._pathSource = partial.path;

    const brushChanged = partial.brush != null;
    const pathChanged = partial.path != null;
    const samplesChanged =
      (partial.samples != null && partial.samples !== prev.samples) ||
      (partial.angleThreshDeg != null &&
        partial.angleThreshDeg !== prev.angleThreshDeg);

    if (brushChanged || pathChanged || samplesChanged) {
      await this.reloadAssets();
      return;
    }

    // Sync legacy alias ↔ portalRadius
    if (partial.portalRadius != null && partial.wormholeSize == null) {
      this.settings.wormholeSize = partial.portalRadius;
    } else if (partial.wormholeSize != null && partial.portalRadius == null) {
      this.settings.portalRadius = partial.wormholeSize;
    }

    if (partial.brushColor != null || partial.brush != null) {
      this._syncColor();
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
    this.renderer.gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.canvas.remove();
    if (this.debugCanvas) this.debugCanvas.remove();
  }

  getSettings() {
    return {
      ...this.settings,
      version: "v4",
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
      samplePath(this._pathSource, {
        samples: this.settings.samples,
        maxSamples: this.settings.samples,
        angleThreshDeg: this.settings.angleThreshDeg,
      }),
      generateBrushMesh(this._brushSource),
    ]);

    if (this._disposed) return;

    this.pathSample = pathSample;
    this.brushMesh = brushMesh;
    this.positions = new Float32Array(brushMesh.vertexCount * 3);
    this.alphas = new Float32Array(brushMesh.vertexCount);
    this.alphas.fill(1);

    this._buildBrushMesh();
    this._updateFit();
    this._needsDeform = true;
    this._syncDebugVisibility();
  }

  _syncColor() {
    if (!this.mesh) return;
    const hex = this.settings.brushColor || this.brushMesh?.fill || "#EEEB5D";
    const [r, g, b] = parseColor(hex);
    this.mesh.program.uniforms.uColor.value = [r, g, b];
  }

  _buildBrushMesh() {
    if (this.mesh) {
      this.scene.removeChild(this.mesh);
      this.mesh = null;
    }

    const { indices } = this.brushMesh;
    const geometry = new Geometry(this.gl, {
      position: { size: 3, data: this.positions },
      alpha: { size: 1, data: this.alphas },
      index: { data: indices },
    });

    const hex = this.settings.brushColor || this.brushMesh.fill || "#EEEB5D";
    const [r, g, b] = parseColor(hex);
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
    this._positionAttr = geometry.attributes.position;
    this._alphaAttr = geometry.attributes.alpha;
  }

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

  /** Uniform SVG→path scale from brushSizeVw (height maps to brushSizeVw). */
  _svgScaleInPathUnits() {
    if (!this.brushMesh) return 1;
    const px = vwToPx(this.settings.brushSizeVw);
    const inPath = px / Math.max(this._fit.scale, 1e-6);
    return inPath / this.brushMesh.brushHeight;
  }

  /** Fixed brush length on the path — natural SVG aspect × lengthScale. */
  _brushLengthWorld() {
    const svgScale = this._svgScaleInPathUnits();
    const lengthScale = Math.max(this.settings.stretchWidth, 0.01);
    return this.brushMesh.brushLength * svgScale * lengthScale;
  }

  _loop = () => {
    if (this._disposed) return;
    this._raf = requestAnimationFrame(this._loop);

    if (this._needsDeform && this.pathSample && this.brushMesh) {
      this._deform();
      this._needsDeform = false;
    }

    this.renderer.render({ scene: this.scene, camera: this.camera });
    if (this.settings.debug) this._drawDebug();
  };

  _deform() {
    const s = this.settings;
    this.deformer.deform(
      this.brushMesh,
      this.pathSample,
      this.positions,
      this.alphas,
      {
        progress: this.progress,
        brushLengthWorld: this._brushLengthWorld(),
        svgScale: this._svgScaleInPathUnits(),
        pathScale: s.pathScale,
        portalRadius: s.portalRadius ?? s.wormholeSize,
        taperLength: s.taperLength,
        taperStrength: s.taperStrength,
        minimumScale: s.minimumScale,
        easing: s.easing,
        frontTaper: s.frontTaper,
        backTaper: s.backTaper,
      }
    );

    if (this._positionAttr) this._positionAttr.needsUpdate = true;
    if (this._alphaAttr) this._alphaAttr.needsUpdate = true;
  }

  _syncDebugVisibility() {
    if (this.debugCanvas) {
      this.debugCanvas.style.display = this.settings.debug ? "block" : "none";
    }
  }

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

    // Path
    ctx.beginPath();
    ctx.strokeStyle = "rgba(255,80,80,0.85)";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < count; i++) {
      const [sx, sy] = toScreen(sample.positions[i * 2], sample.positions[i * 2 + 1]);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();

    const step = Math.max(1, Math.floor(count / 64));
    for (let i = 0; i < count; i += step) {
      const [sx, sy] = toScreen(sample.positions[i * 2], sample.positions[i * 2 + 1]);
      ctx.fillStyle = "rgba(80,180,255,0.9)";
      ctx.beginPath();
      ctx.arc(sx, sy, 2, 0, Math.PI * 2);
      ctx.fill();

      const tx = sample.tangents[i * 2];
      const ty = sample.tangents[i * 2 + 1];
      ctx.strokeStyle = "rgba(80,255,120,0.7)";
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + tx * 14, sy + ty * 14);
      ctx.stroke();

      const nx = sample.normals[i * 2];
      const ny = sample.normals[i * 2 + 1];
      ctx.strokeStyle = "rgba(255,200,60,0.7)";
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + nx * 18, sy + ny * 18);
      ctx.stroke();
    }

    // Tessellated mesh edges (visible verts only)
    if (this.brushMesh && this.positions) {
      const { indices } = this.brushMesh;
      ctx.strokeStyle = "rgba(180,120,255,0.4)";
      ctx.lineWidth = 0.75;
      for (let t = 0; t < indices.length; t += 3) {
        const i0 = indices[t];
        const i1 = indices[t + 1];
        const i2 = indices[t + 2];
        if ((this.alphas[i0] ?? 1) < 0.05) continue;
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
    }

    // Portal zones at path START and END only
    const pathLen = sample.totalLength;
    const brushLen = this._brushLengthWorld();
    const fade = this.settings.wormholeSize * brushLen;
    this._drawPathZone(ctx, toScreen, sample, 0, Math.max(fade, pathLen * 0.02), "rgba(255,100,0,0.4)");
    this._drawPathZone(
      ctx,
      toScreen,
      sample,
      pathLen - Math.max(fade, pathLen * 0.02),
      pathLen,
      "rgba(255,100,0,0.4)"
    );

    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(`v4 Frenet  progress ${(this.progress * 100).toFixed(1)}%`, 12, 20);
    ctx.fillText(
      `tris ${this.brushMesh?.triangleCount ?? 0}  verts ${this.brushMesh?.vertexCount ?? 0}`,
      12,
      36
    );
    ctx.fillText(
      `brushLen ${brushLen.toFixed(1)}  taperRadius ${fade.toFixed(1)}`,
      12,
      52
    );
  }

  _drawPathZone(ctx, toScreen, sample, d0, d1, fill) {
    if (d1 <= d0) return;
    const steps = 24;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const d = d0 + ((d1 - d0) * i) / steps;
      const t = d / sample.totalLength;
      const idx = Math.min(sample.count - 1, Math.max(0, Math.round(t * (sample.count - 1))));
      const [sx, sy] = toScreen(sample.positions[idx * 2], sample.positions[idx * 2 + 1]);
      const nx = sample.normals[idx * 2];
      const ny = sample.normals[idx * 2 + 1];
      if (i === 0) ctx.moveTo(sx + nx * 12, sy + ny * 12);
      else ctx.lineTo(sx + nx * 12, sy + ny * 12);
    }
    for (let i = steps; i >= 0; i--) {
      const d = d0 + ((d1 - d0) * i) / steps;
      const t = d / sample.totalLength;
      const idx = Math.min(sample.count - 1, Math.max(0, Math.round(t * (sample.count - 1))));
      const [sx, sy] = toScreen(sample.positions[idx * 2], sample.positions[idx * 2 + 1]);
      const nx = sample.normals[idx * 2];
      const ny = sample.normals[idx * 2 + 1];
      ctx.lineTo(sx - nx * 12, sy - ny * 12);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }
}

export default BrushRenderer;
