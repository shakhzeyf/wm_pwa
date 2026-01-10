(() => {
  // ----------------- DOM -----------------
  const qs = (s) => document.querySelector(s);
  const qsa = (s) => Array.from(document.querySelectorAll(s));

  const el = {
    left: qs(".left"),
    backdrop: qs("#backdrop"),
    btnMenu: qs("#btnMenu"),
    btnOpenTop: qs("#btnOpenTop"),
    btnUndoTop: qs("#btnUndoTop"),
    btnOpenBig: qs("#btnOpenBig"),
    emptyHint: qs("#emptyHint"),
    btnOpenMob: qs("#btnOpenMob"),
    btnSelectMob: qs("#btnSelectMob"),
    btnApplyMob: qs("#btnApplyMob"),
    btnUndoMob: qs("#btnUndoMob"),
    btnPdfMob: qs("#btnPdfMob"),
    btnPngMob: qs("#btnPngMob"),

    status: qs("#status"),
    canvas: qs("#canvas"),
    overlay: qs("#overlay"),

    btnOpen: qs("#btnOpen"),
    fileInput: qs("#fileInput"),

    areaW: qs("#areaW"),
    areaH: qs("#areaH"),
    dpi: qs("#dpi"),

    prevPage: qs("#prevPage"),
    nextPage: qs("#nextPage"),
    pageNo: qs("#pageNo"),
    pageInfo: qs("#pageInfo"),

    wm1Scale: qs("#wm1Scale"),
    wm2Scale: qs("#wm2Scale"),
    enableWM2: qs("#enableWM2"),
    blend: qs("#blend"),
    opacity: qs("#opacity"),

    btnSelect: qs("#btnSelect"),
    btnApply: qs("#btnApply"),
    btnUndo: qs("#btnUndo"),
    btnClear: qs("#btnClear"),
    btnPng: qs("#btnPng"),
    btnPdf: qs("#btnPdf"),
    canvasWrap: qs('.canvasWrap'),
    stage: qs('.stage'),
    viewZoom: qs("#viewZoom"),
    fitView: qs("#fitView"),
  };

  const ctx = el.canvas.getContext("2d", { willReadFrequently: true });

  function setStatus(msg) {
    el.status.textContent = msg;
  }

  // ----------------- Mobile drawer -----------------
  function isMobile() {
    try {
      return window.matchMedia("(max-width: 980px)").matches;
    } catch {
      return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
    }
  }

  function setPanelOpen(open) {
    if (!el.left || !el.backdrop) return;
    if (!isMobile()) {
      el.backdrop.style.display = "none";
      el.left.classList.remove("open");
      return;
    }
    if (open) {
      el.left.classList.add("open");
      el.backdrop.style.display = "block";
    } else {
      el.left.classList.remove("open");
      el.backdrop.style.display = "none";
    }
  }

  el.btnMenu?.addEventListener("click", () => {
    const open = el.left?.classList.contains("open");
    setPanelOpen(!open);
  });
  el.backdrop?.addEventListener("click", () => setPanelOpen(false));

  // Close panel when interacting with canvas (mobile)
  el.canvas.addEventListener("pointerdown", () => setPanelOpen(false));

  // ----------------- Settings persistence -----------------
  const SETTINGS_KEY = "wmstamp_settings_v3";

  function saveSettings() {
    try {
      const s = {
        areaW: el.areaW.value,
        areaH: el.areaH.value,
        dpi: el.dpi.value,
        viewZoom: el.viewZoom ? el.viewZoom.value : 100,
        wm1Scale: el.wm1Scale.value,
        wm2Scale: el.wm2Scale.value,
        enableWM2: el.enableWM2.checked,
        blend: el.blend.value,
        opacity: el.opacity.value,
        wm1: qsa(".wm1").filter((x) => x.checked).map((x) => x.value),
        wm2: qsa(".wm2").filter((x) => x.checked).map((x) => x.value),
      };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {}
  }

  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
      if (!s) return;
      if (s.areaW != null) el.areaW.value = s.areaW;
      if (s.areaH != null) el.areaH.value = s.areaH;
      if (s.dpi != null) el.dpi.value = s.dpi;
      if (s.wm1Scale != null) el.wm1Scale.value = s.wm1Scale;
      if (s.wm2Scale != null) el.wm2Scale.value = s.wm2Scale;
      if (s.enableWM2 != null) el.enableWM2.checked = !!s.enableWM2;
      if (s.blend != null) el.blend.value = s.blend;
      if (s.opacity != null) el.opacity.value = s.opacity;
      if (s.viewZoom != null && el.viewZoom) el.viewZoom.value = s.viewZoom;

      if (Array.isArray(s.wm1)) {
        qsa(".wm1").forEach((cb) => (cb.checked = s.wm1.includes(cb.value)));
      }
      if (Array.isArray(s.wm2)) {
        qsa(".wm2").forEach((cb) => (cb.checked = s.wm2.includes(cb.value)));
      }
    } catch {}
  }

  // Enforce "up to 3" selections
  function enforceMax3(cls) {
    const boxes = qsa(cls);
    boxes.forEach((cb) =>
      cb.addEventListener("change", () => {
        const checked = boxes.filter((x) => x.checked);
        if (checked.length > 3) {
          cb.checked = false;
          setStatus("Можно выбрать до 3.");
        }
        saveSettings();
      })
    );
  }
  enforceMax3(".wm1");
  enforceMax3(".wm2");

  // ----------------- Watermarks -----------------
  const WM1_ROT = 30; // degrees
  const WM2_ROT = 5;

  const wmCache = new Map(); // filename -> Image
  function loadWm(name) {
    if (!name) return null;
    if (wmCache.has(name)) return wmCache.get(name);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = `watermarks/${name}`;
    wmCache.set(name, img);
    return img;
  }

  // ----------------- PDF dependencies -----------------
  let pdfjsLib = window.pdfjsLib;
  let PDFLib = window.PDFLib;
  function refreshDeps() {
    pdfjsLib = window.pdfjsLib;
    PDFLib = window.PDFLib;
  }

  async function ensureDepsLoaded() {
    // deps are loaded by index.html in background; we just wait for that promise if needed
    if (window.__wm_deps_ready__) {
      refreshDeps();
      return true;
    }
    const p = window.__wm_deps_promise__;
    if (p && typeof p.then === "function") {
      try { await p; } catch (e) { /* ignore */ }
      refreshDeps();
    } else {
      refreshDeps();
    }
    return !!(pdfjsLib && PDFLib);
  }


  async function ensurePdfWorker() {
    if (!pdfjsLib) throw new Error("pdfjsLib не найден");
    const urls = window.__wm_worker_urls__ || [];
    for (const u of urls) {
      try {
        pdfjsLib.GlobalWorkerOptions.workerSrc = u;
        // probe
        await fetch(u, { method: "GET", mode: "cors" });
        return u;
      } catch (_e) {}
    }
    // fallback: still set first (may work even if fetch is blocked)
    if (urls[0]) pdfjsLib.GlobalWorkerOptions.workerSrc = urls[0];
    return urls[0] || "";
  }

  // ----------------- Math / scaling -----------------
  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function mmToPx(mm, dpi) {
    return Math.round((mm / 25.4) * dpi);
  }

  function deviceMemoryGB() {
    const m = navigator.deviceMemory;
    return typeof m === "number" && isFinite(m) ? m : 4;
  }

  function maxPixels(kind) {
    const mobile = isMobile();
    const mem = deviceMemoryGB();
    if (mobile) {
      if (kind === "preview") return mem >= 8 ? 5_000_000 : 3_500_000;
      return mem >= 8 ? 6_500_000 : 5_000_000;
    }
    if (kind === "preview") return 24_000_000;
    return 40_000_000;
  }

  function computeSafeDpiForPdf(ptW, ptH, desiredDpi, maxPix) {
    const w = (ptW * desiredDpi) / 72;
    const h = (ptH * desiredDpi) / 72;
    const area = w * h;
    if (!isFinite(area) || area <= 0) return Math.round(desiredDpi);
    if (area <= maxPix) return Math.round(desiredDpi);
    const factor = Math.sqrt(maxPix / area);
    return Math.max(72, Math.floor(desiredDpi * factor));
  }

  function computeSafeSizeForImage(w, h, maxPix) {
    const area = w * h;
    if (!isFinite(area) || area <= 0) return { w, h, scale: 1 };
    if (area <= maxPix) return { w, h, scale: 1 };
    const s = Math.sqrt(maxPix / area);
    return {
      w: Math.max(1, Math.floor(w * s)),
      h: Math.max(1, Math.floor(h * s)),
      scale: s,
    };
  }

  // ----------------- Blend modes -----------------
  function applyNormal(baseCtx, wmCanvas, dstX, dstY, opacity01) {
    baseCtx.save();
    baseCtx.globalAlpha = opacity01;
    baseCtx.drawImage(wmCanvas, dstX, dstY);
    baseCtx.restore();
  }

  // Linear burn blend (like Photoshop)
  function applyLinearBurn(baseCtx, wmCanvas, dstX, dstY, opacity01) {
    const bw = wmCanvas.width,
      bh = wmCanvas.height;
    if (bw === 0 || bh === 0) return;

    // clamp rect to base
    const W = baseCtx.canvas.width,
      H = baseCtx.canvas.height;
    const sx = Math.max(0, -dstX);
    const sy = Math.max(0, -dstY);
    const ex = Math.min(bw, W - dstX);
    const ey = Math.min(bh, H - dstY);
    const rw = ex - sx;
    const rh = ey - sy;
    if (rw <= 0 || rh <= 0) return;

    const baseData = baseCtx.getImageData(dstX + sx, dstY + sy, rw, rh);
    const wmCtx = wmCanvas.getContext("2d", { willReadFrequently: true });
    const wmData = wmCtx.getImageData(sx, sy, rw, rh);

    const bd = baseData.data;
    const wd = wmData.data;

    // Linear Burn: result = base + blend - 255
    for (let i = 0; i < bd.length; i += 4) {
      const wa = (wd[i + 3] / 255) * opacity01;
      if (wa <= 0) continue;

      const br = bd[i],
        bg = bd[i + 1],
        bb = bd[i + 2];
      const wr = wd[i],
        wg = wd[i + 1],
        wb = wd[i + 2];

      const rr = clamp(br + wr - 255, 0, 255);
      const rg = clamp(bg + wg - 255, 0, 255);
      const rb = clamp(bb + wb - 255, 0, 255);

      bd[i] = br + (rr - br) * wa;
      bd[i + 1] = bg + (rg - bg) * wa;
      bd[i + 2] = bb + (rb - bb) * wa;
      // alpha stays as base
    }
    baseCtx.putImageData(baseData, dstX + sx, dstY + sy);
  }

  function renderWmTransformed(img, targetW, targetH, rotationDeg) {
    const can = document.createElement("canvas");
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) return can;

    // scale to fit within target box
    const s = Math.min(targetW / iw, targetH / ih);
    const rw = Math.max(1, Math.round(iw * s));
    const rh = Math.max(1, Math.round(ih * s));

    // canvas big enough after rotation
    const ang = (rotationDeg * Math.PI) / 180;
    const cos = Math.abs(Math.cos(ang)),
      sin = Math.abs(Math.sin(ang));
    const cw = Math.ceil(rw * cos + rh * sin);
    const ch = Math.ceil(rw * sin + rh * cos);
    can.width = cw;
    can.height = ch;

    const c = can.getContext("2d");
    c.clearRect(0, 0, cw, ch);
    c.translate(cw / 2, ch / 2);
    c.rotate(ang);
    c.drawImage(img, -rw / 2, -rh / 2, rw, rh);
    return can;
  }

  // ----------------- State -----------------
  let docType = null; // "pdf" | "image"
  let pdfDoc = null;
  let pdfBytes = null;
  let imageFile = null;
  let imageBitmap = null;
  let imagePreviewScale = 1;

  let totalPages = 1;
  let currentPage = 1;

  // current page geometry
  let currentPagePt = { w: 0, h: 0 }; // points for PDF, not for images
  let currentRenderDpi = 0; // actual preview render DPI for PDFs, or "desired" for images

  const pageOps = new Map(); // pageNo -> [op, ...]
  function getOpsForPage(p) {
    if (!pageOps.has(p)) pageOps.set(p, []);
    return pageOps.get(p);
  }

  let selecting = false;
  let areaRect = { x: 50, y: 50, w: 200, h: 120 }; // in canvas px

  // ----------------- Overlay -----------------
  function clampArea() {
    const W = el.canvas.width || 1;
    const H = el.canvas.height || 1;
    areaRect.w = clamp(areaRect.w, 1, W);
    areaRect.h = clamp(areaRect.h, 1, H);
    areaRect.x = clamp(areaRect.x, 0, W - areaRect.w);
    areaRect.y = clamp(areaRect.y, 0, H - areaRect.h);
  }

  function updateAreaFromInputs({ save = true } = {}) {
    const mmW = Math.max(1, parseFloat(el.areaW.value || "1"));
    const mmH = Math.max(1, parseFloat(el.areaH.value || "1"));
    const dpiDesired = Math.max(72, parseFloat(el.dpi.value || "300"));
    const dpi = currentRenderDpi || dpiDesired;
    areaRect.w = mmToPx(mmW, dpi);
    areaRect.h = mmToPx(mmH, dpi);
    clampArea();
    renderOverlay();
    if (save) saveSettings();
  }

  function renderOverlay() {
    if (!selecting || !docType) {
      el.overlay.style.display = "none";
      return;
    }
    const rect = el.canvas.getBoundingClientRect();
    const sx = rect.width / (el.canvas.width || 1);
    const sy = rect.height / (el.canvas.height || 1);
    el.overlay.style.display = "block";
    el.overlay.style.left = Math.round(areaRect.x * sx) + "px";
    el.overlay.style.top = Math.round(areaRect.y * sy) + "px";
    el.overlay.style.width = Math.round(areaRect.w * sx) + "px";
    el.overlay.style.height = Math.round(areaRect.h * sy) + "px";
  }

  function applyViewZoom(pct, save = true) {
    if (!el.canvas || !el.viewZoom) return;
    const p = clamp(Math.round(Number(pct) || 100), 10, 300);
    el.viewZoom.value = String(p);
    const z = p / 100;

    // Only visual scaling (CSS size). Real pixels remain for stamping/export.
    el.canvas.style.width = Math.max(1, Math.round(el.canvas.width * z)) + "px";
    el.canvas.style.height = Math.max(1, Math.round(el.canvas.height * z)) + "px";

    if (save) saveSettings();
    renderOverlay();
  }

  function computeFitZoom() {
    if (!el.canvasWrap || !el.canvas) return 100;
    const pad = 16;
    const availW = Math.max(120, el.canvasWrap.clientWidth - pad * 2);
    const availH = Math.max(120, el.canvasWrap.clientHeight - pad * 2);
    const s = Math.min(availW / el.canvas.width, availH / el.canvas.height);
    return clamp(Math.floor(s * 100), 10, 300);
  }

  function fitPreview(save = true) {
    applyViewZoom(computeFitZoom(), save);
  }


  // Re-render overlay on resize (because CSS scale changes)
  window.addEventListener("resize", () => {
    renderOverlay();
    if (!isMobile()) setPanelOpen(false);
  });

  // ----------------- Canvas interaction -----------------
  function canvasPointFromEvent(ev) {
    const rect = el.canvas.getBoundingClientRect();
    const t = ev.touches ? ev.touches[0] : null;
    const clientX = t ? t.clientX : ev.clientX;
    const clientY = t ? t.clientY : ev.clientY;
    const x = (clientX - rect.left) * (el.canvas.width / rect.width);
    const y = (clientY - rect.top) * (el.canvas.height / rect.height);
    return { x, y };
  }

  function onCanvasTap(ev) {
    if (!selecting) return;
    ev.preventDefault();
    const p = canvasPointFromEvent(ev);
    areaRect.x = Math.round(p.x - areaRect.w / 2);
    areaRect.y = Math.round(p.y - areaRect.h / 2);
    clampArea();
    renderOverlay();
    setStatus("Место выбрано. Нажми OK.");
  }

  el.canvas.addEventListener("click", onCanvasTap);
  el.canvas.addEventListener("touchstart", onCanvasTap, { passive: false });

  // ----------------- Rendering -----------------
  function setPageInfo() {
    if (docType === "pdf" && pdfDoc) {
      const desired = Math.max(72, parseFloat(el.dpi.value || "300"));
      const actual = currentRenderDpi || desired;
      const mark = actual < desired ? "↓" : "";
      el.pageInfo.textContent = `из ${totalPages} • preview ${Math.round(actual)}dpi${mark}`;
      el.pageNo.value = String(currentPage);
    } else if (docType === "image") {
      el.pageInfo.textContent = "";
      el.pageNo.value = "1";
    } else {
      el.pageInfo.textContent = "";
      el.pageNo.value = "1";
    }
  }

  async function renderBase() {
    if (!docType) return;
    setStatus("Рендер…");

    const desiredDpi = Math.max(72, parseFloat(el.dpi.value || "300"));
    currentRenderDpi = desiredDpi;

    if (docType === "image" && imageBitmap) {
      const safe = computeSafeSizeForImage(imageBitmap.width, imageBitmap.height, maxPixels("preview"));
      imagePreviewScale = safe.w / imageBitmap.width;

      el.canvas.width = safe.w;
      el.canvas.height = safe.h;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);
      ctx.drawImage(imageBitmap, 0, 0, safe.w, safe.h);

      // For images, we interpret mm->px using desired DPI (user-controlled)
      currentRenderDpi = desiredDpi;
      currentPagePt = { w: 0, h: 0 };
    }

    if (docType === "pdf" && pdfDoc) {
      if (!pdfjsLib) throw new Error("PDF.js не загружен");
      await ensurePdfWorker();

      const page = await pdfDoc.getPage(currentPage);
      const vp1 = page.getViewport({ scale: 1 });
      currentPagePt = { w: vp1.width, h: vp1.height };

      const safeDpi = computeSafeDpiForPdf(vp1.width, vp1.height, desiredDpi, maxPixels("preview"));
      currentRenderDpi = safeDpi;

      const viewport = page.getViewport({ scale: safeDpi / 72 });
      el.canvas.width = Math.ceil(viewport.width);
      el.canvas.height = Math.ceil(viewport.height);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);

      await page.render({ canvasContext: ctx, viewport }).promise;
    }

    // Update overlay size from mm using currentRenderDpi
    updateAreaFromInputs({ save: false });

    // Apply ops for current page
    await applyOpsToCanvas(ctx, currentRenderDpi);

    setPageInfo();
    updateButtons();
    // Apply zoom after base render
    try {
      const z = Number(el.viewZoom?.value || 0);
      const isMobile = window.matchMedia && window.matchMedia("(max-width: 900px)").matches;
      if (!z || (isMobile && z === 100 && el.canvasWrap && el.canvas && el.canvas.width > el.canvasWrap.clientWidth + 50)) {
        fitPreview(false);
      } else {
        applyViewZoom(z, false);
      }
    } catch {}
    setStatus("Готово");
  }

  async function applyOpsToCanvas(targetCtx, dpiForCanvas) {
    const ops = getOpsForPage(currentPage);
    if (!ops.length) return;
    for (const op of ops) {
      await applyOpToCtx(op, targetCtx, dpiForCanvas, targetCtx.canvas.width, targetCtx.canvas.height);
    }
  }

  async function applyOpToCtx(op, targetCtx, dpiForCanvas, canvasW, canvasH) {
    const opacity01 = clamp((op.opacity || 100) / 100, 0.01, 1);

    const areaWpx = mmToPx(op.areaWmm, dpiForCanvas);
    const areaHpx = mmToPx(op.areaHmm, dpiForCanvas);

    const ax = clamp(Math.round(op.xN * canvasW), 0, Math.max(0, canvasW - areaWpx));
    const ay = clamp(Math.round(op.yN * canvasH), 0, Math.max(0, canvasH - areaHpx));

    const wm1 = loadWm(op.wm1);
    if (!wm1) return;
    await wm1.decode?.().catch(() => {});
    const wm1BoxW = Math.max(1, Math.round(areaWpx * op.wm1Scale));
    const wm1BoxH = Math.max(1, Math.round(areaHpx * op.wm1Scale));
    const x1 = Math.round(ax + (areaWpx - wm1BoxW) / 2);
    const y1 = Math.round(ay + (areaHpx - wm1BoxH) / 2);
    const wm1Can = renderWmTransformed(wm1, wm1BoxW, wm1BoxH, op.wm1Rot);

    if (op.blend === "linear_burn") applyLinearBurn(targetCtx, wm1Can, x1, y1, opacity01);
    else applyNormal(targetCtx, wm1Can, x1, y1, opacity01);

    if (op.wm2) {
      const wm2 = loadWm(op.wm2);
      await wm2.decode?.().catch(() => {});
      const wm2BoxW = Math.max(1, Math.round(areaWpx * op.wm2Scale));
      const wm2BoxH = Math.max(1, Math.round(areaHpx * op.wm2Scale));

      const maxX = Math.max(0, wm1BoxW - wm2BoxW);
      const maxY = Math.max(0, wm1BoxH - wm2BoxH);
      const offX = Math.floor(op.wm2RandX * (maxX + 1));
      const offY = Math.floor(op.wm2RandY * (maxY + 1));

      const x2 = x1 + offX;
      const y2 = y1 + offY;
      const wm2Can = renderWmTransformed(wm2, wm2BoxW, wm2BoxH, op.wm2Rot);

      if (op.blend === "linear_burn") applyLinearBurn(targetCtx, wm2Can, x2, y2, opacity01);
      else applyNormal(targetCtx, wm2Can, x2, y2, opacity01);
    }
  }

  // ----------------- Ops creation -----------------
  function getChosenList(cls) {
    return qsa(cls).filter((cb) => cb.checked).map((cb) => cb.value);
  }

  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function createOpFromSelection() {
    const wm1List = getChosenList(".wm1");
    const wm2List = getChosenList(".wm2");

    if (!wm1List.length) {
      setStatus("Выбери хотя бы 1 WM1.");
      return null;
    }

    // Store in physical units + normalized coords so preview/export DPI can differ safely
    const areaWmm = Math.max(1, parseFloat(el.areaW.value || "1"));
    const areaHmm = Math.max(1, parseFloat(el.areaH.value || "1"));

    const wm1 = pickRandom(wm1List);
    const enableWm2 = el.enableWM2.checked && wm2List.length > 0;
    const wm2 = enableWm2 ? pickRandom(wm2List) : null;

    const wm1Scale = Math.max(1, parseFloat(el.wm1Scale.value || "100")) / 100;
    const wm2Scale = Math.max(1, parseFloat(el.wm2Scale.value || "100")) / 100;

    const wm1Rot = (Math.random() * 2 - 1) * WM1_ROT;
    const wm2Rot = (Math.random() * 2 - 1) * WM2_ROT;

    // xN/yN from current placement
    const W = el.canvas.width || 1;
    const H = el.canvas.height || 1;
    const xN = clamp(areaRect.x / W, 0, 1);
    const yN = clamp(areaRect.y / H, 0, 1);

    // random offset ratios for wm2 within wm1 box
    const wm2RandX = Math.random();
    const wm2RandY = Math.random();

    return {
      xN,
      yN,
      areaWmm,
      areaHmm,
      wm1,
      wm2,
      wm1Scale,
      wm2Scale,
      wm1Rot,
      wm2Rot,
      wm2RandX,
      wm2RandY,
      blend: el.blend.value,
      opacity: parseFloat(el.opacity.value || "100"),
      createdAt: Date.now(),
    };
  }

  // ----------------- UI actions -----------------
  function updateButtons() {
    const hasDoc = (docType === "pdf" && pdfDoc) || (docType === "image" && imageBitmap);
    el.btnApply.disabled = !hasDoc;
    el.btnSelect.disabled = !hasDoc;
    el.btnPng.disabled = !hasDoc;
    el.btnPdf.disabled = !(docType === "pdf" && pdfDoc);

    const ops = getOpsForPage(currentPage);
    el.btnUndo.disabled = !hasDoc || !ops.length;
    el.btnClear.disabled = !hasDoc || !ops.length;

    el.prevPage.disabled = !(docType === "pdf" && pdfDoc && currentPage > 1);
    el.nextPage.disabled = !(docType === "pdf" && pdfDoc && currentPage < totalPages);
    el.pageNo.disabled = !(docType === "pdf" && pdfDoc);

    // Mirror disabled states to mobile controls (if present)
    if (el.btnApplyMob) el.btnApplyMob.disabled = el.btnApply.disabled;
    if (el.btnSelectMob) el.btnSelectMob.disabled = el.btnSelect.disabled;
    if (el.btnUndoMob) el.btnUndoMob.disabled = el.btnUndo.disabled;
    if (el.btnPdfMob) el.btnPdfMob.disabled = el.btnPdf.disabled;
    if (el.btnPngMob) el.btnPngMob.disabled = el.btnPng.disabled;
    if (el.btnUndoTop) el.btnUndoTop.disabled = el.btnUndo.disabled;

    // Empty-state hint
    if (el.emptyHint) el.emptyHint.style.display = hasDoc ? "none" : "flex";
  }

  async function goPage(p) {
    if (docType !== "pdf" || !pdfDoc) return;
    currentPage = clamp(p, 1, totalPages);
    selecting = false;
    el.btnSelect.textContent = "Выбрать место";
    renderOverlay();
    await renderBase();
  }

  el.prevPage.addEventListener("click", () => goPage(currentPage - 1));
  el.nextPage.addEventListener("click", () => goPage(currentPage + 1));
  el.pageNo.addEventListener("change", () => goPage(parseInt(el.pageNo.value || "1", 10)));

  // Select
  el.btnSelect.addEventListener("click", () => {
    selecting = !selecting;
    el.btnSelect.textContent = selecting ? "Выбор активен" : "Выбрать место";
    renderOverlay();
    if (selecting) setPanelOpen(false);
    setStatus(selecting ? "Тапни по листу, чтобы поставить область." : "Выбор выключен.");
  });

  // Apply
  el.btnApply.addEventListener("click", async () => {
    if (!docType) return;
    saveSettings();
    const op = createOpFromSelection();
    if (!op) return;
    getOpsForPage(currentPage).push(op);
    setStatus("Наношу…");
    await renderBase();
    setStatus("Нанесено (рандом).");
  });

  // Undo
  el.btnUndo.addEventListener("click", async () => {
    const ops = getOpsForPage(currentPage);
    if (!ops.length) return;
    ops.pop();
    setStatus("Отмена…");
    await renderBase();
    setStatus("Отменено.");
  });

  // Clear page ops
  el.btnClear.addEventListener("click", async () => {
    pageOps.set(currentPage, []);
    setStatus("Очищаю…");
    await renderBase();
    setStatus("Очищено.");
  });

  // Area changes
  [el.areaW, el.areaH].forEach((x) =>
    x.addEventListener("change", () => updateAreaFromInputs({ save: true }))
  );
  el.dpi.addEventListener("change", async () => {
    saveSettings();
    if (docType) await renderBase();
  });

  // Save on other controls
  [el.wm1Scale, el.wm2Scale, el.enableWM2, el.blend, el.opacity].forEach((x) =>
    x.addEventListener("change", saveSettings)
  );

  // ----------------- File open -----------------
  const isLabelEl = (node) => node && node.tagName === "LABEL";
  function openPicker(fromEl) {
    // If it's a <label for="fileInput">, let the default behavior run.
    if (isLabelEl(fromEl)) return;
    // Some browsers require direct user gesture; keep it synchronous.
    if (el.fileInput) el.fileInput.click();
  }
  if (el.btnOpen) el.btnOpen.addEventListener('click', (e) => openPicker(e.currentTarget));
  if (el.btnOpenTop) el.btnOpenTop.addEventListener('click', (e) => openPicker(e.currentTarget));
  if (el.btnOpenBig) el.btnOpenBig.addEventListener('click', (e) => openPicker(e.currentTarget));
  if (el.btnOpenMob) el.btnOpenMob.addEventListener('click', (e) => openPicker(e.currentTarget));

