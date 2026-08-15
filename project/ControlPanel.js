/**
 * ControlPanel
 * ------------
 * Floating debug UI — v1–v6 toggle, live taper, texture HD + mobile warnings.
 */

import {
  textureResolutionWarning,
  isMobileDevice,
} from "./v6/TextureSource.js";

const BASE_CONTROLS = [
  {
    key: "pathSizeVw",
    label: "Path size",
    unit: "vw",
    min: 20,
    max: 120,
    step: 1,
  },
  {
    key: "brushSizeVw",
    label: "Brush size",
    unit: "vw",
    min: 0.2,
    max: 12,
    step: 0.1,
  },
  {
    key: "pageHeightVh",
    label: "Page height",
    unit: "vh",
    min: 100,
    max: 800,
    step: 10,
  },
  {
    key: "pathScale",
    label: "Path thickness",
    unit: "×",
    min: 0.1,
    max: 4,
    step: 0.05,
  },
  {
    key: "stretchWidth",
    labelV1: "Stretch width",
    labelDefault: "Length scale",
    unit: "",
    minV1: 0.02,
    maxV1: 0.6,
    stepV1: 0.01,
    minDefault: 0.25,
    maxDefault: 3,
    stepDefault: 0.05,
  },
  {
    key: "wormholeSize",
    label: "Wormhole size",
    unit: "",
    min: 0,
    max: 0.45,
    step: 0.01,
  },
];

const TAPER_CONTROLS = [
  {
    key: "portalRadius",
    label: "Portal radius",
    unit: "",
    min: 0,
    max: 0.5,
    step: 0.01,
  },
  {
    key: "taperLength",
    label: "Taper length",
    unit: "",
    min: 0,
    max: 0.5,
    step: 0.01,
  },
  {
    key: "taperStrength",
    label: "Taper strength",
    unit: "",
    min: 0,
    max: 2,
    step: 0.05,
    hideOn: ["v6"],
  },
  {
    key: "falloff",
    label: "Falloff",
    unit: "",
    min: 0.2,
    max: 3,
    step: 0.05,
    onlyOn: ["v6"],
  },
  {
    key: "minimumScale",
    label: "Minimum scale",
    unit: "",
    min: 0,
    max: 1,
    step: 0.01,
  },
];

const EASING_OPTIONS = [
  "linear",
  "smoothstep",
  "smootherstep",
  "easeInQuad",
  "easeOutQuad",
  "easeInOutCubic",
  "easeOutExpo",
];

const VERSION_HINTS = {
  v1: "v1: strip ribbon mesh",
  v2: "v2: exact SVG · hard portal clip",
  v3: "v3: exact SVG · width taper",
  v4: "v4: adaptive Frenet · live taper",
  v5: "v5: Parallel Transport Frames",
  v6: "v6: GPU texture warp (SVG→raster)",
};

const LATEST_VERSION = "v6";

const TEXTURE_TIERS = [
  { label: "Low", value: 1024 },
  { label: "Medium", value: 2048 },
  { label: "High", value: 4096 },
];

const CHEVRON_ICON =
  '<svg width="6" height="9" viewBox="0 0 6 9" fill="none" aria-hidden="true"><path opacity="0.5" d="M5.13 4.45915L0.670846 8.91831L0 8.24746L0.335423 7.91204L3.80804 4.45915L0.0197304 0.670847L0.670846 0L5.13 4.45915Z" fill="currentColor"/></svg>';

const CHEVRON_LEFT_ICON =
  '<svg width="6" height="9" viewBox="0 0 6 9" fill="none" aria-hidden="true"><path opacity="0.5" d="M-0.000116912 4.45882L4.45904 -0.000341474L5.12988 0.670508L4.79446 1.00593L1.32184 4.45882L5.11015 8.24712L4.45904 8.91797L-0.000116912 4.45882Z" fill="currentColor"/></svg>';

