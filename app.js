// WM Stamp PWA (client-side)
// PDF render: PDF.js (global pdfjsLib)
// PDF export: pdf-lib (global PDFLib)
// Processing: Canvas ImageData blending, Linear Burn, WM1+WM2, random rotate, undo
//
// Notes:
// - Export PDF is raster (text not selectable), like desktop version.

const WM1_FILES = ["WM1.1.png", "WM1.2.png", "WM1.3.png"];
const WM2_FILES = ["WM2.1.png", "WM2.2.png", "WM2.3.png"];
const WM1_ROT = 30; // degrees
const WM2_ROT = 5;

const $ = (id) => document.getElementById(id);

const el = {
  fileInput: $("fileInput"),
  btnPrev: $("btnPrev"),
  btnNext: $("btnNext"),
  pageLabel: $("pageLabel"),
  areaW: $("areaW"),
  areaH: $("areaH"),
  dpi: $("dpi"),
  opacity: $("opacity"),
  mode: $("mode"),
  useWm1: $("useWm1"),
  wm1Fit: $("wm1Fit"),
  wm1Scale: $("wm1Scale"),
  useWm2: $("useWm2"),
  wm2Scale: $("wm2Scale"),
  btnApply: $("btnApply"),
  btnUndo: $("btnUndo"),
  btnExportPdf: $("btnExportPdf"),
  btnExportPng: $("btnExportPng"),
  wmInfo: $("wmInfo"),
  status: $("status"),
  pageCanvas: $("pageCanvas"),
  overlayCanvas: $("overlayCanvas"),
  btnInstall: $("btnInstall"),
};

let deferredInstallPrompt = null;

const LS_KEY = "wmstamp.settings.v1";
function loadSettings() {
  const dflt = {
    areaW: 70,
    areaH: 35,
    dpi: 150,
    opacity: 0.85,
    mode: "burn",
    useWm1: true,
    wm1Fit: "contain",
    wm1Scale: 100,
    useWm2: true,
    wm2Scale: 35,
  };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return dflt;
    const obj = JSON.parse(raw);
    return { ...dflt, ...obj };
  } catch {
    return dflt;
  }
}
function saveSettings() {
  const obj = {
    areaW: +el.areaW.value,
    areaH: +el.areaH.value,
    dpi: +el.dpi.value,
    opacity: +el.opacity.value,
    mode: el.mode.value,
    useWm1: el.useWm1.checked,
    wm1Fit: el.wm1Fit.value,
    wm1Scale: +el.wm1Scale.value,
    useWm2: el.useWm2.checked,
    wm2Scale: +el.wm2Scale.value,
  };
  localStorage.setItem(LS_KEY, JSON.stringify(obj));
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function randChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randUniform(a, b) { return a + (b - a) * Math.random(); }

function mmToPx(mm, dpi) {
  return Math.round((mm / 25.4) * dpi);
}

// App state
const state = {
  kind: null, // "pdf" | "image"
  pdfDoc: null,
  pdfPageCount: 0,
  pageIndex: 0,
  // For each page: { baseCanvas, baseW, baseH, pagePtW, pagePtH, placements: [] }
  pages: new Map(),
  // For images:
  imageBitmap: null,
};

const ctxPage = el.pageCanvas.getContext("2d", { willReadFrequently: true });
const ctxOver = el.overlayCanvas.getContext("2d");

const overlay = {
  dragging: false,
  dragOffX: 0,
  dragOffY: 0,
  xN: 0.5, // normalized over available range (0..1)
  yN: 0.5,
};

function setStatus(msg) { el.status.textContent = msg; }

function setUiEnabled(hasDoc) {
  el.btnApply.disabled = !hasDoc;
  el.btnExportPdf.disabled = !hasDoc;
  el.btnExportPng.disabled = !hasDoc;
  el.btnUndo.disabled = !(hasDoc && currentPlacements().length > 0);
  el.btnPrev.disabled = !(hasDoc && state.kind === "pdf" && state.pageIndex > 0);
  el.btnNext.disabled = !(hasDoc && state.kind === "pdf" && state.pageIndex < state.pdfPageCount - 1);
}

function currentPlacements() {
  const p = state.pages.get(state.pageIndex);
  return p ? p.placements : [];
}

// ---------- PWA install ----------
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  el.btnInstall.hidden = false;
});
el.btnInstall.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  el.btnInstall.hidden = true;
});

// ---------- Service worker ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("./sw.js");
    } catch (e) {
      console.warn("SW register failed", e);
    }
  });
}

