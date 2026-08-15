# WebGL Brush Engine — Scroll-on-Path Demo

An interactive demo where a brush texture travels along an SVG path as you scroll. Use the live **Control Panel** on the right to tweak the look and behavior in real time — no coding required.

---

## What this is

- **Scroll the page** → the brush moves along a curved path.
- **Control Panel (right sidebar)** → change sizes, colors, portals, and more while you watch.
- **Six experiment versions (v1–v6)** → different ways to render the same effect. **v6** is the latest and works best for most use cases.

This project was built as a scroll-on-path experiment inspired by Webflow-style sites.

---

## Quick start

### Option A — Mac (easiest, no Terminal knowledge)

1. [Download or clone](https://github.com/vickyfikri90-cloud/scroll-on-path-webflow) this repo.
2. Double-click **`Buka Brush Engine.command`** in the project folder.
3. Your browser opens automatically at:  
   `http://127.0.0.1:8765/project/index.html`
4. **Keep the Terminal window open** while you use the demo. Close it (or press Ctrl+C) to stop.

### Option B — Manual (Mac, Windows, Linux)

1. Open **Terminal** (Mac/Linux) or **Command Prompt** (Windows) in the project folder.
2. Run:

   ```bash
   python3 -m http.server 8765
   ```

3. Open your browser and go to:  
   `http://127.0.0.1:8765/project/index.html`

> **Why a local server?**  
> The demo loads files from folders (`assets/`, `project/`). Opening `index.html` directly from Finder/Explorer often breaks this. A tiny local server fixes that.

---

## How to use the Control Panel

| Area | What it does |
|------|--------------|
| **Header chevron (›)** | Collapse the sidebar. A **gear button** appears top-right — click it to reopen. |
| **Experiment Version** | Switch between v1–v6 rendering styles. |
| **Use Latest Version** | Automatically use v6 (recommended). |
| **Debug overlay** | Show helper guides on the canvas. |
| **Sliders** | Adjust path size, brush size, page height, thickness, portal effects, and more. |
| **Texture resolution** (v6 only) | **Low / Medium / High** — sharper textures use more GPU power. |
| **Brush asset** | Upload your own brush image (SVG, PNG, JPG, WEBP). |
| **Path SVG** | Upload your own path shape (SVG file). |
| **Settings JSON + Copy** | See all current settings and copy them to share or save. |

**Tip:** Scroll the page to drive the animation. Sliders update the effect live — you do not need to refresh.

---

## Experiment versions (simple guide)

| Version | Best for |
|---------|----------|
| **v1** | Earliest prototype — basic ribbon mesh along the path. |
| **v2** | Follows the exact SVG shape; hard clip at path ends. |
| **v3** | Exact SVG shape with width taper at the ends. |
| **v4** | Smoother path following with live taper controls. |
| **v5** | More stable rotation on curved paths (Parallel Transport Frames). |
| **v6** | **Latest & recommended.** GPU texture warp — best for custom brush images. |

For most people: turn on **Use Latest Version** and stay on **v6**.

---

## Project folders

```
Scroll on Path Webflow/
├── Buka Brush Engine.command   ← double-click to run (Mac)
├── assets/
│   ├── brush.svg               ← default brush shape
│   └── path.svg                ← default path curve
└── project/
    ├── index.html              ← main page (open this in the browser)
    ├── main.js                 ← scroll + engine setup
    ├── ControlPanel.js         ← sidebar UI
    ├── style.css               ← layout and panel styles
    └── v1/ … v6/               ← engine versions (no need to edit these)
```

You only need to worry about **`Buka Brush Engine.command`**, **`assets/`**, and opening **`project/index.html`** through the local server.

---

## Requirements

- A modern browser (Chrome, Safari, Firefox, or Edge)
- **Python 3** — used only to run the local preview server (pre-installed on most Macs)
- No npm install, no build step, no account needed

---

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| **Blank or broken page** | Make sure the server is running and the URL ends with `/project/index.html`. |
| **"Address already in use"** | Another server is on port 8765. Close other Terminal windows or change the port number in `Buka Brush Engine.command`. |
| **Slow or laggy on mobile** | In v6, set **Texture resolution** to **Low** or **Medium**. |
| **Custom brush looks wrong** | Try v6 with a PNG or SVG brush. Adjust **Brush size** and **Path thickness** sliders. |

---

## How it works (optional, for the curious)

```
You scroll  →  GSAP ScrollTrigger  →  Brush Engine (v1–v6)  →  WebGL canvas
                      ↑
              Control Panel adjusts settings live
```

Built with **WebGL** and **[GSAP ScrollTrigger](https://gsap.com/docs/v3/Plugins/ScrollTrigger/)**.

---

## Links

- **Repository:** [github.com/vickyfikri90-cloud/scroll-on-path-webflow](https://github.com/vickyfikri90-cloud/scroll-on-path-webflow)
- **Live preview (local):** `http://127.0.0.1:8765/project/index.html` (after starting the server)

---

## License

This is an experimental demo project. Use and modify freely for learning and prototyping.
