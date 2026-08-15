/** @version v6 — GPU texture warp along path */
/**
 * BrushRenderer (v6)
 * ------------------
 * Completely different architecture from v1–v5 mesh-silhouette deform:
 *
 *   brush.svg|png|jpg|webp → high-res raster → GPU texture
 *   → warp textured ribbon along SVG path (sticker on a wire)
 *
 * Rasterization happens ONCE (or when source / textureResolution changes).
 * Animation only updates ribbon vertex positions (tiny buffer) + uniforms.
 */

import {
  Renderer,
  Camera,
  Transform,
  Geometry,
  Program,
  Mesh,
  Texture,
} from "https://esm.sh/ogl@1.0.6";

import { samplePath } from "./PathSampler.js";
import { createRibbonMesh } from "./RibbonMesh.js";
import {
  MeshDeformer,
  DEFAULT_TAPER,
  EASING_OPTIONS,
} from "./MeshDeformer.js";
import {
  rasterizeBrush,
  textureResolutionWarning,
  isMobileDevice,
  TEXTURE_RESOLUTIONS,
} from "./TextureSource.js";

export {
  EASING_OPTIONS,
  DEFAULT_TAPER,
  TEXTURE_RESOLUTIONS,
  textureResolutionWarning,
  isMobileDevice,
};

const VERT = /* glsl */ `
  attribute vec3 position;
  attribute vec2 uv;
  attribute float alpha;
  varying vec2 vUv;
  varying float vAlpha;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  void main() {
    vUv = uv;
    vAlpha = alpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  varying float vAlpha;
  uniform sampler2D tMap;
  uniform float uOpacity;
  void main() {
    if (vAlpha <= 0.001) discard;
    vec4 tex = texture2D(tMap, vUv);
    if (tex.a < 0.01) discard;
    gl_FragColor = vec4(tex.rgb, tex.a * uOpacity * vAlpha);
  }
`;

export const DEFAULT_SETTINGS = {
  pathSizeVw: 80,
  brushSizeVw: 1.1,
  pageHeightVh: 300,
  pathScale: 1,
  stretchWidth: 1,
  textureResolution: 2048,
  portalRadius: DEFAULT_TAPER.portalRadius,
  taperLength: DEFAULT_TAPER.taperLength,
  minimumScale: DEFAULT_TAPER.minimumScale,
  falloff: DEFAULT_TAPER.falloff,
  easing: DEFAULT_TAPER.easing,
  frontPortalEnabled: DEFAULT_TAPER.frontPortalEnabled,
  backPortalEnabled: DEFAULT_TAPER.backPortalEnabled,
  // aliases for shared panel
  frontTaper: true,
  backTaper: true,
  wormholeSize: DEFAULT_TAPER.portalRadius,
  debug: false,
  samples: 1024,
  angleThreshDeg: 6,
  ribbonSegments: 160,
  version: "v6",
};

function vwToPx(vw) {
  return (vw / 100) * window.innerWidth;
}

export class BrushRenderer {
  /**
   * @param {Object} options
   * @param {string|HTMLElement} options.container
   * @param {string|File} [options.source]  brush artwork
   * @param {string|File} [options.brush]   alias of source
   * @param {string|File} options.path
   * @param {number} [options.textureResolution]
   * @param {Partial<typeof DEFAULT_SETTINGS>} [options.settings]
   */
  constructor(options) {
    this.version = "v6";
    this.container =
      typeof options.container === "string"
        ? document.querySelector(options.container)
        : options.container;
    if (!this.container) throw new Error("BrushRenderer: container not found");

    this._source = options.source ?? options.brush;
    this._pathSource = options.path;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(options.settings || {}),
      version: "v6",
    };
    if (options.textureResolution != null) {
      this.settings.textureResolution = options.textureResolution;
    }

    this.progress = 0;
    this._disposed = false;
    this._raf = 0;
    this._needsDeform = true;
    this._fit = { scale: 1, offsetX: 0, offsetY: 0 };
    this._maxTextureSize = 8192;
    this._rasterInfo = null;

    this.deformer = new MeshDeformer();
    this.pathSample = null;
    this.ribbon = null;
    this.positions = null;
    this.alphas = null;
    this.texture = null;