// ---------- Library setup ----------
function ensurePdfJsWorker() {
  if (!window.pdfjsLib) return false;
  // pdfjs-dist exposes worker in separate file; set workerSrc to CDN
  // Note: pdf.worker.min.js is also loaded by <script>, but set anyway:
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.js";
  } catch {}
  return true;
}

// ---------- Watermarks preloading ----------
const wmCache = new Map(); // url -> HTMLImageElement
async function loadImage(url) {
  if (wmCache.has(url)) return wmCache.get(url);
  const img = new Image();
  img.src = url;
  await img.decode();
  wmCache.set(url, img);
  return img;
}
async function preloadWatermarks() {
  try {
    const urls = [...WM1_FILES, ...WM2_FILES].map(f => `watermarks/${f}`);
    await Promise.all(urls.map(loadImage));
    el.wmInfo.textContent = `WM loaded: ${WM1_FILES.length} + ${WM2_FILES.length}`;
  } catch (e) {
    el.wmInfo.textContent = "WM load error (check hosting / paths)";
  }
}

// ---------- Overlay drawing & interactions ----------
function resizeCanvasesToFit(displayW, displayH) {
  // We set canvas internal size to page pixel size, and CSS stretches to container.
  el.pageCanvas.width = displayW;
  el.pageCanvas.height = displayH;
  el.overlayCanvas.width = displayW;
  el.overlayCanvas.height = displayH;
}

function drawOverlay() {
  const page = state.pages.get(state.pageIndex);
  if (!page) return;

  const dpi = +el.dpi.value;
  const wPx = mmToPx(+el.areaW.value, dpi);
  const hPx = mmToPx(+el.areaH.value, dpi);

  const W = page.baseW;
  const H = page.baseH;

  const maxX = Math.max(0, W - wPx);
  const maxY = Math.max(0, H - hPx);

  const x = Math.round(overlay.xN * maxX);
  const y = Math.round(overlay.yN * maxY);

  ctxOver.clearRect(0, 0, W, H);
  ctxOver.save();
  ctxOver.strokeStyle = "rgba(90,165,255,0.95)";
  ctxOver.lineWidth = 3;
  ctxOver.setLineDash([8, 6]);
  ctxOver.strokeRect(x + 1.5, y + 1.5, wPx - 3, hPx - 3);
  ctxOver.restore();
}

function pointerPos(ev) {
  const rect = el.overlayCanvas.getBoundingClientRect();
  const x = (ev.clientX - rect.left) * (el.overlayCanvas.width / rect.width);
  const y = (ev.clientY - rect.top) * (el.overlayCanvas.height / rect.height);
  return { x, y };
}

function hitTestRect(px, py) {
  const page = state.pages.get(state.pageIndex);
  if (!page) return false;
  const dpi = +el.dpi.value;
  const wPx = mmToPx(+el.areaW.value, dpi);
  const hPx = mmToPx(+el.areaH.value, dpi);
  const W = page.baseW, H = page.baseH;
  const maxX = Math.max(0, W - wPx);
  const maxY = Math.max(0, H - hPx);
  const x = Math.round(overlay.xN * maxX);
  const y = Math.round(overlay.yN * maxY);
  return (px >= x && px <= x + wPx && py >= y && py <= y + hPx);
}

function setRectCenter(px, py) {
  const page = state.pages.get(state.pageIndex);
  if (!page) return;
  const dpi = +el.dpi.value;
  const wPx = mmToPx(+el.areaW.value, dpi);
  const hPx = mmToPx(+el.areaH.value, dpi);
  const W = page.baseW, H = page.baseH;
  const maxX = Math.max(0, W - wPx);
  const maxY = Math.max(0, H - hPx);
  const x = clamp(px - wPx / 2, 0, maxX);
  const y = clamp(py - hPx / 2, 0, maxY);
  overlay.xN = maxX > 0 ? x / maxX : 0;
  overlay.yN = maxY > 0 ? y / maxY : 0;
}

el.overlayCanvas.addEventListener("pointerdown", (ev) => {
  if (!state.kind) return;
  const { x, y } = pointerPos(ev);
  const page = state.pages.get(state.pageIndex);
  if (!page) return;

  if (hitTestRect(x, y)) {
    overlay.dragging = true;
    // store offset inside rect
    const dpi = +el.dpi.value;
    const wPx = mmToPx(+el.areaW.value, dpi);
    const hPx = mmToPx(+el.areaH.value, dpi);
    const maxX = Math.max(0, page.baseW - wPx);
    const maxY = Math.max(0, page.baseH - hPx);
    const rx = Math.round(overlay.xN * maxX);
    const ry = Math.round(overlay.yN * maxY);
    overlay.dragOffX = x - rx;
    overlay.dragOffY = y - ry;
  } else {
    setRectCenter(x, y);
  }
  drawOverlay();
  ev.preventDefault();
});