function mirrorClick(srcBtn) { return () => { try{ srcBtn && srcBtn.click(); }catch{} }; }
  if (el.btnSelectMob) el.btnSelectMob.addEventListener("click", mirrorClick(el.btnSelect));
  if (el.btnApplyMob) el.btnApplyMob.addEventListener("click", mirrorClick(el.btnApply));
  if (el.btnUndoMob) el.btnUndoMob.addEventListener("click", mirrorClick(el.btnUndo));
  if (el.btnPdfMob) el.btnPdfMob.addEventListener("click", mirrorClick(el.btnPdf));
  if (el.btnPngMob) el.btnPngMob.addEventListener("click", mirrorClick(el.btnPng));
  if (el.btnUndoTop) el.btnUndoTop.addEventListener("click", mirrorClick(el.btnUndo));


  el.fileInput.addEventListener("change", async () => {
    const file = el.fileInput.files?.[0];
    if (!file) return;

    setStatus("Открываю…");
    try {
      // reset
      docType = null;
      pdfDoc = null;
      pdfBytes = null;
      imageFile = null;
      imageBitmap = null;
      imagePreviewScale = 1;
      pageOps.clear();
      totalPages = 1;
      currentPage = 1;
      currentPagePt = { w: 0, h: 0 };
      currentRenderDpi = Math.max(72, parseFloat(el.dpi.value || "300"));

      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        docType = "pdf";
        pdfBytes = await file.arrayBuffer();
        await ensurePdfWorker();
        pdfDoc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
        totalPages = pdfDoc.numPages;
        currentPage = 1;
        setPageInfo();
        await renderBase();
        setPanelOpen(false);
      } else if (file.type.startsWith("image/")) {
        docType = "image";
        imageFile = file;
        // decode
        imageBitmap = await createImageBitmap(file);
        totalPages = 1;
        currentPage = 1;
        setPageInfo();
        await renderBase();
        setPanelOpen(false);
      } else {
        setStatus("Неподдерживаемый формат.");
      }
    } catch (e) {
      console.error(e);
      setStatus("Ошибка открытия файла: " + (e && e.message ? e.message : e));
    } finally {
      updateButtons();
      el.fileInput.value = "";
    }
  });

  // ----------------- Export PNG -----------------
  el.btnPng.addEventListener("click", async () => {
    if (!docType) return;
    try {
      setStatus("Экспорт PNG…");
      const blob = await new Promise((resolve) => el.canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Не удалось создать PNG");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.download = docType === "pdf" ? `wm_page_${currentPage}.png` : "wm_image.png";
      a.href = url;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setStatus("PNG готов.");
    } catch (e) {
      console.error(e);
      setStatus("Ошибка экспорта PNG: " + (e && e.message ? e.message : e));
    }
  });

  // ----------------- Export PDF (raster) -----------------
  el.btnPdf.addEventListener("click", async () => {
    if (docType !== "pdf" || !pdfDoc) return;
    if (!PDFLib) {
      setStatus("pdf-lib не загружен.");
      return;
    }

    setStatus("Экспорт PDF…");
    try {
      const desiredDpi = Math.max(72, parseFloat(el.dpi.value || "300"));
      await ensurePdfWorker();
      const out = await PDFLib.PDFDocument.create();

      const maxPix = maxPixels("export");

      for (let p = 1; p <= totalPages; p++) {
        const page = await pdfDoc.getPage(p);
        const vp1 = page.getViewport({ scale: 1 });

        const safeDpi = computeSafeDpiForPdf(vp1.width, vp1.height, desiredDpi, maxPix);
        const viewport = page.getViewport({ scale: safeDpi / 72 });

        setStatus(`Экспорт PDF: ${p}/${totalPages} (DPI ${safeDpi}${safeDpi < desiredDpi ? "↓" : ""})`);

        const can = document.createElement("canvas");
        can.width = Math.ceil(viewport.width);
        can.height = Math.ceil(viewport.height);
        const c = can.getContext("2d", { willReadFrequently: true });

        await page.render({ canvasContext: c, viewport }).promise;

        // Apply ops (scaled by DPI safely)
        const ops = pageOps.get(p) || [];
        for (const op of ops) {
          await applyOpToCtx(op, c, safeDpi, can.width, can.height);
        }

        // Embed as PNG without base64 (memory-friendly)
        const blob = await new Promise((resolve) => can.toBlob(resolve, "image/png"));
        if (!blob) throw new Error("Не удалось сформировать изображение страницы");
        const buf = await blob.arrayBuffer();
        const img = await out.embedPng(buf);

        const outPage = out.addPage([vp1.width, vp1.height]);
        outPage.drawImage(img, { x: 0, y: 0, width: vp1.width, height: vp1.height });

        // free
        can.width = 0;
        can.height = 0;

        // yield to UI
        await new Promise((r) => setTimeout(r, 0));
      }

      const bytes = await out.save();
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "wm_export.pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setStatus("PDF готов.");
    } catch (e) {
      console.error(e);
      setStatus("Ошибка экспорта PDF: " + (e && e.message ? e.message : e));
    }
  });

  // ----------------- Init -----------------
  loadSettings();

  // Preview zoom controls
  if (el.viewZoom) el.viewZoom.addEventListener('change', () => applyViewZoom(el.viewZoom.value));
  if (el.fitView) el.fitView.addEventListener('click', () => fitPreview(true));
  window.addEventListener('resize', () => { try { applyViewZoom(Number(el.viewZoom?.value || 100), false); } catch {} });

  updateAreaFromInputs({ save: false });
  setPageInfo();
  renderOverlay();
  updateButtons();
  setStatus("Открой файл.");
})();