const CHEVRON_SMALL_ICON =
  '<svg width="7" height="4" viewBox="0 0 7 4" fill="none" aria-hidden="true"><path opacity="0.3" d="M3.47692 4L0 0.523077L0.523077 0L0.784615 0.261538L3.47692 2.96923L6.43077 0.0153846L6.95385 0.523077L3.47692 4Z" fill="currentColor"/></svg>';

const CHECK_ICON =
  '<svg width="7" height="7" viewBox="0 0 7 7" fill="none" aria-hidden="true"><path d="M0.833008 3.74967L2.49967 5.41634L5.83301 0.833008" stroke="#000" stroke-width="1.66667" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const UPLOAD_ICON =
  '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path opacity="0.4" d="M7.875 3.00098V9.61816C7.875 10.1104 7.46484 10.4932 7 10.4932C6.50781 10.4932 6.125 10.1104 6.125 9.61816V3.00098L4.10156 4.99707C3.77344 5.35254 3.19922 5.35254 2.87109 4.99707C2.51562 4.66895 2.51562 4.09473 2.87109 3.7666L6.37109 0.266602C6.69922 -0.0888672 7.27344 -0.0888672 7.60156 0.266602L11.1016 3.7666C11.457 4.09473 11.457 4.66895 11.1016 4.99707C10.7734 5.35254 10.1992 5.35254 9.87109 4.99707L7.875 3.00098ZM1.75 9.61816H5.25C5.25 10.6025 6.01562 11.3682 7 11.3682C7.95703 11.3682 8.75 10.6025 8.75 9.61816H12.25C13.207 9.61816 14 10.4111 14 11.3682V12.2432C14 13.2275 13.207 13.9932 12.25 13.9932H1.75C0.765625 13.9932 0 13.2275 0 12.2432V11.3682C0 10.4111 0.765625 9.61816 1.75 9.61816ZM11.8125 12.4619C12.168 12.4619 12.4688 12.1885 12.4688 11.8057C12.4688 11.4502 12.168 11.1494 11.8125 11.1494C11.4297 11.1494 11.1562 11.4502 11.1562 11.8057C11.1562 12.1885 11.4297 12.4619 11.8125 12.4619Z" fill="currentColor"/></svg>';

const GEAR_ICON =
  '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path opacity="0.2" d="M13.1466 4.56641C13.256 4.8125 13.174 5.05859 12.9826 5.25L11.8068 6.31641C11.8341 6.53516 11.8341 6.78125 11.8341 7C11.8341 7.24609 11.8341 7.49219 11.8068 7.71094L12.9826 8.77734C13.174 8.94141 13.256 9.21484 13.1466 9.46094C13.0373 9.78906 12.9006 10.0898 12.7365 10.3906L12.5998 10.6094C12.4084 10.9102 12.217 11.2109 11.9982 11.457C11.8341 11.6758 11.5607 11.7305 11.3146 11.6484L9.81071 11.1836C9.4279 11.457 9.01774 11.6758 8.60758 11.8672L8.25211 13.4258C8.19743 13.6719 8.00602 13.8633 7.75993 13.918C7.37711 13.9727 6.9943 14 6.58415 14C6.20133 14 5.81852 13.9727 5.43571 13.918C5.18961 13.8633 4.99821 13.6719 4.94352 13.4258L4.58805 11.8672C4.15055 11.6758 3.76774 11.457 3.38493 11.1836L1.88102 11.6484C1.63493 11.7305 1.36149 11.6758 1.19743 11.4844C0.978677 11.2109 0.78727 10.9102 0.595864 10.6094L0.459145 10.3906C0.295083 10.0898 0.158364 9.78906 0.0489891 9.46094C-0.0603859 9.21484 0.0216454 8.96875 0.213052 8.77734L1.38883 7.71094C1.36149 7.49219 1.36149 7.24609 1.36149 7C1.36149 6.78125 1.36149 6.53516 1.38883 6.31641L0.213052 5.25C0.0216454 5.05859 -0.0603859 4.8125 0.0489891 4.56641C0.158364 4.23828 0.295083 3.9375 0.459145 3.63672L0.595864 3.41797C0.78727 3.11719 0.978677 2.81641 1.19743 2.54297C1.36149 2.35156 1.63493 2.29688 1.88102 2.37891L3.38493 2.84375C3.76774 2.57031 4.1779 2.32422 4.58805 2.16016L4.94352 0.601562C4.99821 0.355469 5.18961 0.164062 5.43571 0.109375C5.81852 0.0546875 6.20133 0 6.61149 0C6.9943 0 7.37711 0.0546875 7.75993 0.109375C8.00602 0.136719 8.19743 0.355469 8.25211 0.601562L8.60758 2.16016C9.04508 2.32422 9.4279 2.57031 9.81071 2.84375L11.3146 2.37891C11.5607 2.29688 11.8341 2.35156 11.9982 2.54297C12.217 2.81641 12.4084 3.11719 12.5998 3.41797L12.7365 3.63672C12.9006 3.9375 13.0373 4.23828 13.174 4.56641H13.1466ZM6.61149 9.1875C7.37711 9.1875 8.08805 8.77734 8.49821 8.09375C8.88102 7.4375 8.88102 6.58984 8.49821 5.90625C8.08805 5.25 7.37711 4.8125 6.61149 4.8125C5.81852 4.8125 5.10758 5.25 4.69743 5.90625C4.31461 6.58984 4.31461 7.4375 4.69743 8.09375C5.10758 8.77734 5.81852 9.1875 6.61149 9.1875Z" fill="currentColor"/></svg>';

