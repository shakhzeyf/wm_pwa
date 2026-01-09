WM Stamp PWA (offline-friendly)

- Open PDF or image
- Choose fixed-size area in mm at selected DPI
- Apply WM1 randomly (+/-30°) and optionally WM2 on top (+/-5°), random within WM1 bounds
- Blend: Linear Burn (pixel) or Normal
- Undo (Ctrl+Z or button)
- Settings saved (localStorage)
- Export PNG (current page) or PDF (raster, all pages)

IMPORTANT:
- Must be served over HTTPS (or localhost) for Service Worker/offline.
- If PDF.js doesn't load, open in Chrome and check Private DNS / AdBlock.