    this._initGL();
    this.ready = this._loadAssets();
  }

  /* ---- Public API ---- */

  setProgress(value) {
    const next = Math.min(1, Math.max(0, value));
    if (Math.abs(next - this.progress) < 1e-6) return;
    this.progress = next;
    this._needsDeform = true;
  }

  setPortalRadius(value) {
    return this.setSettings({ portalRadius: value });
  }

  setTaperLength(value) {
    return this.setSettings({ taperLength: value });
  }

  setMinimumScale(value) {
    return this.setSettings({ minimumScale: value });
  }

  setFalloff(value) {
    return this.setSettings({ falloff: value });
  }

  setTextureResolution(value) {
    return this.setSettings({ textureResolution: value });
  }

  async setSettings(partial) {
    const prev = { ...this.settings };
    Object.assign(this.settings, partial);

    // Alias bridges for shared control panel
    if (partial.portalRadius != null) this.settings.wormholeSize = partial.portalRadius;
    if (partial.wormholeSize != null && partial.portalRadius == null) {
      this.settings.portalRadius = partial.wormholeSize;
    }
    if (partial.frontPortalEnabled != null) {
      this.settings.frontTaper = partial.frontPortalEnabled;
    }
    if (partial.backPortalEnabled != null) {
      this.settings.backTaper = partial.backPortalEnabled;
    }
    if (partial.frontTaper != null && partial.frontPortalEnabled == null) {
      this.settings.frontPortalEnabled = partial.frontTaper;
    }
    if (partial.backTaper != null && partial.backPortalEnabled == null) {
      this.settings.backPortalEnabled = partial.backTaper;
    }

    if (partial.source != null) this._source = partial.source;
    if (partial.brush != null) this._source = partial.brush;
    if (partial.path != null) this._pathSource = partial.path;

    const sourceChanged = partial.source != null || partial.brush != null;
    const pathChanged = partial.path != null;
    const texResChanged =
      partial.textureResolution != null &&
      partial.textureResolution !== prev.textureResolution;
    const pathSampleChanged =
      (partial.samples != null && partial.samples !== prev.samples) ||
      (partial.angleThreshDeg != null &&
        partial.angleThreshDeg !== prev.angleThreshDeg) ||
      (partial.ribbonSegments != null &&
        partial.ribbonSegments !== prev.ribbonSegments);

    if (sourceChanged || pathChanged || texResChanged || pathSampleChanged) {
      await this.reloadAssets({
        reloadTexture: sourceChanged || texResChanged,
        reloadPath: pathChanged || pathSampleChanged,
        reloadRibbon: pathSampleChanged,
      });
      return;
    }

    // Live taper / size — deform only, no rebuild
    this._updateFit();
    this._needsDeform = true;
    this._syncDebugVisibility();
  }

  async reloadAssets(flags = {}) {
    const reloadTexture = flags.reloadTexture !== false;
    const reloadPath = flags.reloadPath !== false;
    const reloadRibbon = flags.reloadRibbon === true || !this.ribbon;

    if (reloadPath) {
      this.pathSample = await samplePath(this._pathSource, {
        samples: this.settings.samples,
        maxSamples: this.settings.samples,
        angleThreshDeg: this.settings.angleThreshDeg,
      });
    }

    if (reloadTexture) {
      await this._uploadBrushTexture();
    }

    if (reloadRibbon || !this.ribbon) {
      this._buildRibbon();
    }

    this._updateFit();
    this._needsDeform = true;
    this._syncDebugVisibility();
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
      version: "v6",
      brush:
        typeof this._source === "string"
          ? this._source
          : this._source?.name || "(file)",
      source:
        typeof this._source === "string"
          ? this._source
          : this._source?.name || "(file)",
      path:
        typeof this._pathSource === "string"
          ? this._pathSource
          : this._pathSource?.name || "(file)",
      progress: Number(this.progress.toFixed(4)),
      textureWidth: this._rasterInfo?.width ?? null,
      textureHeight: this._rasterInfo?.height ?? null,
      mobile: isMobileDevice(),
      textureWarning: textureResolutionWarning(
        this.settings.textureResolution,
        { maxTextureSize: this._maxTextureSize }
      ),
    };
  }

  getTextureWarning() {
    return textureResolutionWarning(this.settings.textureResolution, {
      maxTextureSize: this._maxTextureSize,
    });
  }

  /* ---- Init ---- */

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
    this._maxTextureSize = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) || 4096;

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
    await this.reloadAssets({
      reloadTexture: true,
      reloadPath: true,
      reloadRibbon: true,
    });
  }

  async _uploadBrushTexture() {
    const raster = await rasterizeBrush(
      this._source,
      this.settings.textureResolution,
      { maxTextureSize: this._maxTextureSize }
    );
    this._rasterInfo = raster;

    if (this.texture) {
      this.texture.image = raster.canvas;
      this.texture.needsUpdate = true;
    } else {
      this.texture = new Texture(this.gl, {
        image: raster.canvas,
        generateMipmaps: true,
        minFilter: this.gl.LINEAR_MIPMAP_LINEAR,
        magFilter: this.gl.LINEAR,
        wrapS: this.gl.CLAMP_TO_EDGE,
        wrapT: this.gl.CLAMP_TO_EDGE,
        premultiplyAlpha: true,
      });
    }

    if (this.mesh?.program) {
      this.mesh.program.uniforms.tMap.value = this.texture;
    }
  }

  _buildRibbon() {
    if (this.mesh) {
      this.scene.removeChild(this.mesh);
      this.mesh = null;
    }

    this.ribbon = createRibbonMesh({
      segments: this.settings.ribbonSegments,
      slices: 2,
    });
    this.positions = new Float32Array(this.ribbon.vertexCount * 3);
    this.alphas = new Float32Array(this.ribbon.vertexCount);
    this.alphas.fill(1);

    const geometry = new Geometry(this.gl, {
      position: { size: 3, data: this.positions },
      uv: { size: 2, data: this.ribbon.uvs },
      alpha: { size: 1, data: this.alphas },
      index: { data: this.ribbon.indices },
    });

    const program = new Program(this.gl, {
      vertex: VERT,
      fragment: FRAG,
      uniforms: {
        tMap: { value: this.texture },
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

  /** Half-width of ribbon in path units (brushSizeVw × pathScale). */
  _halfWidthWorld() {
    const px = vwToPx(this.settings.brushSizeVw) * 0.5;
    return (px / Math.max(this._fit.scale, 1e-6)) * this.settings.pathScale;
  }

  /**
   * Fixed brush length from texture aspect — no local stretch.
   * length = full width × aspect(W/H) × lengthScale
   */
  _brushLengthWorld() {
    const half = this._halfWidthWorld();
    const fullWidth = half * 2;
    const aspect = this._rasterInfo?.aspect || 10;
    const lengthScale = Math.max(this.settings.stretchWidth, 0.01);
    return fullWidth * aspect * lengthScale;
  }

  _loop = () => {
    if (this._disposed) return;
    this._raf = requestAnimationFrame(this._loop);

    if (this._needsDeform && this.pathSample && this.ribbon) {
      this._deform();
      this._needsDeform = false;
    }

    this.renderer.render({ scene: this.scene, camera: this.camera });
    if (this.settings.debug) this._drawDebug();
  };

  _deform() {
    const s = this.settings;
    this.deformer.deform(this.ribbon, this.pathSample, this.positions, this.alphas, {
      progress: this.progress,
      brushLengthWorld: this._brushLengthWorld(),
      halfWidthWorld: this._halfWidthWorld(),
      portalRadius: s.portalRadius,
      taperLength: s.taperLength,
      minimumScale: s.minimumScale,
      falloff: s.falloff,
      easing: s.easing,
      frontPortalEnabled: s.frontPortalEnabled ?? s.frontTaper,
      backPortalEnabled: s.backPortalEnabled ?? s.backTaper,
    });
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

    ctx.beginPath();
    ctx.strokeStyle = "rgba(255,80,80,0.85)";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < sample.count; i++) {
      const [sx, sy] = toScreen(sample.positions[i * 2], sample.positions[i * 2 + 1]);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();

    const step = Math.max(1, Math.floor(sample.count / 48));
    for (let i = 0; i < sample.count; i += step) {
      const [sx, sy] = toScreen(sample.positions[i * 2], sample.positions[i * 2 + 1]);
      const nx = sample.normals[i * 2];
      const ny = sample.normals[i * 2 + 1];
      ctx.strokeStyle = "rgba(255,200,60,0.7)";
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + nx * 16, sy + ny * 16);
      ctx.stroke();
    }

    const warn = this.getTextureWarning();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(`v6 TEXTURE  progress ${(this.progress * 100).toFixed(1)}%`, 12, 20);
    ctx.fillText(
      `tex ${this._rasterInfo?.width || "?"}×${this._rasterInfo?.height || "?"}  res ${this.settings.textureResolution}`,
      12,
      36
    );
    ctx.fillText(`frames ${sample.frameMode}  samples ${sample.count}`, 12, 52);
    ctx.fillStyle =
      warn.level === "danger"
        ? "rgba(255,120,100,0.95)"
        : warn.level === "caution"
          ? "rgba(255,200,100,0.95)"
          : "rgba(160,220,160,0.9)";
    ctx.fillText(warn.message.slice(0, 72), 12, 68);
  }
}

export default BrushRenderer;