el.overlayCanvas.addEventListener("pointermove", (ev) => {
  if (!overlay.dragging) return;
  const page = state.pages.get(state.pageIndex);
  if (!page) return;

  const { x, y } = pointerPos(ev);
  const dpi = +el.dpi.value;
  const wPx = mmToPx(+el.areaW.value, dpi);
  const hPx = mmToPx(+el.areaH.value, dpi);
  const maxX = Math.max(0, page.baseW - wPx);
  const maxY = Math.max(0, page.baseH - hPx);

  const nx = clamp(x - overlay.dragOffX, 0, maxX);
  const ny = clamp(y - overlay.dragOffY, 0, maxY);
  overlay.xN = maxX > 0 ? nx / maxX : 0;
  overlay.yN = maxY > 0 ? ny / maxY : 0;

  drawOverlay();
  ev.preventDefault();
});

window.addEventListener("pointerup", () => {
  overlay.dragging = false;
});

// ---------- Rendering base pages ----------
async function renderPdfPageBase(index) {
  ensurePdfJsWorker();
  const dpi = +el.dpi.value;
  const page = await state.pdfDoc.getPage(index + 1);

  const viewport1 = page.getViewport({ scale: 1 });
  const scale = dpi / 72;
  const viewport = page.getViewport({ scale });

  const baseCanvas = document.createElement("canvas");
  baseCanvas.width = Math.floor(viewport.width);
  baseCanvas.height = Math.floor(viewport.height);
  const ctx = baseCanvas.getContext("2d", { willReadFrequently: true });

  await page.render({ canvasContext: ctx, viewport }).promise;

  return {
    baseCanvas,
    baseW: baseCanvas.width,
    baseH: baseCanvas.height,
    pagePtW: viewport1.width,
    pagePtH: viewport1.height,
    placements: [],
  };
}

async function renderImageBase(file) {
  const dpi = +el.dpi.value;
  // For image we keep its native pixels, but we still use DPI only for area mm->px
  const bmp = await createImageBitmap(file);
  const baseCanvas = document.createElement("canvas");
  baseCanvas.width = bmp.width;
  baseCanvas.height = bmp.height;
  const ctx = baseCanvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  state.imageBitmap = bmp;

  // For export PDF from image: treat points as px * 72/dpi (approx)
  const ptW = bmp.width * (72 / dpi);
  const ptH = bmp.height * (72 / dpi);

  return {
    baseCanvas,
    baseW: bmp.width,
    baseH: bmp.height,
    pagePtW: ptW,
    pagePtH: ptH,
    placements: [],
  };
}

function drawBaseToMain(pageObj) {
  resizeCanvasesToFit(pageObj.baseW, pageObj.baseH);
  ctxPage.clearRect(0, 0, pageObj.baseW, pageObj.baseH);
  ctxPage.drawImage(pageObj.baseCanvas, 0, 0);
}

// ---------- Apply placements (render processed) ----------
async function buildStampCanvas(w, h, placement) {
  const stamp = document.createElement("canvas");
  stamp.width = w;
  stamp.height = h;
  const ctx = stamp.getContext("2d", { willReadFrequently: true });

  // transparent base
  ctx.clearRect(0, 0, w, h);

  if (!placement.params.useWm1) return stamp;

  const wm1Url = `watermarks/${placement.wm1Name}`;
  const wm1 = await loadImage(wm1Url);

  // Draw WM1 with contain/cover, scale, rotation
  const fit = placement.params.wm1Fit;
  const scaleMult = placement.params.wm1Scale / 100;
  const rot = placement.wm1RotDeg;

  drawImageFit(ctx, wm1, w, h, fit, scaleMult, rot);

  // WM2
  if (placement.params.useWm2 && placement.wm2Name) {
    const wm2Url = `watermarks/${placement.wm2Name}`;
    const wm2 = await loadImage(wm2Url);

    const w2 = Math.max(1, Math.round(w * (placement.params.wm2Scale / 100)));
    const h2 = Math.max(1, Math.round(h * (placement.params.wm2Scale / 100)));

    const sub = document.createElement("canvas");
    sub.width = w2;
    sub.height = h2;
    const sctx = sub.getContext("2d", { willReadFrequently: true });
    sctx.clearRect(0, 0, w2, h2);
    drawImageFit(sctx, wm2, w2, h2, "contain", 1.0, placement.wm2RotDeg);

    // dx/dy derived from normalized values (works for >100% too)
    let dx = 0, dy = 0;
    if (w2 <= w) dx = Math.round(placement.wm2DxN * (w - w2));
    else dx = -Math.round(placement.wm2DxN * (w2 - w));

    if (h2 <= h) dy = Math.round(placement.wm2DyN * (h - h2));
    else dy = -Math.round(placement.wm2DyN * (h2 - h));

    ctx.drawImage(sub, dx, dy);
  }

  return stamp;
}