function hasLiveTaper(version) {
  return version === "v4" || version === "v5" || version === "v6";
}

function isTextureVersion(version) {
  return version === "v6";
}

export class ControlPanel {
  constructor(options) {
    this.renderer = options.renderer;
    this.mount = options.mount || document.body;
    this.onChange = options.onChange || (() => {});
    this.onPageHeightChange = options.onPageHeightChange || (() => {});
    this.onAssetChange = options.onAssetChange || (() => {});
    this.onVersionChange = options.onVersionChange || (() => {});
    this.version = options.version || "v6";
    this._switching = false;

    this.root = this._build();
    this.fab = this._buildFab();
    this.mount.appendChild(this.root);
    document.body.appendChild(this.fab);
    this._applyVersionUI();
    this.syncFromRenderer();
  }

  setRenderer(renderer) {
    this.renderer = renderer;
    this.version = renderer.version || renderer.getSettings?.().version || this.version;
    this._switching = false;
    this._applyVersionUI();
    this.syncFromRenderer();
  }

  syncFromRenderer() {
    if (!this.renderer) return;
    const s = this.renderer.getSettings();
    this.version = s.version || this.version;
    this._applyVersionUI();

    this.root.querySelectorAll("[data-key]").forEach((el) => {
      const key = el.dataset.key;
      if (s[key] == null && el.type !== "checkbox") return;
      if (el.type === "checkbox") {
        el.checked = !!s[key];
      } else if (el.tagName === "SELECT") {
        el.value = String(s[key]);
      } else if (el.type === "range") {
        el.value = s[key];
        this._updateSliderVisual(el);
        const readout = this.root.querySelector(`[data-readout="${key}"]`);
        const ctrl = [...BASE_CONTROLS, ...TAPER_CONTROLS].find((c) => c.key === key);
        if (readout && ctrl) readout.textContent = this._format(ctrl, s[key]);
      }
    });

    this._updateTextureWarning(s);
    this._updateJson(s);
  }

  updateProgressOnly(progress) {
    const node = this.root.querySelector("[data-json]");
    if (!node) return;
    try {
      const data = JSON.parse(node.textContent);
      data.progress = Number(Number(progress).toFixed(4));
      node.textContent = JSON.stringify(data, null, 2);
    } catch {
      this._updateJson(this.renderer.getSettings());
    }
  }

  destroy() {
    this.fab?.remove();
    this.root.remove();
  }

  _setCollapsed(collapsed) {
    this.root.classList.toggle("is-collapsed", collapsed);
    this.root.hidden = collapsed;
    this.fab.hidden = !collapsed;
    document.body.classList.toggle("panel-open", !collapsed);
    document.body.classList.toggle("panel-collapsed", collapsed);
    const toggle = this.root.querySelector("[data-collapse]");
    toggle?.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }

