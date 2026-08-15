/**
 * main.js
 * -------
 * Bootstraps BrushRenderer (v1–v6) + ScrollTrigger + ControlPanel.
 * Version switches preserve progress + shared settings smoothly.
 */

import gsap from "https://esm.sh/gsap@3.12.5";
import { ScrollTrigger } from "https://esm.sh/gsap@3.12.5/ScrollTrigger";
import {
  createEngine,
  SHARED_DEFAULTS,
  VERSION_DEFAULTS,
  CROSS_VERSION_KEYS,
} from "./createEngine.js";
import { ControlPanel } from "./ControlPanel.js";

gsap.registerPlugin(ScrollTrigger);

const BRUSH_URL = "../assets/brush.svg";
const PATH_URL = "../assets/path.svg";
const INITIAL_VERSION = "v6";

const scrollRoot = document.querySelector("#scroll-root");
const sticky = document.querySelector("#sticky-viewport");
const canvasHost = document.querySelector("#canvas");

/** @type {object|null} */
let brush = null;
/** @type {ControlPanel|null} */
let panel = null;
/** @type {ScrollTrigger|null} */
let scrollTrigger = null;
let switching = false;

let liveSettings = {
  ...SHARED_DEFAULTS,
  ...VERSION_DEFAULTS[INITIAL_VERSION],
  brush: BRUSH_URL,
  path: PATH_URL,
  version: INITIAL_VERSION,
};

function applyPageHeight(vh) {
  scrollRoot.style.height = `${vh}vh`;
  ScrollTrigger.refresh();
}

function bindScroll() {
  if (scrollTrigger) {
    scrollTrigger.kill();
    scrollTrigger = null;
  }

  scrollTrigger = ScrollTrigger.create({
    trigger: scrollRoot,
    start: "top top",
    end: "bottom bottom",
    scrub: true,
    onUpdate: (self) => {
      brush?.setProgress(self.progress);
      panel?.updateProgressOnly(self.progress);
    },
  });
}

function pickCrossSettings(from, version) {
  const out = { ...VERSION_DEFAULTS[version] };
  for (const key of CROSS_VERSION_KEYS) {
    if (from[key] != null) out[key] = from[key];
  }
  // Portal alias sync for v6
  if (version === "v6") {
    if (out.frontTaper != null) out.frontPortalEnabled = out.frontTaper;
    if (out.backTaper != null) out.backPortalEnabled = out.backTaper;
    if (out.portalRadius != null) out.wormholeSize = out.portalRadius;
  }
  return out;
}

/**
 * @param {string} version
 * @param {number} [progress]
 */
async function mountEngine(version, progress = 0) {
  const prevProgress = progress;
  const shared = {
    ...pickCrossSettings(liveSettings, version),
    version,
  };

  const prev = brush;
  brush = null;

  // Tear down previous engine first so canvases never stack
  if (prev) {
    try {
      prev.destroy();
    } catch {
      /* ignore */
    }
  }
  canvasHost.replaceChildren();

  const next = await createEngine(version, {
    container: canvasHost,
    brush: liveSettings.brushSource || liveSettings.brush || BRUSH_URL,
    source: liveSettings.brushSource || liveSettings.brush || BRUSH_URL,
    path: liveSettings.pathSource || liveSettings.path || PATH_URL,
    settings: shared,
  });

  await next.ready;
  next.setProgress(prevProgress);

  brush = next;
  liveSettings = {
    ...brush.getSettings(),
    brushSource: liveSettings.brushSource || liveSettings.brush || BRUSH_URL,
    pathSource: liveSettings.pathSource || liveSettings.path || PATH_URL,
  };

  if (panel) panel.setRenderer(brush);
  window.brushEngine = brush;
  bindScroll();
  ScrollTrigger.refresh();
}

async function boot() {
  applyPageHeight(liveSettings.pageHeightVh);

  await mountEngine(INITIAL_VERSION, 0);

  panel = new ControlPanel({
    renderer: brush,
    version: INITIAL_VERSION,
    mount: document.querySelector("#panel-root"),
    onPageHeightChange: (vh) => {
      liveSettings.pageHeightVh = vh;
      applyPageHeight(vh);
    },
    onAssetChange: async (kind, file) => {
      if (kind === "brush") {
        liveSettings.brushSource = file;
        liveSettings.brush = file.name;
        await brush.setSettings({ brush: file, source: file });
      } else {
        liveSettings.pathSource = file;
        liveSettings.path = file.name;
        await brush.setSettings({ path: file });
      }
      Object.assign(liveSettings, brush.getSettings());
      panel.syncFromRenderer();
      ScrollTrigger.refresh();
    },
    onChange: (settings) => {
      Object.assign(liveSettings, settings);
      // page height handled separately; avoid refresh spam on every slider
      if (settings.pageHeightVh != null) ScrollTrigger.refresh();
    },
    onVersionChange: async (version) => {
      if (switching) return;
      switching = true;
      try {
        const progress = brush?.progress ?? 0;
        const current = brush.getSettings();
        liveSettings = {
          ...liveSettings,
          ...current,
          version,
        };
        await mountEngine(version, progress);
        panel.syncFromRenderer();
      } finally {
        switching = false;
      }
    },
  });

  window.brushPanel = panel;
  void sticky;
}

boot().catch((err) => {
  console.error("[BrushEngine] failed to start:", err);
  const msg = document.createElement("div");
  msg.className = "boot-error";
  msg.textContent =
    "Failed to load brush engine. Double-click “Buka Brush Engine.command” to start.";
  document.body.appendChild(msg);
});