function drawImageFit(ctx, img, W, H, fit, scaleMult, rotDeg) {
  // fit: contain | cover
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const sx = W / iw;
  const sy = H / ih;
  const baseScale = (fit === "cover") ? Math.max(sx, sy) : Math.min(sx, sy);
  const scale = baseScale * scaleMult;

  const dw = iw * scale;
  const dh = ih * scale;

  const cx = W / 2;
  const cy = H / 2;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((rotDeg * Math.PI) / 180);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

async function applyPlacementToCanvas(mainCtx, placement, pageW, pageH) {
  const dpi = +el.dpi.value;
  const wPx = mmToPx(+el.areaW.value, dpi);
  const hPx = mmToPx(+el.areaH.value, dpi);

  const maxX = Math.max(0, pageW - wPx);
  const maxY = Math.max(0, pageH - hPx);
  const x = Math.round(clamp(placement.xN, 0, 1) * maxX);
  const y = Math.round(clamp(placement.yN, 0, 1) * maxY);

  const w = Math.min(wPx, pageW - x);
  const h = Math.min(hPx, pageH - y);

  const base = mainCtx.getImageData(x, y, w, h);

  const stampCanvas = await buildStampCanvas(w, h, placement);
  const stampCtx = stampCanvas.getContext("2d", { willReadFrequently: true });
  const stamp = stampCtx.getImageData(0, 0, w, h);

  const opacity = clamp(placement.params.opacity, 0, 1);
  const burn = (placement.params.mode === "burn");

  const bd = base.data;
  const sd = stamp.data;

  for (let i = 0; i < bd.length; i += 4) {
    const sa = (sd[i + 3] / 255) * opacity;
    if (sa <= 0) continue;

    const br = bd[i], bg = bd[i + 1], bb = bd[i + 2];
    const sr = sd[i], sg = sd[i + 1], sb = sd[i + 2];

    let tr = sr, tg = sg, tb = sb;

    if (burn) {
      tr = Math.max(0, br + sr - 255);
      tg = Math.max(0, bg + sg - 255);
      tb = Math.max(0, bb + sb - 255);
    }

    bd[i]     = Math.round(br * (1 - sa) + tr * sa);
    bd[i + 1] = Math.round(bg * (1 - sa) + tg * sa);
    bd[i + 2] = Math.round(bb * (1 - sa) + tb * sa);
    bd[i + 3] = 255;
  }

  mainCtx.putImageData(base, x, y);
}

async function renderProcessedCurrent() {
  const pageObj = state.pages.get(state.pageIndex);
  if (!pageObj) return;

  drawBaseToMain(pageObj);

  // Apply placements in order
  const placements = pageObj.placements;
  for (const pl of placements) {
    await applyPlacementToCanvas(ctxPage, pl, pageObj.baseW, pageObj.baseH);
  }

  drawOverlay();
  setUiEnabled(true);
}

// ---------- User actions ----------
async function openFile(file) {
  state.pages.clear();
  state.pageIndex = 0;
  state.kind = null;
  state.pdfDoc = null;
  state.pdfPageCount = 0;
  state.imageBitmap = null;

  if (!file) return;

  setStatus("Загрузка…");

  await preloadWatermarks();

  const isPdf = file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";

  if (isPdf) {
    if (!window.pdfjsLib) {
      setStatus("PDF.js не загрузился. Открой один раз с интернетом или проверь хостинг.");
      return;
    }
    ensurePdfJsWorker();
    const buf = await file.arrayBuffer();
    state.kind = "pdf";
    state.pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
    state.pdfPageCount = state.pdfDoc.numPages;

    el.pageLabel.textContent = `PDF: 1/${state.pdfPageCount}`;
    el.btnPrev.disabled = true;
    el.btnNext.disabled = state.pdfPageCount <= 1;

    const page0 = await renderPdfPageBase(0);
    state.pages.set(0, page0);
    await renderProcessedCurrent();

    setStatus("Готово. Двигай прямоугольник и жми OK.");
    setUiEnabled(true);
  } else {
    state.kind = "image";
    state.pdfDoc = null;
    state.pdfPageCount = 1;

    el.pageLabel.textContent = "Image";
    el.btnPrev.disabled = true;
    el.btnNext.disabled = true;

    const page0 = await renderImageBase(file);
    state.pages.set(0, page0);
    await renderProcessedCurrent();

    setStatus("Готово. Двигай прямоугольник и жми OK.");
    setUiEnabled(true);
  }
}

async function ensurePageLoaded(index) {
  if (state.pages.has(index)) return state.pages.get(index);

  if (state.kind === "pdf") {
    const p = await renderPdfPageBase(index);
    state.pages.set(index, p);
    return p;
  }
  return state.pages.get(0);
}

el.fileInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  await openFile(file);
});

