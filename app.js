(() => {
  // Helpers
  const qs = (s) => document.querySelector(s);
  const qsa = (s) => Array.from(document.querySelectorAll(s));
  const el = {
    status: qs("#status"),
    stage: qs(".stage"),
    btnMenu: qs("#btnMenu"),
    btnMenuClose: qs("#btnMenuClose"),
    backdrop: qs("#backdrop"),
    btnOpen: qs("#btnOpen"),
    fileInput: qs("#fileInput"),
    canvas: qs("#canvas"),
    overlay: qs("#overlay"),
    btnSelect: qs("#btnSelect"),
    btnApply: qs("#btnApply"),
    btnUndo: qs("#btnUndo"),
    btnClear: qs("#btnClear"),
    btnPng: qs("#btnPng"),
    btnPdf: qs("#btnPdf"),
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
    previewScale: qs("#previewScale"),
  };
  const ctx = el.canvas.getContext("2d", { willReadFrequently: true });

  function setStatus(s) { el.status.textContent = s; }

  // Settings persistence
  const SETTINGS_KEY = "wmstamp_settings_v2";
  function loadSettings(){
    try{
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY)||"null");
      if (!s) return;
      for (const [k,v] of Object.entries(s)){
        const node = qs("#"+k);
        if (!node) continue;
        if (node.type === "checkbox") node.checked = !!v;
        else node.value = v;
      }
      if (s.wm1List) {
        qsa(".wm1").forEach(cb => cb.checked = s.wm1List.includes(cb.value));
      }
      if (s.wm2List) {
        qsa(".wm2").forEach(cb => cb.checked = s.wm2List.includes(cb.value));
      }
    }catch{}
  }
  function saveSettings(){
    const s = {
      areaW: el.areaW.value,
      areaH: el.areaH.value,
      dpi: el.dpi.value,
      previewScale: el.previewScale ? el.previewScale.value : "100",
      wm1Scale: el.wm1Scale.value,
      wm2Scale: el.wm2Scale.value,
      enableWM2: el.enableWM2.checked,
      blend: el.blend.value,
      opacity: el.opacity.value,
      wm1List: getChosenList(".wm1"),
      wm2List: getChosenList(".wm2"),
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  }

  // Mobile settings drawer
  function closeMenu(){
    document.querySelector('.left')?.classList.remove('open');
    el.backdrop?.classList.remove('show');
  }
  function openMenu(){
    document.querySelector('.left')?.classList.add('open');
    el.backdrop?.classList.add('show');
  }
  el.btnMenu?.addEventListener('click', () => {
    const left = document.querySelector('.left');
    if (left?.classList.contains('open')) closeMenu();
    else openMenu();
  });
  el.btnMenuClose?.addEventListener('click', closeMenu);
  el.backdrop?.addEventListener('click', closeMenu);

  // Enforce "up to 3" on WM selections
  function enforceMax3(cls){
    const boxes = qsa(cls);
    boxes.forEach(cb => cb.addEventListener("change", () => {
      const checked = boxes.filter(x => x.checked);
      if (checked.length > 3){
        cb.checked = false;
        setStatus("Можно выбрать до 3.");
      }
      saveSettings();
    }));
  }

  enforceMax3(".wm1");
  enforceMax3(".wm2");

  // App State
  let docType = null; // 'pdf' | 'image'
  let pdfDoc = null;
  let imageBitmap = null;
  let totalPages = 1;
  let currentPage = 1;

  // For each page: ops array
  const pageOps = new Map(); // pageNo -> [op,...]
  const wmCache = new Map(); // filename -> Image

  let selecting = false;
  let areaRect = { x: 50, y: 50, w: 200, h: 120 }; // in canvas px
  let lastClick = null;

  // Random rotation ranges
  const WM1_ROT = 30; // degrees
  const WM2_ROT = 5;

  // Load watermark image
  function loadWm(name){
    if (wmCache.has(name)) return wmCache.get(name);
    const img = new Image();
    img.src = `watermarks/${name}`;
    wmCache.set(name, img);
    return img;
  }

  // Dependencies
  const pdfjsLib = window.pdfjsLib;
  const PDFLib = window.PDFLib;

  async function ensurePdfWorker(){
    // Try primary
    const urls = window.__wm_worker_urls__ || [];
    for (const u of urls){
      try{
        pdfjsLib.GlobalWorkerOptions.workerSrc = u;
        // quick probe: fetch worker (if blocked, may throw)
        await fetch(u, { method: "GET", mode: "cors" });
        return u;
      }catch(_e){
        // ignore
      }
    }
    // last resort set first
    if (urls[0]) pdfjsLib.GlobalWorkerOptions.workerSrc = urls[0];
    return urls[0] || "";
  }

  // UI helpers
  function mmToPx(mm, dpi){
    return Math.round((mm / 25.4) * dpi);
  }

  // Preview scale (visual only)
  function applyPreviewScale(){
    if (!el.previewScale || !el.stage) return;
    const pct = Math.max(1, Math.min(200, parseFloat(el.previewScale.value || "100")));
    const z = pct / 100;
    // Chrome/Android supports zoom; this affects only on-screen preview, not actual PDF size.
    el.stage.style.zoom = String(z);
  }
  if (el.previewScale) el.previewScale.addEventListener("change", () => { applyPreviewScale(); saveSettings(); });

  function updateAreaFromInputs(){
    const mmW = Math.max(1, parseFloat(el.areaW.value || "1"));
    const mmH = Math.max(1, parseFloat(el.areaH.value || "1"));
    const dpi = Math.max(72, parseFloat(el.dpi.value || "300"));
    areaRect.w = mmToPx(mmW, dpi);
    areaRect.h = mmToPx(mmH, dpi);
    clampArea();
    renderOverlay();
    saveSettings();
  }

  function clampArea(){
    const W = el.canvas.width;
    const H = el.canvas.height;
    areaRect.x = Math.max(0, Math.min(areaRect.x, W - areaRect.w));
    areaRect.y = Math.max(0, Math.min(areaRect.y, H - areaRect.h));
  }

  function renderOverlay(){
    el.overlay.style.display = selecting ? "block" : "none";
    el.overlay.style.left = areaRect.x + "px";
    el.overlay.style.top = areaRect.y + "px";
    el.overlay.style.width = areaRect.w + "px";
    el.overlay.style.height = areaRect.h + "px";
  }

  function getChosenList(cls){
    return qsa(cls).filter(cb => cb.checked).map(cb => cb.value);
  }

  function pickRandom(arr){
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // Linear burn blend
  function applyLinearBurn(baseCtx, wmCanvas, dstX, dstY, opacity01){
    const bw = wmCanvas.width, bh = wmCanvas.height;
    if (bw === 0 || bh === 0) return;

    // clamp rect to base
    const W = baseCtx.canvas.width, H = baseCtx.canvas.height;
    const sx = Math.max(0, -dstX);
    const sy = Math.max(0, -dstY);
    const ex = Math.min(bw, W - dstX);
    const ey = Math.min(bh, H - dstY);
    if (ex <= sx || ey <= sy) return;

    const baseImg = baseCtx.getImageData(dstX + sx, dstY + sy, ex - sx, ey - sy);
    const wmCtx = wmCanvas.getContext("2d", { willReadFrequently: true });
    const wmImg = wmCtx.getImageData(sx, sy, ex - sx, ey - sy);

    const b = baseImg.data;
    const w = wmImg.data;
    const n = b.length;

    for (let i = 0; i < n; i += 4){
      const wa = (w[i+3] / 255) * opacity01;
      if (wa <= 0) continue;

      const br = b[i], bg = b[i+1], bb = b[i+2];
      const wr = w[i], wg = w[i+1], wb = w[i+2];

      // linear burn: result = base + blend - 255
      const rr = Math.max(0, br + wr - 255);
      const rg = Math.max(0, bg + wg - 255);
      const rb = Math.max(0, bb + wb - 255);

      // alpha composite with wa
      b[i]   = Math.round(br * (1 - wa) + rr * wa);
      b[i+1] = Math.round(bg * (1 - wa) + rg * wa);
      b[i+2] = Math.round(bb * (1 - wa) + rb * wa);
      // keep opaque
      b[i+3] = 255;
    }
    baseCtx.putImageData(baseImg, dstX + sx, dstY + sy);
  }

  function applyNormal(baseCtx, wmCanvas, dstX, dstY, opacity01){
    baseCtx.save();
    baseCtx.globalAlpha = opacity01;
    baseCtx.drawImage(wmCanvas, dstX, dstY);
    baseCtx.restore();
  }

  // Render watermark into offscreen canvas with rotation/scale
  function renderWmTransformed(img, targetW, targetH, rotationDeg){
    const can = document.createElement("canvas");
    // We'll fit image into target box preserving aspect
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) return can;

    // scale to fit within targetW/H
    const s = Math.min(targetW / iw, targetH / ih);
    const rw = Math.max(1, Math.round(iw * s));
    const rh = Math.max(1, Math.round(ih * s));

    // Need canvas big enough after rotation
    const ang = rotationDeg * Math.PI / 180;
    const cos = Math.abs(Math.cos(ang)), sin = Math.abs(Math.sin(ang));
    const cw = Math.ceil(rw * cos + rh * sin);
    const ch = Math.ceil(rw * sin + rh * cos);
    can.width = cw;
    can.height = ch;

    const c = can.getContext("2d");
    c.clearRect(0,0,cw,ch);
    c.translate(cw/2, ch/2);
    c.rotate(ang);
    c.drawImage(img, -rw/2, -rh/2, rw, rh);
    return can;
  }

  // Render base (pdf page or image) to canvas at DPI
  async function renderBase(){
    setStatus("Рендер…");
    const dpi = Math.max(72, parseFloat(el.dpi.value || "300"));
    if (docType === "image" && imageBitmap){
      // Fit image into canvas preserving size (1:1)
      el.canvas.width = imageBitmap.width;
      el.canvas.height = imageBitmap.height;
      ctx.clearRect(0,0,el.canvas.width, el.canvas.height);
      ctx.drawImage(imageBitmap, 0, 0);
    } else if (docType === "pdf" && pdfDoc){
      await ensurePdfWorker();
      const page = await pdfDoc.getPage(currentPage);
      const viewport = page.getViewport({ scale: dpi / 72 });
      el.canvas.width = Math.ceil(viewport.width);
      el.canvas.height = Math.ceil(viewport.height);
      ctx.clearRect(0,0,el.canvas.width, el.canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
    } else {
      // Empty
      el.canvas.width = 800;
      el.canvas.height = 1000;
      ctx.fillStyle="#fff";
      ctx.fillRect(0,0,el.canvas.width, el.canvas.height);
    }

    // Restore area default/clamp
    updateAreaFromInputs();
    // Apply ops for this page
    await applyOpsToCanvas();
    setStatus("Готово");
    updateButtons();
  }

  function getOpsForPage(p){
    if (!pageOps.has(p)) pageOps.set(p, []);
    return pageOps.get(p);
  }

  async function applyOpsToCanvas(){
    const ops = getOpsForPage(currentPage);
    if (!ops.length) return;
    for (const op of ops){
      await applyOp(op);
    }
  }

  async function applyOp(op){
    const opacity01 = Math.max(0.01, Math.min(1, (op.opacity || 100) / 100));
    const wm1 = loadWm(op.wm1);
    await wm1.decode?.().catch(()=>{});
    // Render WM1 canvas
    const wm1Can = renderWmTransformed(wm1, op.wm1BoxW, op.wm1BoxH, op.wm1Rot);
    // Position: center inside area, we store top-left
    const dstX = op.x;
    const dstY = op.y;

    if (op.blend === "linear_burn") applyLinearBurn(ctx, wm1Can, dstX, dstY, opacity01);
    else applyNormal(ctx, wm1Can, dstX, dstY, opacity01);

    if (op.wm2){
      const wm2 = loadWm(op.wm2);
      await wm2.decode?.().catch(()=>{});
      const wm2Can = renderWmTransformed(wm2, op.wm2BoxW, op.wm2BoxH, op.wm2Rot);
      const w2x = dstX + op.wm2OffX;
      const w2y = dstY + op.wm2OffY;

      if (op.blend === "linear_burn") applyLinearBurn(ctx, wm2Can, w2x, w2y, opacity01);
      else applyNormal(ctx, wm2Can, w2x, w2y, opacity01);
    }
  }

  function createOpFromSelection(){
    const wm1List = getChosenList(".wm1");
    const wm2List = getChosenList(".wm2");
    if (!wm1List.length){
      setStatus("Выбери хотя бы 1 WM1.");
      return null;
    }
    const enableWm2 = el.enableWM2.checked && wm2List.length > 0;
    const wm1 = pickRandom(wm1List);
    const wm2 = enableWm2 ? pickRandom(wm2List) : null;

    const wm1Scale = Math.max(1, parseFloat(el.wm1Scale.value || "100")) / 100;
    const wm2Scale = Math.max(1, parseFloat(el.wm2Scale.value || "100")) / 100;

    // WM boxes: areaRect as base box; scale affects how much of area they occupy
    const wm1BoxW = Math.max(1, Math.round(areaRect.w * wm1Scale));
    const wm1BoxH = Math.max(1, Math.round(areaRect.h * wm1Scale));
    const wm2BoxW = Math.max(1, Math.round(areaRect.w * wm2Scale));
    const wm2BoxH = Math.max(1, Math.round(areaRect.h * wm2Scale));

    // Random rotations
    const wm1Rot = (Math.random() * 2 - 1) * WM1_ROT;
    const wm2Rot = (Math.random() * 2 - 1) * WM2_ROT;

    // Place WM1 inside area: we'll center it in area
    const x = Math.round(areaRect.x + (areaRect.w - wm1BoxW) / 2);
    const y = Math.round(areaRect.y + (areaRect.h - wm1BoxH) / 2);

    // WM2 random offset within WM1 bounds (top-left) so it stays within WM1 box
    let wm2OffX = 0, wm2OffY = 0;
    if (wm2){
      const maxX = Math.max(0, wm1BoxW - wm2BoxW);
      const maxY = Math.max(0, wm1BoxH - wm2BoxH);
      wm2OffX = Math.floor(Math.random() * (maxX + 1));
      wm2OffY = Math.floor(Math.random() * (maxY + 1));
    }

    return {
      x, y,
      wm1, wm2,
      wm1BoxW, wm1BoxH,
      wm2BoxW, wm2BoxH,
      wm1Rot, wm2Rot,
      wm2OffX, wm2OffY,
      blend: el.blend.value,
      opacity: parseFloat(el.opacity.value || "100"),
      meta: { areaW: areaRect.w, areaH: areaRect.h, dpi: parseFloat(el.dpi.value||"300") }
    };
  }

  function updateButtons(){
    const hasDoc = (docType === "pdf" && pdfDoc) || (docType === "image" && imageBitmap);
    el.btnApply.disabled = !hasDoc;
    el.btnSelect.disabled = !hasDoc;
    el.btnPng.disabled = !hasDoc;
    el.btnPdf.disabled = !(hasDoc && docType === "pdf"); // for now PDF export for PDF; PNG export always
    const ops = getOpsForPage(currentPage);
    el.btnUndo.disabled = ops.length === 0;
    el.btnClear.disabled = ops.length === 0;
    el.prevPage.disabled = !(hasDoc && docType === "pdf" && currentPage > 1);
    el.nextPage.disabled = !(hasDoc && docType === "pdf" && currentPage < totalPages);
  }

  function setPageInfo(){
    if (docType === "pdf" && pdfDoc){
      el.pageInfo.textContent = `из ${totalPages}`;
      el.pageNo.value = String(currentPage);
    } else {
      el.pageInfo.textContent = "";
      el.pageNo.value = "1";
    }
  }

  // Selection interaction (click to place)
  function canvasPointFromEvent(ev){
    const rect = el.canvas.getBoundingClientRect();
    const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
    const clientY = ev.touches ? ev.touches[0].clientY : ev.clientY;
    const x = (clientX - rect.left) * (el.canvas.width / rect.width);
    const y = (clientY - rect.top) * (el.canvas.height / rect.height);
    return { x, y };
  }

  function onCanvasTap(ev){
    if (!selecting) return;
    ev.preventDefault();
    const p = canvasPointFromEvent(ev);
    // place rect centered on tap
    areaRect.x = Math.round(p.x - areaRect.w/2);
    areaRect.y = Math.round(p.y - areaRect.h/2);
    clampArea();
    renderOverlay();
    lastClick = { x: areaRect.x, y: areaRect.y };
    setStatus("Место выбрано. Нажми OK.");
  }

  // Open file
  el.btnOpen.addEventListener("click", () => el.fileInput.click());
  el.fileInput.addEventListener("change", async () => {
    const file = el.fileInput.files && el.fileInput.files[0];
    if (!file) return;
    setStatus("Открываю…");
    try{
      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")){
        docType = "pdf";
        const buf = await file.arrayBuffer();
        await ensurePdfWorker();
        pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
        totalPages = pdfDoc.numPages;
        currentPage = 1;
        setPageInfo();
        await renderBase();
      } else if (file.type.startsWith("image/")){
        docType = "image";
        pdfDoc = null;
        totalPages = 1;
        currentPage = 1;
        const bmp = await createImageBitmap(file);
        imageBitmap = bmp;
        setPageInfo();
        await renderBase();
      } else {
        setStatus("Неподдерживаемый формат.");
      }
    }catch(e){
      console.error(e);
      setStatus("Ошибка открытия файла: " + (e && e.message ? e.message : e));
    }finally{
      updateButtons();
      el.fileInput.value = "";
    }
  });

  // Area changes
  [el.areaW, el.areaH, el.dpi].forEach(inp => inp.addEventListener("input", updateAreaFromInputs));

  // Pages
  async function goPage(p){
    if (!pdfDoc) return;
    currentPage = Math.max(1, Math.min(totalPages, p));
    setPageInfo();
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
    setStatus(selecting ? "Тапни по листу, чтобы поставить область." : "Выбор выключен.");
  });

  // Apply
  el.btnApply.addEventListener("click", async () => {
    if (!docType) return;
    saveSettings();
    const op = createOpFromSelection();
    if (!op) return;
    const ops = getOpsForPage(currentPage);
    ops.push(op);
    setStatus("Наношу…");
    // re-render base then ops (keeps quality consistent)
    await renderBase();
    setStatus("Нанесено (рандом).");
    updateButtons();
  });

  // Undo
  async function undo(){
    const ops = getOpsForPage(currentPage);
    if (!ops.length) return;
    ops.pop();
    setStatus("Отмена…");
    await renderBase();
    setStatus("Отменено.");
    updateButtons();
  }
  el.btnUndo.addEventListener("click", undo);

  // Ctrl+Z
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z"){
      e.preventDefault();
      undo();
    }
  });

  // Clear page
  el.btnClear.addEventListener("click", async () => {
    pageOps.set(currentPage, []);
    setStatus("Сброс…");
    await renderBase();
    setStatus("Сброшено.");
    updateButtons();
  });

  // Export PNG (current canvas)
  el.btnPng.addEventListener("click", () => {
    const a = document.createElement("a");
    a.download = `wm_page_${currentPage}.png`;
    a.href = el.canvas.toDataURL("image/png");
    a.click();
  });

  // Export PDF (raster): all pages, re-render and apply ops deterministically
  el.btnPdf.addEventListener("click", async () => {
    if (docType !== "pdf" || !pdfDoc) return;
    setStatus("Экспорт PDF…");
    try{
      const dpi = Math.max(72, parseFloat(el.dpi.value || "300"));
      // Create new PDF
      const out = await PDFLib.PDFDocument.create();

      for (let p = 1; p <= totalPages; p++){
        // Render page to offscreen canvas
        await ensurePdfWorker();
        const page = await pdfDoc.getPage(p);
        const viewport = page.getViewport({ scale: dpi / 72 });
        const can = document.createElement("canvas");
        can.width = Math.ceil(viewport.width);
        can.height = Math.ceil(viewport.height);
        const c = can.getContext("2d", { willReadFrequently: true });
        await page.render({ canvasContext: c, viewport }).promise;

        // Apply ops for that page
        const ops = pageOps.get(p) || [];
        // Apply each op
        for (const op of ops){
          // We apply using the same functions but on offscreen context
          // (reusing blend logic)
          const opacity01 = Math.max(0.01, Math.min(1, (op.opacity || 100) / 100));
          const wm1 = loadWm(op.wm1);
          await wm1.decode?.().catch(()=>{});
          const wm1Can = renderWmTransformed(wm1, op.wm1BoxW, op.wm1BoxH, op.wm1Rot);
          if (op.blend === "linear_burn") applyLinearBurn(c, wm1Can, op.x, op.y, opacity01);
          else applyNormal(c, wm1Can, op.x, op.y, opacity01);

          if (op.wm2){
            const wm2 = loadWm(op.wm2);
            await wm2.decode?.().catch(()=>{});
            const wm2Can = renderWmTransformed(wm2, op.wm2BoxW, op.wm2BoxH, op.wm2Rot);
            const w2x = op.x + op.wm2OffX;
            const w2y = op.y + op.wm2OffY;
            if (op.blend === "linear_burn") applyLinearBurn(c, wm2Can, w2x, w2y, opacity01);
            else applyNormal(c, wm2Can, w2x, w2y, opacity01);
          }
        }

        // Embed as PNG
        const pngUrl = can.toDataURL("image/png");
        const pngBytes = await fetch(pngUrl).then(r => r.arrayBuffer());
        const img = await out.embedPng(pngBytes);

        // Page size in points: 72 dpi base. We rendered at dpi, so points = px * 72/dpi
        const wPt = can.width * (72 / dpi);
        const hPt = can.height * (72 / dpi);
        const outPage = out.addPage([wPt, hPt]);
        outPage.drawImage(img, { x: 0, y: 0, width: wPt, height: hPt });
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
    }catch(e){
      console.error(e);
      setStatus("Ошибка экспорта PDF: " + (e && e.message ? e.message : e));
    }
  });

  // Canvas interaction
  el.canvas.addEventListener("click", onCanvasTap);
  el.canvas.addEventListener("touchstart", onCanvasTap, { passive: false });

  // init
  loadSettings();
  applyPreviewScale();
  updateAreaFromInputs();
  setPageInfo();
  renderOverlay();
  updateButtons();
  setStatus("Открой файл.");

})();
