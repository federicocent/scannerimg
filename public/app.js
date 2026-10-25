(() => {
  // State: ordered array of scanned page items
  let pages = [];
  let draggedIndex = null;

  // Crop modal state
  let activeCropId = null;
  let activeCropMode = 'manual';
  let cropCorners = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  let cropSuggestedCorners = null;
  let draggingHandleIdx = null;
  let draggingEdgeIdx = null;
  let edgeDragStart = null;

  // DOM Elements
  const dropzone = document.getElementById('dropzone');
  const fileInputMain = document.getElementById('fileInputMain');
  const fileInputHeader = document.getElementById('fileInputHeader');
  const workspaceSection = document.getElementById('workspaceSection');
  const pagesGrid = document.getElementById('pagesGrid');
  const pagesCountText = document.getElementById('pagesCountText');
  const badgeCountTop = document.getElementById('badgeCountTop');

  const btnDownloadTop = document.getElementById('btnDownloadTop');
  const btnDownloadMain = document.getElementById('btnDownloadMain');
  const btnApplyAll = document.getElementById('btnApplyAll');
  const btnClearAll = document.getElementById('btnClearAll');

  const globalMode = document.getElementById('globalMode');
  const globalIntensity = document.getElementById('globalIntensity');
  const intensityValueLabel = document.getElementById('intensityValueLabel');
  const autoCropCheck = document.getElementById('autoCropCheck');

  const pdfFilename = document.getElementById('pdfFilename');
  const pdfPageSize = document.getElementById('pdfPageSize');
  const pdfOrientation = document.getElementById('pdfOrientation');
  const pdfMargin = document.getElementById('pdfMargin');

  const statusBanner = document.getElementById('statusBanner');
  const statusSpinner = document.getElementById('statusSpinner');
  const statusText = document.getElementById('statusText');
  const statusClose = document.getElementById('statusClose');

  // Crop Modal Elements
  const cropModal = document.getElementById('cropModal');
  const cropBaseImage = document.getElementById('cropBaseImage');
  const cropPolygon = document.getElementById('cropPolygon');
  const cropHandles = Array.from(document.querySelectorAll('.crop-handle'));
  const cropEdgeHandles = Array.from(document.querySelectorAll('.crop-edge-handle'));
  const cropLoupe = document.getElementById('cropLoupe');
  const cropLoupeCanvas = document.getElementById('cropLoupeCanvas');
  const btnCloseCropModal = document.getElementById('btnCloseCropModal');
  const btnCancelCrop = document.getElementById('btnCancelCrop');
  const btnAutoDetectCorners = document.getElementById('btnAutoDetectCorners');
  const btnFullFrameCorners = document.getElementById('btnFullFrameCorners');
  const btnApplyCrop = document.getElementById('btnApplyCrop');

  // Preview Lightbox Modal
  const previewModal = document.getElementById('previewModal');
  const previewModalImg = document.getElementById('previewModalImg');
  const btnClosePreviewModal = document.getElementById('btnClosePreviewModal');

  function showStatus(message, type = 'info', loading = false) {
    statusBanner.className =
      'rounded-xl px-4 py-3 text-sm font-medium flex items-center justify-between shadow-xs ';
    if (type === 'error') {
      statusBanner.classList.add('bg-rose-50', 'text-rose-800', 'border', 'border-rose-200');
    } else if (type === 'success') {
      statusBanner.classList.add('bg-emerald-50', 'text-emerald-800', 'border', 'border-emerald-200');
    } else {
      statusBanner.classList.add('bg-blue-50', 'text-blue-800', 'border', 'border-blue-200');
    }

    statusText.textContent = message;
    if (loading) {
      statusSpinner.classList.remove('hidden');
    } else {
      statusSpinner.classList.add('hidden');
    }
    statusBanner.classList.remove('hidden');
  }

  function hideStatus() {
    statusBanner.classList.add('hidden');
  }

  statusClose.addEventListener('click', hideStatus);

  globalIntensity.addEventListener('input', () => {
    intensityValueLabel.textContent = `${globalIntensity.value}%`;
  });

  // Upload Handling
  dropzone.addEventListener('click', (e) => {
    if (e.target !== fileInputMain) {
      fileInputMain.click();
    }
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dropzone-active');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dropzone-active');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dropzone-active');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files);
    }
  });

  fileInputMain.addEventListener('change', () => {
    if (fileInputMain.files.length > 0) {
      uploadFiles(fileInputMain.files);
      fileInputMain.value = '';
    }
  });

  fileInputHeader.addEventListener('change', () => {
    if (fileInputHeader.files.length > 0) {
      uploadFiles(fileInputHeader.files);
      fileInputHeader.value = '';
    }
  });

  async function uploadFiles(fileList) {
    const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
    if (files.length === 0) {
      showStatus('Selecciona archivos de imagen válidos (JPG, PNG, WEBP).', 'error');
      return;
    }

    showStatus(
      `Detectando hoja y escaneando ${files.length} ${
        files.length === 1 ? 'imagen' : 'imágenes'
      }...`,
      'info',
      true
    );

    const formData = new FormData();
    files.forEach((f) => formData.append('images', f));
    formData.append('mode', globalMode.value);
    formData.append('intensity', globalIntensity.value);
    formData.append('autoCrop', autoCropCheck.checked ? 'true' : 'false');

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Error al subir las imágenes.');
      }

      pages.push(...data.items);
      renderWorkspace();
      showStatus(
        `${data.items.length} ${
          data.items.length === 1 ? 'hoja detectada y escaneada' : 'hojas detectadas y escaneadas'
        }. Si quieres ajustar algún borde, pulsa "Modificar recorte".`,
        'success'
      );
    } catch (err) {
      showStatus(err.message, 'error');
    }
  }

  function getCropBadgeHtml(cropMode) {
    if (cropMode === 'auto') {
      return `<span class="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">Recorte auto</span>`;
    }
    if (cropMode === 'manual') {
      return `<span class="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-100 text-amber-800 border border-amber-200">Recorte manual</span>`;
    }
    return `<span class="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">Hoja completa</span>`;
  }

  function renderWorkspace() {
    const count = pages.length;
    pagesCountText.textContent = String(count);

    if (count > 0) {
      workspaceSection.classList.remove('hidden');
      btnDownloadTop.disabled = false;
      badgeCountTop.textContent = String(count);
      badgeCountTop.classList.remove('hidden');
      dropzone.classList.replace('p-8', 'p-5');
    } else {
      workspaceSection.classList.add('hidden');
      btnDownloadTop.disabled = true;
      badgeCountTop.classList.add('hidden');
      dropzone.classList.replace('p-5', 'p-8');
    }

    pagesGrid.innerHTML = '';

    pages.forEach((item, index) => {
      const card = document.createElement('div');
      card.className =
        'bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs flex flex-col transition select-none';
      card.draggable = true;
      card.dataset.index = String(index);

      // Drag and drop reordering events
      card.addEventListener('dragstart', (e) => {
        draggedIndex = index;
        card.classList.add('page-card-dragging');
        e.dataTransfer.effectAllowed = 'move';
      });

      card.addEventListener('dragend', () => {
        draggedIndex = null;
        card.classList.remove('page-card-dragging');
        document
          .querySelectorAll('.page-card-dragover')
          .forEach((el) => el.classList.remove('page-card-dragover'));
      });

      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (draggedIndex !== null && draggedIndex !== index) {
          card.classList.add('page-card-dragover');
        }
      });

      card.addEventListener('dragleave', () => {
        card.classList.remove('page-card-dragover');
      });

      card.addEventListener('drop', (e) => {
        e.preventDefault();
        card.classList.remove('page-card-dragover');
        if (draggedIndex !== null && draggedIndex !== index) {
          const [moved] = pages.splice(draggedIndex, 1);
          pages.splice(index, 0, moved);
          draggedIndex = null;
          renderWorkspace();
        }
      });

      card.innerHTML = `
        <!-- Card Header -->
        <div class="px-3.5 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-600 text-white shrink-0">
              Pág. ${index + 1}
            </span>
            ${getCropBadgeHtml(item.cropMode)}
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button
              type="button"
              data-action="move-left"
              title="Mover página antes"
              ${index === 0 ? 'disabled' : ''}
              class="p-1 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              type="button"
              data-action="move-right"
              title="Mover página después"
              ${index === pages.length - 1 ? 'disabled' : ''}
              class="p-1 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200 disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
            <button
              type="button"
              data-action="delete"
              title="Eliminar página"
              class="p-1 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 cursor-pointer"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <!-- Scanned Image Preview Area -->
        <div class="relative bg-slate-200/70 h-64 flex items-center justify-center p-3 group">
          <img
            src="${item.previewUrl}"
            alt="Página ${index + 1}"
            class="max-h-full max-w-full object-contain bg-white scanned-sheet rounded-xs cursor-zoom-in transition group-hover:scale-[1.01]"
            data-action="zoom"
          />
        </div>

        <!-- Per-Page Controls Footer -->
        <div class="p-3 bg-white border-t border-slate-100 space-y-2">
          <!-- Primary Manual Crop & Rotate Row -->
          <div class="flex items-center gap-1.5">
            <button
              type="button"
              data-action="crop"
              title="Modificar el recorte de la hoja a mano"
              class="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 transition cursor-pointer"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M7 3v12a2 2 0 002 2h12M3 7h12a2 2 0 012 2v12" />
              </svg>
              Modificar recorte
            </button>

            <button
              type="button"
              data-action="rotate"
              title="Girar 90° a la derecha"
              class="inline-flex items-center gap-1 px-2.5 py-2 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9" />
              </svg>
              Girar
            </button>
          </div>

          <!-- Per-page Filter Mode Selector -->
          <div>
            <select
              data-action="mode-select"
              class="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="magic_color" ${item.mode === 'magic_color' ? 'selected' : ''}>Filtro: Color Mágico</option>
              <option value="bw" ${item.mode === 'bw' ? 'selected' : ''}>Filtro: Blanco y Negro</option>
              <option value="grayscale" ${item.mode === 'grayscale' ? 'selected' : ''}>Filtro: Escala de Grises</option>
              <option value="original" ${item.mode === 'original' ? 'selected' : ''}>Filtro: Original</option>
            </select>
          </div>
        </div>
      `;

      // Bind card actions
      card
        .querySelector('[data-action="move-left"]')
        .addEventListener('click', () => movePage(index, -1));
      card
        .querySelector('[data-action="move-right"]')
        .addEventListener('click', () => movePage(index, 1));
      card
        .querySelector('[data-action="delete"]')
        .addEventListener('click', () => deletePage(index));
      card
        .querySelector('[data-action="rotate"]')
        .addEventListener('click', () => rotatePage(index));
      card
        .querySelector('[data-action="crop"]')
        .addEventListener('click', () => openCropModal(index));
      card
        .querySelector('[data-action="zoom"]')
        .addEventListener('click', () => openPreviewModal(item.previewUrl));
      card
        .querySelector('[data-action="mode-select"]')
        .addEventListener('change', (e) => updatePageMode(index, e.target.value));

      pagesGrid.appendChild(card);
    });
  }

  function movePage(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= pages.length) return;
    const temp = pages[index];
    pages[index] = pages[target];
    pages[target] = temp;
    renderWorkspace();
  }

  async function deletePage(index) {
    const item = pages[index];
    pages.splice(index, 1);
    renderWorkspace();
    try {
      await fetch(`/api/images/${item.id}`, { method: 'DELETE' });
    } catch (_e) {
      // Ignore
    }
  }

  async function rotatePage(index) {
    const item = pages[index];
    const nextRotation = (item.rotation + 90) % 360;
    await processSinglePage(index, { rotation: nextRotation });
  }

  async function updatePageMode(index, newMode) {
    await processSinglePage(index, {
      mode: newMode,
      intensity: Number(globalIntensity.value),
    });
  }

  async function processSinglePage(index, payload) {
    const item = pages[index];
    if (!item) return;

    showStatus(`Procesando página ${index + 1}...`, 'info', true);
    try {
      const res = await fetch(`/api/images/${item.id}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al procesar la imagen.');

      pages[index] = data.item;
      renderWorkspace();
      hideStatus();
    } catch (err) {
      showStatus(err.message, 'error');
    }
  }

  // Batch Apply Filter Mode & Intensity to All Pages
  btnApplyAll.addEventListener('click', async () => {
    if (pages.length === 0) return;
    showStatus('Aplicando efecto de escaneo a todas las páginas...', 'info', true);

    try {
      const res = await fetch('/api/images/batch-process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageIds: pages.map((p) => p.id),
          mode: globalMode.value,
          intensity: Number(globalIntensity.value),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al actualizar las páginas.');

      const updatedMap = new Map(data.items.map((i) => [i.id, i]));
      pages = pages.map((p) => updatedMap.get(p.id) || p);
      renderWorkspace();
      showStatus('Filtro aplicado a todas las páginas.', 'success');
    } catch (err) {
      showStatus(err.message, 'error');
    }
  });

  // Clear All Pages
  btnClearAll.addEventListener('click', async () => {
    pages = [];
    renderWorkspace();
    hideStatus();
    try {
      await fetch('/api/images', { method: 'DELETE' });
    } catch (_e) {
      // Ignore
    }
  });

  // Interactive 4-Corner + 4-Edge Perspective Crop Modal
  async function openCropModal(index) {
    const item = pages[index];
    if (!item) return;

    showStatus('Abriendo editor de recorte...', 'info', true);
    try {
      const res = await fetch(`/api/images/${item.id}/crop-data`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo cargar la imagen original.');

      activeCropId = item.id;
      activeCropMode = data.cropMode || 'manual';
      cropSuggestedCorners = data.suggestedCorners;
      cropCorners = (data.currentCorners || []).map((pt) => ({ x: pt.x, y: pt.y }));

      cropBaseImage.onload = () => {
        hideStatus();
        cropModal.classList.remove('hidden');
        requestAnimationFrame(() => updateCropOverlayUI());
      };
      cropBaseImage.src = data.imageDataUrl;
    } catch (err) {
      showStatus(err.message, 'error');
    }
  }

  function closeCropModal() {
    cropModal.classList.add('hidden');
    cropLoupe.classList.add('hidden');
    activeCropId = null;
    draggingHandleIdx = null;
    draggingEdgeIdx = null;
    edgeDragStart = null;
  }

  btnCloseCropModal.addEventListener('click', closeCropModal);
  btnCancelCrop.addEventListener('click', closeCropModal);

  btnAutoDetectCorners.addEventListener('click', () => {
    if (cropSuggestedCorners && cropSuggestedCorners.length === 4) {
      cropCorners = cropSuggestedCorners.map((pt) => ({ x: pt.x, y: pt.y }));
      activeCropMode = 'auto';
      updateCropOverlayUI();
    }
  });

  btnFullFrameCorners.addEventListener('click', () => {
    cropCorners = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    activeCropMode = 'full';
    updateCropOverlayUI();
  });

  function updateCropOverlayUI() {
    const rect = cropBaseImage.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (w === 0 || h === 0) return;

    const pointsAttr = cropCorners
      .map((pt) => `${(pt.x * w).toFixed(1)},${(pt.y * h).toFixed(1)}`)
      .join(' ');
    cropPolygon.setAttribute('points', pointsAttr);

    // Position the 4 corner handles
    cropHandles.forEach((handle, idx) => {
      const pt = cropCorners[idx];
      handle.style.left = `${pt.x * 100}%`;
      handle.style.top = `${pt.y * 100}%`;
    });

    // Position the 4 edge midpoint handles (0: Top 0-1, 1: Right 1-2, 2: Bottom 2-3, 3: Left 3-0)
    cropEdgeHandles.forEach((edgeHandle, edgeIdx) => {
      const cA = cropCorners[edgeIdx];
      const cB = cropCorners[(edgeIdx + 1) % 4];
      const midX = (cA.x + cB.x) * 50;
      const midY = (cA.y + cB.y) * 50;
      edgeHandle.style.left = `${midX}%`;
      edgeHandle.style.top = `${midY}%`;
    });
  }

  function updateMagnifierLoupe(normX, normY, clientX, clientY) {
    if (!cropBaseImage.complete || !cropBaseImage.naturalWidth) return;

    cropLoupe.classList.remove('hidden');
    // Position loupe above and to the left/right of cursor so finger/mouse never covers it
    const loupeSize = 112;
    let left = clientX - loupeSize / 2;
    let top = clientY - loupeSize - 28;
    if (top < 12) {
      top = clientY + 28;
    }
    left = Math.max(12, Math.min(window.innerWidth - loupeSize - 12, left));
    cropLoupe.style.left = `${left}px`;
    cropLoupe.style.top = `${top}px`;

    const ctx = cropLoupeCanvas.getContext('2d');
    const nw = cropBaseImage.naturalWidth;
    const nh = cropBaseImage.naturalHeight;
    const zoom = 2.5;
    const sampleW = loupeSize / zoom;
    const sampleH = loupeSize / zoom;
    const sx = normX * nw - sampleW / 2;
    const sy = normY * nh - sampleH / 2;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, loupeSize, loupeSize);
    ctx.drawImage(
      cropBaseImage,
      sx,
      sy,
      sampleW,
      sampleH,
      0,
      0,
      loupeSize,
      loupeSize
    );
  }

  window.addEventListener('resize', () => {
    if (!cropModal.classList.contains('hidden')) {
      updateCropOverlayUI();
    }
  });

  // Pointer dragging for the 4 individual corner handles
  cropHandles.forEach((handle, idx) => {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      draggingHandleIdx = idx;
      activeCropMode = 'manual';
      handle.setPointerCapture(e.pointerId);
      updateMagnifierLoupe(cropCorners[idx].x, cropCorners[idx].y, e.clientX, e.clientY);
    });

    handle.addEventListener('pointermove', (e) => {
      if (draggingHandleIdx !== idx) return;
      const rect = cropBaseImage.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      cropCorners[idx] = { x: nx, y: ny };
      updateCropOverlayUI();
      updateMagnifierLoupe(nx, ny, e.clientX, e.clientY);
    });

    const stopCornerDrag = (e) => {
      if (draggingHandleIdx === idx) {
        draggingHandleIdx = null;
        cropLoupe.classList.add('hidden');
        try {
          handle.releasePointerCapture(e.pointerId);
        } catch (_err) {
          // Ignore
        }
      }
    };

    handle.addEventListener('pointerup', stopCornerDrag);
    handle.addEventListener('pointercancel', stopCornerDrag);
  });

  // Pointer dragging for the 4 edge handles (moves both corners of that side together)
  cropEdgeHandles.forEach((edgeHandle, edgeIdx) => {
    const idxA = edgeIdx;
    const idxB = (edgeIdx + 1) % 4;

    edgeHandle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      draggingEdgeIdx = edgeIdx;
      activeCropMode = 'manual';
      const rect = cropBaseImage.getBoundingClientRect();
      edgeDragStart = {
        startX: (e.clientX - rect.left) / (rect.width || 1),
        startY: (e.clientY - rect.top) / (rect.height || 1),
        cornerA: { ...cropCorners[idxA] },
        cornerB: { ...cropCorners[idxB] },
      };
      edgeHandle.setPointerCapture(e.pointerId);
    });

    edgeHandle.addEventListener('pointermove', (e) => {
      if (draggingEdgeIdx !== edgeIdx || !edgeDragStart) return;
      const rect = cropBaseImage.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const currX = (e.clientX - rect.left) / rect.width;
      const currY = (e.clientY - rect.top) / rect.height;
      const dx = currX - edgeDragStart.startX;
      const dy = currY - edgeDragStart.startY;

      cropCorners[idxA] = {
        x: Math.max(0, Math.min(1, edgeDragStart.cornerA.x + dx)),
        y: Math.max(0, Math.min(1, edgeDragStart.cornerA.y + dy)),
      };
      cropCorners[idxB] = {
        x: Math.max(0, Math.min(1, edgeDragStart.cornerB.x + dx)),
        y: Math.max(0, Math.min(1, edgeDragStart.cornerB.y + dy)),
      };

      updateCropOverlayUI();
      const midX = (cropCorners[idxA].x + cropCorners[idxB].x) / 2;
      const midY = (cropCorners[idxA].y + cropCorners[idxB].y) / 2;
      updateMagnifierLoupe(midX, midY, e.clientX, e.clientY);
    });

    const stopEdgeDrag = (e) => {
      if (draggingEdgeIdx === edgeIdx) {
        draggingEdgeIdx = null;
        edgeDragStart = null;
        cropLoupe.classList.add('hidden');
        try {
          edgeHandle.releasePointerCapture(e.pointerId);
        } catch (_err) {
          // Ignore
        }
      }
    };

    edgeHandle.addEventListener('pointerup', stopEdgeDrag);
    edgeHandle.addEventListener('pointercancel', stopEdgeDrag);
  });

  btnApplyCrop.addEventListener('click', async () => {
    if (!activeCropId) return;
    const idx = pages.findIndex((p) => p.id === activeCropId);
    const cornersToApply = cropCorners.map((pt) => ({ x: pt.x, y: pt.y }));
    const modeToSave = activeCropMode;
    closeCropModal();
    if (idx !== -1) {
      await processSinglePage(idx, {
        corners: cornersToApply,
        cropMode: modeToSave,
      });
    }
  });

  // Lightbox Preview Modal
  function openPreviewModal(url) {
    previewModalImg.src = url;
    previewModal.classList.remove('hidden');
  }

  btnClosePreviewModal.addEventListener('click', () => {
    previewModal.classList.add('hidden');
    previewModalImg.src = '';
  });

  previewModal.addEventListener('click', (e) => {
    if (e.target === previewModal) {
      previewModal.classList.add('hidden');
      previewModalImg.src = '';
    }
  });

  // PDF Generation & Download (1 image per page)
  async function generateAndDownloadPdf() {
    if (pages.length === 0) return;

    const rawName = (pdfFilename.value || 'documento-escaneado').trim();
    const finalFilename = rawName.endsWith('.pdf') ? rawName : `${rawName}.pdf`;

    showStatus(
      `Generando PDF en alta definición con ${pages.length} ${
        pages.length === 1 ? 'página' : 'páginas'
      }...`,
      'info',
      true
    );

    btnDownloadTop.disabled = true;
    btnDownloadMain.disabled = true;

    try {
      const res = await fetch('/api/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageIds: pages.map((p) => p.id),
          pageSize: pdfPageSize.value,
          orientation: pdfOrientation.value,
          margin: pdfMargin.value,
          filename: finalFilename,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'No se pudo generar el PDF.');
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = finalFilename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      showStatus(`PDF "${finalFilename}" descargado correctamente.`, 'success');
    } catch (err) {
      showStatus(err.message, 'error');
    } finally {
      btnDownloadTop.disabled = pages.length === 0;
      btnDownloadMain.disabled = pages.length === 0;
    }
  }

  btnDownloadTop.addEventListener('click', generateAndDownloadPdf);
  btnDownloadMain.addEventListener('click', generateAndDownloadPdf);
})();