el.btnPrev.addEventListener("click", async () => {
  if (state.kind !== "pdf") return;
  state.pageIndex = Math.max(0, state.pageIndex - 1);
  await ensurePageLoaded(state.pageIndex);
  el.pageLabel.textContent = `PDF: ${state.pageIndex + 1}/${state.pdfPageCount}`;
  await renderProcessedCurrent();
});

el.btnNext.addEventListener("click", async () => {
  if (state.kind !== "pdf") return;
  state.pageIndex = Math.min(state.pdfPageCount - 1, state.pageIndex + 1);
  await ensurePageLoaded(state.pageIndex);
  el.pageLabel.textContent = `PDF: ${state.pageIndex + 1}/${state.pdfPageCount}`;
  await renderProcessedCurrent();
});

function getParams() {
  return {
    opacity: clamp(+el.opacity.value, 0.05, 1),
    mode: el.mode.value,
    useWm1: el.useWm1.checked,
    wm1Fit: el.wm1Fit.value,
    wm1Scale: clamp(+el.wm1Scale.value, 5, 300),
    useWm2: el.useWm2.checked,
    wm2Scale: clamp(+el.wm2Scale.value, 5, 300),
  };
}

el.btnApply.addEventListener("click", async () => {
  if (!state.kind) return;
  const pageObj = await ensurePageLoaded(state.pageIndex);
  const params = getParams();

  const placement = {
    xN: overlay.xN,
    yN: overlay.yN,
    params: params,
    wm1Name: params.useWm1 ? randChoice(WM1_FILES) : null,
    wm2Name: (params.useWm1 && params.useWm2) ? randChoice(WM2_FILES) : null,
    wm1RotDeg: params.useWm1 ? randUniform(-WM1_ROT, WM1_ROT) : 0,
    wm2RotDeg: (params.useWm1 && params.useWm2) ? randUniform(-WM2_ROT, WM2_ROT) : 0,
    // normalized offsets inside area for WM2 (0..1)
    wm2DxN: Math.random(),
    wm2DyN: Math.random(),
  };

  pageObj.placements.push(placement);

  setStatus(`Нанесено: ${placement.wm1Name || "TEXT"}${placement.wm2Name ? " + " + placement.wm2Name : ""}`);
  saveSettings();
  await renderProcessedCurrent();
});

async function undo() {
  if (!state.kind) return;
  const pageObj = state.pages.get(state.pageIndex);
  if (!pageObj || pageObj.placements.length === 0) return;
  pageObj.placements.pop();
  setStatus("Undo: отменено последнее нанесение");
  await renderProcessedCurrent();
}

el.btnUndo.addEventListener("click", undo);

window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    undo();
  }
});

// When settings change: redraw overlay, maybe rerender pages if DPI changes
let lastDpi = null;
async function onSettingsChanged() {
  saveSettings();

  const dpi = +el.dpi.value;
  // If DPI changed, we must re-render PDF pages at new scale (positions stay normalized)
  if (state.kind === "pdf") {
    if (lastDpi !== null && dpi !== lastDpi) {
      setStatus("DPI changed: rerendering pages…");
      // Re-render all loaded pages but keep placements
      const oldPages = Array.from(state.pages.entries());
      state.pages.clear();
      for (const [idx, old] of oldPages) {
        const fresh = await renderPdfPageBase(idx);
        fresh.placements = old.placements;
        state.pages.set(idx, fresh);
      }
      await renderProcessedCurrent();
      setStatus("Готово (DPI обновлён).");
    } else {
      drawOverlay();
    }
  } else if (state.kind === "image") {
    // For image, DPI doesn't change base pixels; only overlay size
    drawOverlay();
  } else {
    // no doc
  }
  lastDpi = dpi;
}