  _buildFab() {
    const fab = document.createElement("button");
    fab.type = "button";
    fab.className = "control-panel__fab";
    fab.hidden = true;
    fab.setAttribute("aria-label", "Open control panel");
    fab.innerHTML = `
      <span class="control-panel__fab-chevron">${CHEVRON_LEFT_ICON}</span>
      <span class="control-panel__fab-gear">${GEAR_ICON}</span>
    `;
    fab.addEventListener("click", () => this._setCollapsed(false));
    return fab;
  }

  _build() {
    const el = document.createElement("aside");
    el.className = "control-panel";
    el.innerHTML = `
      <header class="control-panel__header">
        <button type="button" class="control-panel__header-toggle" data-collapse aria-expanded="true">
          <span class="control-panel__header-inner">
            <span class="control-panel__title">Control Panel</span>
            <span class="control-panel__chevron">${CHEVRON_ICON}</span>
          </span>
        </button>
      </header>
      <div class="control-panel__body" data-body>
        <div class="control-panel__block control-panel__block--version">
          <div class="control-panel__field-row">
            <span class="control-panel__field-label">Experiment Version</span>
            <div class="control-panel__select-btn">
              <select data-version-select aria-label="Engine version">
                <option value="v1">v1</option>
                <option value="v2">v2</option>
                <option value="v3">v3</option>
                <option value="v4">v4</option>
                <option value="v5">v5</option>
                <option value="v6">v6</option>
              </select>
              <span class="control-panel__select-chevron">${CHEVRON_SMALL_ICON}</span>
            </div>
          </div>
          <label class="control-panel__toggle">
            <input type="checkbox" data-use-latest />
            <span class="control-panel__checkbox" aria-hidden="true">${CHECK_ICON}</span>
            <span>Use Latest Version</span>
          </label>
          <label class="control-panel__toggle">
            <input type="checkbox" data-key="debug" />
            <span class="control-panel__checkbox" aria-hidden="true">${CHECK_ICON}</span>
            <span>Debug overlay</span>
          </label>
          <p class="control-panel__hint" data-version-hint></p>
        </div>

        <div class="control-panel__block control-panel__block--texture" data-texture-section hidden>
          <div class="control-panel__field">
            <span class="control-panel__field-label">Texture resolution</span>
            <div class="control-panel__segmented" data-texture-segments role="group" aria-label="Texture resolution"></div>
          </div>
          <p class="control-panel__warn" data-texture-warn></p>
        </div>

        <div class="control-panel__block control-panel__block--sliders" data-sliders-base></div>

        <div class="control-panel__block control-panel__block--taper" data-taper-section>
          <div data-sliders-taper></div>
          <div class="control-panel__field control-panel__field--tight">
            <span class="control-panel__field-label">Easing curve</span>
            <div class="control-panel__select-btn control-panel__select-btn--wide">
              <select data-key="easing" class="control-panel__select-native" aria-label="Easing curve"></select>
              <span class="control-panel__select-chevron">${CHEVRON_SMALL_ICON}</span>
            </div>
          </div>
          <label class="control-panel__toggle">
            <input type="checkbox" data-key="backTaper" data-portal="back" />
            <span class="control-panel__checkbox" aria-hidden="true">${CHECK_ICON}</span>
            <span>Back portal (entrance)</span>
          </label>
          <label class="control-panel__toggle">
            <input type="checkbox" data-key="frontTaper" data-portal="front" />
            <span class="control-panel__checkbox" aria-hidden="true">${CHECK_ICON}</span>
            <span>Front portal (exit)</span>
          </label>
        </div>

        <div class="control-panel__block control-panel__block--assets">
          <label class="control-panel__file">
            <span class="control-panel__field-label">Brush asset</span>
            <span class="control-panel__file-drop">
              <span class="control-panel__upload-icon">${UPLOAD_ICON}</span>
              <span class="control-panel__file-text">SVG / PNG / JPG / WEBP</span>
            </span>
            <input type="file" accept=".svg,.png,.jpg,.jpeg,.webp,image/*" data-asset="brush" />
          </label>
          <label class="control-panel__file">
            <span class="control-panel__field-label">Path SVG</span>
            <span class="control-panel__file-drop">
              <span class="control-panel__upload-icon">${UPLOAD_ICON}</span>
              <span class="control-panel__file-text">Choose file</span>
            </span>
            <input type="file" accept=".svg,image/svg+xml" data-asset="path" />
          </label>
        </div>

        <div class="control-panel__block control-panel__json-wrap">
          <div class="control-panel__json-head">
            <span class="control-panel__field-label">Settings JSON</span>
            <button type="button" class="control-panel__ghost-btn" data-copy>Copy</button>
          </div>
          <pre class="control-panel__json" data-json></pre>
        </div>
      </div>
    `;

    const baseHost = el.querySelector("[data-sliders-base]");
    for (const ctrl of BASE_CONTROLS) {
      baseHost.appendChild(this._sliderRow(ctrl));
    }

    const taperHost = el.querySelector("[data-sliders-taper]");
    for (const ctrl of TAPER_CONTROLS) {
      taperHost.appendChild(this._sliderRow(ctrl));
    }

    const segmentHost = el.querySelector("[data-texture-segments]");
    for (const tier of TEXTURE_TIERS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.res = String(tier.value);
      btn.textContent = tier.label;
      segmentHost.appendChild(btn);
    }

    const easing = el.querySelector('[data-key="easing"]');
    for (const name of EASING_OPTIONS) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      easing.appendChild(opt);
    }

