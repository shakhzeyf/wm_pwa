WM Stamp PWA (offline)

What it does:
- Open PDF or image
- Fixed-size area (mm) at chosen DPI
- Apply WM1 randomly (+/-30 deg) and optionally WM2 on top (+/-5 deg), random within area
- Linear Burn or Normal blending
- Undo (Ctrl+Z)
- Export to PDF (raster) or PNG

IMPORTANT:
PWA needs to be served over HTTPS (or localhost) for Service Worker/offline.
Suggested: GitHub Pages / any static host.

Quick test on PC:
- Use any static server (e.g. python -m http.server 8080) in this folder
- Open http://localhost:8080
- Then on phone open the same (if on same network) or host online.

Files:
- index.html, app.js, styles.css, sw.js, manifest.json
- watermarks/*.png