for (const id of ["areaW","areaH","dpi","opacity","mode","useWm1","wm1Fit","wm1Scale","useWm2","wm2Scale"]) {
  el[id].addEventListener("change", onSettingsChanged);
  el[id].addEventListener("input", () => {
    saveSettings();
    drawOverlay();
  });
}

// ---------- Export ----------
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function exportPNGs() {
  if (!state.kind) return;
  setStatus("Экспорт PNG…");

  const pages = [];
  const count = (state.kind === "pdf") ? state.pdfPageCount : 1;

  for (let i = 0; i < count; i++) {
    const pageObj = await ensurePageLoaded(i);
    // render processed into temp canvas
    const tmp = document.createElement("canvas");
    tmp.width = pageObj.baseW;
    tmp.height = pageObj.baseH;
    const tctx = tmp.getContext("2d", { willReadFrequently: true });
    tctx.drawImage(pageObj.baseCanvas, 0, 0);
    for (const pl of pageObj.placements) {
      await applyPlacementToCanvas(tctx, pl, pageObj.baseW, pageObj.baseH);
    }
    const blob = await new Promise(r => tmp.toBlob(r, "image/png"));
    pages.push({ i, blob });
  }

  if (pages.length === 1) {
    downloadBlob(pages[0].blob, "marked.png");
  } else {
    // If many pages: download sequentially
    for (const p of pages) downloadBlob(p.blob, `marked_${String(p.i+1).padStart(3,"0")}.png`);
  }
  setStatus("PNG экспорт завершён.");
}

async function exportPDF() {
  if (!state.kind) return;
  if (!window.PDFLib) {
    setStatus("pdf-lib не загрузился. Открой один раз с интернетом или проверь хостинг.");
    return;
  }

  setStatus("Экспорт PDF (растр)…");

  const { PDFDocument } = PDFLib;
  const pdf = await PDFDocument.create();

  const count = (state.kind === "pdf") ? state.pdfPageCount : 1;

  for (let i = 0; i < count; i++) {
    const pageObj = await ensurePageLoaded(i);

    // render processed into temp canvas
    const tmp = document.createElement("canvas");
    tmp.width = pageObj.baseW;
    tmp.height = pageObj.baseH;
    const tctx = tmp.getContext("2d", { willReadFrequently: true });
    tctx.drawImage(pageObj.baseCanvas, 0, 0);
    for (const pl of pageObj.placements) {
      await applyPlacementToCanvas(tctx, pl, pageObj.baseW, pageObj.baseH);
    }

    const dataUrl = tmp.toDataURL("image/png");
    const pngBytes = dataURLToUint8(dataUrl);
    const png = await pdf.embedPng(pngBytes);

    const page = pdf.addPage([pageObj.pagePtW, pageObj.pagePtH]);
    page.drawImage(png, { x: 0, y: 0, width: pageObj.pagePtW, height: pageObj.pagePtH });
  }

  const bytes = await pdf.save();
  downloadBlob(new Blob([bytes], { type: "application/pdf" }), "marked.pdf");
  setStatus("PDF экспорт завершён.");
}

function dataURLToUint8(dataUrl) {
  const base64 = dataUrl.split(",")[1];
  const bin = atob(base64);
  const len = bin.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
  return out;
}

el.btnExportPng.addEventListener("click", exportPNGs);
el.btnExportPdf.addEventListener("click", exportPDF);

// ---------- Init ----------
(function init() {
  const s = loadSettings();
  el.areaW.value = s.areaW;
  el.areaH.value = s.areaH;
  el.dpi.value = s.dpi;
  el.opacity.value = s.opacity;
  el.mode.value = s.mode;
  el.useWm1.checked = s.useWm1;
  el.wm1Fit.value = s.wm1Fit;
  el.wm1Scale.value = s.wm1Scale;
  el.useWm2.checked = s.useWm2;
  el.wm2Scale.value = s.wm2Scale;
  lastDpi = s.dpi;

  setUiEnabled(false);
  el.pageLabel.textContent = "—";

  setStatus("Открой PDF или картинку. Совет: добавь на главный экран как PWA, чтобы оффлайн работало.");
  preloadWatermarks();
})();