    el.querySelector("[data-collapse]").addEventListener("click", () => {
      this._setCollapsed(!this.root.classList.contains("is-collapsed"));
    });

    el.querySelectorAll("input[type=range]").forEach((input) => {
      input.addEventListener("input", () => {
        this._updateSliderVisual(input);
        this._onSlider(input);
      });
      this._updateSliderVisual(input);
    });

    el.querySelectorAll('input[type=checkbox][data-key]').forEach((input) => {
      input.addEventListener("change", () => {
        const key = input.dataset.key;
        const checked = input.checked;
        const patch = { [key]: checked };
        if (key === "frontTaper") patch.frontPortalEnabled = checked;
        if (key === "backTaper") patch.backPortalEnabled = checked;
        this._apply(patch);
      });
    });

    segmentHost.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const value = Number(btn.dataset.res);
        this._syncTextureSegments(value);
        this._updateTextureWarning({ textureResolution: value });
        this._apply({ textureResolution: value });
      });
    });

    easing.addEventListener("change", () => {
      this._apply({ easing: easing.value });
    });

    const versionSelect = el.querySelector("[data-version-select]");
    versionSelect.addEventListener("change", async () => {
      const next = versionSelect.value;
      if (next === this.version || this._switching) return;
      this._switching = true;
      el.classList.add("is-switching");
      try {
        await this.onVersionChange(next);
      } finally {
        this._switching = false;
        el.classList.remove("is-switching");
      }
    });

    const useLatest = el.querySelector("[data-use-latest]");
    useLatest.addEventListener("change", async () => {
      versionSelect.disabled = useLatest.checked;
      if (!useLatest.checked || this.version === LATEST_VERSION || this._switching) {
        return;
      }
      this._switching = true;
      el.classList.add("is-switching");
      try {
        await this.onVersionChange(LATEST_VERSION);
      } finally {
        this._switching = false;
        el.classList.remove("is-switching");
      }
    });

    el.querySelectorAll("[data-asset]").forEach((input) => {
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (!file) return;
        this.onAssetChange(input.dataset.asset, file);
        const label = input.closest(".control-panel__file");
        const text = label?.querySelector(".control-panel__file-text");
        if (text) text.textContent = file.name;
      });
    });

    el.querySelector("[data-copy]").addEventListener("click", async () => {
      const text = el.querySelector("[data-json]").textContent;
      try {
        await navigator.clipboard.writeText(text);
        const btn = el.querySelector("[data-copy]");
        const prev = btn.textContent;
        btn.textContent = "Copied";
        setTimeout(() => {
          btn.textContent = prev;
        }, 1200);
      } catch {
        /* ignore */
      }
    });

    return el;
  }

  _sliderRow(ctrl) {
    const row = document.createElement("label");
    row.className = "control-panel__slider";
    row.dataset.control = ctrl.key;
    if (ctrl.onlyOn) row.dataset.onlyOn = ctrl.onlyOn.join(",");
    if (ctrl.hideOn) row.dataset.hideOn = ctrl.hideOn.join(",");
    const range = this._rangeFor(ctrl);
    row.innerHTML = `
      <div class="control-panel__row-top">
        <span data-label="${ctrl.key}">${this._labelFor(ctrl)}</span>
        <span data-readout="${ctrl.key}"></span>
      </div>
      <div class="control-panel__slider-area">
        <div class="control-panel__slider-rail" aria-hidden="true"></div>
        <div class="control-panel__slider-fill" aria-hidden="true"></div>
        <div class="control-panel__slider-thumb" aria-hidden="true"></div>
        <input
          type="range"
          data-key="${ctrl.key}"
          min="${range.min}"
          max="${range.max}"
          step="${range.step}"
        />
      </div>
    `;
    return row;
  }

  _updateSliderVisual(input) {
    const min = Number(input.min);
    const max = Number(input.max);
    const val = Number(input.value);
    const pct = max === min ? 0 : (val - min) / (max - min);
    const track = input.closest(".control-panel__slider-area");
    if (track) track.style.setProperty("--pct", String(pct));
  }

  _labelFor(ctrl) {
    if (this.version === "v1" && ctrl.labelV1) return ctrl.labelV1;
    return ctrl.label || ctrl.labelDefault || ctrl.labelV1;
  }

  _rangeFor(ctrl) {
    if (this.version === "v1" && ctrl.minV1 != null) {
      return { min: ctrl.minV1, max: ctrl.maxV1, step: ctrl.stepV1 };
    }
    if (ctrl.minDefault != null) {
      return {
        min: ctrl.minDefault,
        max: ctrl.maxDefault,
        step: ctrl.stepDefault,
      };
    }
    return { min: ctrl.min, max: ctrl.max, step: ctrl.step };
  }

  _applyVersionUI() {
    const versionSelect = this.root.querySelector("[data-version-select]");
    if (versionSelect) {
      versionSelect.value = this.version;
      const useLatest = this.root.querySelector("[data-use-latest]");
      versionSelect.disabled = !!useLatest?.checked;
    }

    const hint = this.root.querySelector("[data-version-hint]");
    if (hint) hint.textContent = VERSION_HINTS[this.version] || "";

    const taperSection = this.root.querySelector("[data-taper-section]");
    if (taperSection) taperSection.hidden = !hasLiveTaper(this.version);

    const texSection = this.root.querySelector("[data-texture-section]");
    if (texSection) texSection.hidden = !isTextureVersion(this.version);

    const wormholeRow = this.root.querySelector('[data-control="wormholeSize"]');
    if (wormholeRow) wormholeRow.hidden = hasLiveTaper(this.version);

    this.root.querySelectorAll("[data-only-on]").forEach((row) => {
      const allowed = row.dataset.onlyOn.split(",");
      row.hidden = !allowed.includes(this.version);
    });
    this.root.querySelectorAll("[data-hide-on]").forEach((row) => {
      const blocked = row.dataset.hideOn.split(",");
      row.hidden = blocked.includes(this.version);
    });

    for (const ctrl of BASE_CONTROLS) {
      const input = this.root.querySelector(`[data-key="${ctrl.key}"]`);
      const label = this.root.querySelector(`[data-label="${ctrl.key}"]`);
      if (!input || input.type !== "range") continue;
      if (label) label.textContent = this._labelFor(ctrl);
      const range = this._rangeFor(ctrl);
      input.min = range.min;
      input.max = range.max;
      input.step = range.step;
      this._updateSliderVisual(input);
    }

    const settings = this.renderer?.getSettings?.();
    if (settings?.textureResolution != null) {
      this._syncTextureSegments(settings.textureResolution);
    }
  }

  _syncTextureSegments(resolution) {
    const res = Number(resolution);
    const tiers = TEXTURE_TIERS.map((tier) => tier.value);
    const active =
      tiers.find((value) => value === res) ??
      tiers.reduce((closest, value) =>
        Math.abs(value - res) < Math.abs(closest - res) ? value : closest
      );

    this.root.querySelectorAll("[data-texture-segments] button").forEach((btn) => {
      btn.classList.toggle("is-active", Number(btn.dataset.res) === active);
    });
  }

  _updateTextureWarning(settings) {
    const node = this.root.querySelector("[data-texture-warn]");
    if (!node) return;
    const res = settings.textureResolution ?? 2048;
    this._syncTextureSegments(res);

    const live =
      typeof this.renderer?.getTextureWarning === "function"
        ? this.renderer.getTextureWarning()
        : textureResolutionWarning(res);

    node.textContent = live.message;
    node.dataset.level = live.level;
    node.hidden = !isTextureVersion(this.version);

    if (isMobileDevice() && res >= 4096) {
      node.textContent = live.message;
    }
  }

  _onSlider(input) {
    const key = input.dataset.key;
    const value = Number(input.value);
    const ctrl = [...BASE_CONTROLS, ...TAPER_CONTROLS].find((c) => c.key === key);
    const readout = this.root.querySelector(`[data-readout="${key}"]`);
    if (readout && ctrl) readout.textContent = this._format(ctrl, value);
    this._apply({ [key]: value });
  }

  async _apply(partial) {
    await this.renderer.setSettings(partial);
    if (partial.pageHeightVh != null) {
      this.onPageHeightChange(partial.pageHeightVh);
    }
    const settings = this.renderer.getSettings();
    this._updateTextureWarning(settings);
    this._updateJson(settings);
    this.onChange(settings);
  }

  _updateJson(settings) {
    const payload = {
      version: settings.version || this.version,
      pathSizeVw: settings.pathSizeVw,
      brushSizeVw: settings.brushSizeVw,
      pageHeightVh: settings.pageHeightVh,
      pathScale: settings.pathScale,
      stretchWidth: settings.stretchWidth,
      debug: settings.debug,
      brush: settings.brush || settings.source,
      path: settings.path,
      progress: settings.progress,
    };

    if (hasLiveTaper(payload.version)) {
      Object.assign(payload, {
        portalRadius: settings.portalRadius,
        taperLength: settings.taperLength,
        minimumScale: settings.minimumScale,
        easing: settings.easing,
        frontTaper: settings.frontTaper ?? settings.frontPortalEnabled,
        backTaper: settings.backTaper ?? settings.backPortalEnabled,
      });
      if (payload.version === "v6") {
        payload.falloff = settings.falloff;
        payload.textureResolution = settings.textureResolution;
        payload.textureWidth = settings.textureWidth;
        payload.textureHeight = settings.textureHeight;
        payload.frontPortalEnabled = settings.frontPortalEnabled;
        payload.backPortalEnabled = settings.backPortalEnabled;
      } else {
        payload.taperStrength = settings.taperStrength;
      }
    } else {
      payload.wormholeSize = settings.wormholeSize;
    }

    const node = this.root.querySelector("[data-json]");
    if (node) node.textContent = JSON.stringify(payload, null, 2);
  }

  _format(ctrl, value) {
    const n = Number(value);
    const range = this._rangeFor(ctrl);
    const step = range.step ?? 1;
    const pretty =
      step < 1
        ? n.toFixed(2).replace(/\.?0+$/, "")
        : String(Math.round(n * 100) / 100);
    return ctrl.unit ? `${pretty}${ctrl.unit}` : pretty;
  }
}

export default ControlPanel;
