/**
 * createEngine
 * ------------
 * Factory that loads v1…v6 BrushRenderer modules.
 */

export const SHARED_DEFAULTS = {
  pathSizeVw: 80,
  brushSizeVw: 1.1,
  pageHeightVh: 300,
  pathScale: 1,
  debug: false,
  version: "v6",
};

export const VERSION_DEFAULTS = {
  v1: {
    brushSizeVw: 2.5,
    stretchWidth: 0.18,
    wormholeSize: 0.12,
    brushColor: "#EEEB5D",
    samples: 512,
    segments: 96,
  },
  v2: {
    brushSizeVw: 1.1,
    stretchWidth: 1,
    wormholeSize: 0.04,
    brushColor: null,
    samples: 512,
  },
  v3: {
    brushSizeVw: 1.1,
    stretchWidth: 1,
    wormholeSize: 0.12,
    brushColor: null,
    samples: 512,
  },
  v4: {
    brushSizeVw: 1.1,
    stretchWidth: 1,
    portalRadius: 0.14,
    taperLength: 0.14,
    taperStrength: 1,
    minimumScale: 0,
    easing: "smootherstep",
    frontTaper: true,
    backTaper: true,
    wormholeSize: 0.14,
    samples: 1024,
    angleThreshDeg: 6,
    brushColor: null,
  },
  v5: {
    brushSizeVw: 1.1,
    stretchWidth: 1,
    portalRadius: 0.14,
    taperLength: 0.14,
    taperStrength: 1,
    minimumScale: 0,
    easing: "smootherstep",
    frontTaper: true,
    backTaper: true,
    wormholeSize: 0.14,
    samples: 1024,
    angleThreshDeg: 6,
    brushColor: null,
  },
  v6: {
    brushSizeVw: 1.1,
    stretchWidth: 1,
    textureResolution: 2048,
    portalRadius: 0.14,
    taperLength: 0.14,
    minimumScale: 0,
    falloff: 1,
    easing: "smootherstep",
    frontPortalEnabled: true,
    backPortalEnabled: true,
    frontTaper: true,
    backTaper: true,
    wormholeSize: 0.14,
    samples: 1024,
    angleThreshDeg: 6,
    ribbonSegments: 160,
  },
};

/** Settings keys that travel across version switches when present. */
export const CROSS_VERSION_KEYS = [
  "pathSizeVw",
  "brushSizeVw",
  "pageHeightVh",
  "pathScale",
  "stretchWidth",
  "debug",
  "portalRadius",
  "taperLength",
  "taperStrength",
  "minimumScale",
  "falloff",
  "easing",
  "frontTaper",
  "backTaper",
  "frontPortalEnabled",
  "backPortalEnabled",
  "wormholeSize",
  "textureResolution",
];

const VALID = new Set(["v1", "v2", "v3", "v4", "v5", "v6"]);

/**
 * @param {string} version
 * @param {Object} options
 */
export async function createEngine(version, options) {
  const v = VALID.has(version) ? version : "v6";
  const mod = await import(`./${v}/BrushRenderer.js`);
  const { BrushRenderer, DEFAULT_SETTINGS } = mod;

  const brushSource = options.source ?? options.brush;
  const settings = {
    ...DEFAULT_SETTINGS,
    ...VERSION_DEFAULTS[v],
    ...(options.settings || {}),
    version: v,
  };

  return new BrushRenderer({
    ...options,
    brush: brushSource,
    source: brushSource,
    path: options.path,
    textureResolution: settings.textureResolution,
    settings,
  });
}

export default createEngine;
