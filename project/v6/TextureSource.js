/** @version v6 — texture rasterization (SVG/PNG/JPG/WEBP) */
/**
 * TextureSource
 * -------------
 * Rasterizes brush artwork ONCE into an ImageBitmap / canvas,
 * preserving aspect ratio at a configurable max edge resolution.
 *
 * SVG is never triangulated — only drawn to an OffscreenCanvas / canvas.
 */

export const TEXTURE_RESOLUTIONS = [1024, 2048, 4096, 8192];

/**
 * Rough mobile heuristic for perf warnings (not perfect, good enough for UI).
 */
export function isMobileDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/Mobi|Android|iPhone|iPod|webOS|BlackBerry|IEMobile/i.test(ua)) return true;
  // iPadOS 13+ reports as Mac; use touch points
  if (/Macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1) return true;
  return false;
}

/**
 * Human-readable warning for a chosen texture resolution.
 * @param {number} resolution
 * @param {{maxTextureSize?: number}} [info]
 * @returns {{level: 'ok'|'caution'|'danger', message: string}}
 */
export function textureResolutionWarning(resolution, info = {}) {
  const mobile = isMobileDevice();
  const maxGL = info.maxTextureSize || 0;
  const res = Number(resolution);

  if (maxGL > 0 && res > maxGL) {
    return {
      level: "danger",
      message: `GPU max texture is ${maxGL}px — ${res} will be clamped. Pick ≤ ${maxGL}.`,
    };
  }

  if (res >= 8192) {
    return {
      level: "danger",
      message: mobile
        ? "⚠️ 8192 di HP biasanya LELOT / gagal (VRAM). Pakai 1024 atau 2048."
        : "⚠️ 8192 is heavy — may fail on many GPUs. Prefer 2048–4096.",
    };
  }

  if (res >= 4096) {
    return {
      level: "caution",
      message: mobile
        ? "⚠️ 4096 di HP bisa ngelag / panas. Disarankan 1024–2048."
        : "4096 is fine on desktop; watch memory on integrated GPUs.",
    };
  }

  if (res >= 2048 && mobile) {
    return {
      level: "caution",
      message: "2048 biasanya OK di HP modern; kalau lag, turunkan ke 1024.",
    };
  }

  return {
    level: "ok",
    message: mobile
      ? "Resolusi aman untuk sebagian besar HP."
      : "Resolusi aman untuk desktop & kebanyakan mobile.",
  };
}

async function loadAsObjectURL(source) {
  if (source instanceof File) {
    return {
      url: URL.createObjectURL(source),
      mime: source.type || "",
      name: source.name || "",
      revoke: true,
    };
  }

  const url = String(source);
  const lower = url.toLowerCase();
  let mime = "";
  if (lower.endsWith(".svg")) mime = "image/svg+xml";
  else if (lower.endsWith(".png")) mime = "image/png";
  else if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) mime = "image/jpeg";
  else if (lower.endsWith(".webp")) mime = "image/webp";

  return { url, mime, name: url, revoke: false };
}

function isSvg(mime, name) {
  return (
    mime.includes("svg") ||
    /\.svg(\?|$)/i.test(name) ||
    mime === "image/svg+xml"
  );
}

/**
 * Load an HTMLImageElement from a URL.
 * @param {string} url
 */
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

/**
 * For SVG files, rewrite root width/height so rasterization is sharp.
 * @param {string} svgText
 * @param {number} targetLongEdge
 */
function prepareSvgMarkup(svgText, targetLongEdge) {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg) throw new Error("TextureSource: invalid SVG");

  let vb = svg.getAttribute("viewBox");
  let vw;
  let vh;
  if (vb) {
    const p = vb.trim().split(/[\s,]+/).map(Number);
    vw = p[2];
    vh = p[3];
  } else {
    vw = parseFloat(svg.getAttribute("width")) || 1000;
    vh = parseFloat(svg.getAttribute("height")) || 10;
    svg.setAttribute("viewBox", `0 0 ${vw} ${vh}`);
  }

  const aspect = vw / Math.max(vh, 1e-6);
  let outW;
  let outH;
  if (aspect >= 1) {
    outW = targetLongEdge;
    outH = Math.max(1, Math.round(targetLongEdge / aspect));
  } else {
    outH = targetLongEdge;
    outW = Math.max(1, Math.round(targetLongEdge * aspect));
  }

  svg.setAttribute("width", String(outW));
  svg.setAttribute("height", String(outH));

  const serialized = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
  return {
    url: URL.createObjectURL(blob),
    width: outW,
    height: outH,
    aspect,
  };
}

/**
 * Rasterize source into a canvas at the given long-edge resolution.
 * @param {string|File} source
 * @param {number} textureResolution  long edge in px (1024…8192)
 * @param {{maxTextureSize?: number}} [options]
 * @returns {Promise<{canvas: HTMLCanvasElement|OffscreenCanvas, width: number, height: number, aspect: number, resolution: number}>}
 */
export async function rasterizeBrush(source, textureResolution, options = {}) {
  const maxGL = options.maxTextureSize || 8192;
  let res = Math.min(Number(textureResolution) || 2048, maxGL);
  // Snap to allowed set when close; otherwise keep clamped value
  if (!TEXTURE_RESOLUTIONS.includes(res)) {
    res = TEXTURE_RESOLUTIONS.reduce((best, v) =>
      Math.abs(v - res) < Math.abs(best - res) ? v : best
    );
    res = Math.min(res, maxGL);
  }

  const loaded = await loadAsObjectURL(source);
  let drawUrl = loaded.url;
  let revokeExtra = null;
  let targetW;
  let targetH;
  let aspect;

  try {
    if (isSvg(loaded.mime, loaded.name)) {
      const svgText =
        source instanceof File
          ? await source.text()
          : await fetch(loaded.url).then((r) => {
              if (!r.ok) throw new Error(`Failed to fetch SVG: ${loaded.url}`);
              return r.text();
            });
      const prepared = prepareSvgMarkup(svgText, res);
      drawUrl = prepared.url;
      revokeExtra = prepared.url;
      targetW = prepared.width;
      targetH = prepared.height;
      aspect = prepared.aspect;
    }

    const img = await loadImage(drawUrl);

    if (!isSvg(loaded.mime, loaded.name)) {
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      aspect = iw / Math.max(ih, 1e-6);
      if (aspect >= 1) {
        targetW = res;
        targetH = Math.max(1, Math.round(res / aspect));
      } else {
        targetH = res;
        targetW = Math.max(1, Math.round(res * aspect));
      }
      // Clamp to GPU max
      if (targetW > maxGL || targetH > maxGL) {
        const s = maxGL / Math.max(targetW, targetH);
        targetW = Math.max(1, Math.floor(targetW * s));
        targetH = Math.max(1, Math.floor(targetH * s));
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;

    const ctx = canvas.getContext("2d", { alpha: true });
    ctx.clearRect(0, 0, targetW, targetH);
    ctx.drawImage(img, 0, 0, targetW, targetH);

    return {
      canvas,
      width: targetW,
      height: targetH,
      aspect: aspect || targetW / targetH,
      resolution: res,
    };
  } finally {
    if (loaded.revoke) URL.revokeObjectURL(loaded.url);
    if (revokeExtra) URL.revokeObjectURL(revokeExtra);
  }
}

export default {
  rasterizeBrush,
  textureResolutionWarning,
  isMobileDevice,
  TEXTURE_RESOLUTIONS,
};
