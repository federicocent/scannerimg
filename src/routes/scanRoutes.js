const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const {
  normalizeUploadedImage,
  processScannedImage,
  getRotatedOriginalPreview,
  isFullFrameCorners,
} = require('../services/scannerService');
const { buildScannedPdf } = require('../services/pdfService');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 30 * 1024 * 1024,
    files: 60,
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error(`Formato de archivo no soportado: ${file.originalname}`));
    }
  },
});

const imageStore = new Map();
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

function cleanupOldItems() {
  const now = Date.now();
  for (const [id, item] of imageStore.entries()) {
    if (now - item.createdAt > MAX_AGE_MS) {
      imageStore.delete(id);
    }
  }
}

function serializeItem(item) {
  return {
    id: item.id,
    originalName: item.originalName,
    width: item.width,
    height: item.height,
    mode: item.mode,
    intensity: item.intensity,
    rotation: item.rotation,
    corners: item.corners,
    suggestedCorners: item.suggestedCorners,
    cropMode: item.cropMode, // 'auto' | 'manual' | 'full'
    version: item.version,
    previewUrl: `/api/images/${item.id}/preview?v=${item.version}`,
  };
}

// POST /api/upload - Upload one or multiple images, auto-detect sheet & crop by default
router.post('/upload', upload.array('images', 60), async (req, res, next) => {
  try {
    cleanupOldItems();

    const files = req.files;
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No se recibieron imágenes para escanear.' });
    }

    const mode = req.body.mode || 'magic_color';
    const intensity = req.body.intensity !== undefined ? Number(req.body.intensity) : 60;
    // Enabled by default unless explicitly set to 'false'
    const autoCrop = req.body.autoCrop !== 'false' && req.body.autoCrop !== false;

    const fullCorners = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];

    const results = await Promise.all(
      files.map(async (file) => {
        const normalized = await normalizeUploadedImage(file.buffer);
        const initialCorners = autoCrop ? normalized.suggestedCorners : fullCorners;
        const detectedSheet = !isFullFrameCorners(initialCorners);

        const scanned = await processScannedImage(normalized.baseBuffer, {
          mode,
          intensity,
          rotation: 0,
          corners: initialCorners,
          forPdf: false,
        });

        const id = crypto.randomUUID();
        const item = {
          id,
          originalName: file.originalname,
          baseBuffer: normalized.baseBuffer,
          previewBuffer: scanned.buffer,
          width: scanned.width,
          height: scanned.height,
          mode,
          intensity,
          rotation: 0,
          corners: initialCorners,
          suggestedCorners: normalized.suggestedCorners,
          cropMode: detectedSheet ? 'auto' : 'full',
          version: 1,
          createdAt: Date.now(),
        };

        imageStore.set(id, item);
        return serializeItem(item);
      })
    );

    res.json({ items: results });
  } catch (err) {
    next(err);
  }
});

// GET /api/images/:id/preview - Serve scanned image preview
router.get('/images/:id/preview', (req, res) => {
  const item = imageStore.get(req.params.id);
  if (!item) {
    return res.status(404).json({ error: 'Imagen no encontrada.' });
  }
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.send(item.previewBuffer);
});

// GET /api/images/:id/crop-data - Get uncropped rotated image and auto-detected corners for manual crop editor
router.get('/images/:id/crop-data', async (req, res, next) => {
  try {
    const item = imageStore.get(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Imagen no encontrada.' });
    }

    const rotatedOrig = await getRotatedOriginalPreview(item.baseBuffer, item.rotation);
    item.suggestedCorners = rotatedOrig.suggestedCorners;
    const dataUrl = `data:image/jpeg;base64,${rotatedOrig.buffer.toString('base64')}`;

    res.json({
      id: item.id,
      width: rotatedOrig.width,
      height: rotatedOrig.height,
      currentCorners: item.corners,
      suggestedCorners: rotatedOrig.suggestedCorners,
      cropMode: item.cropMode,
      imageDataUrl: dataUrl,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/images/:id/process - Update scan settings (mode, intensity, rotation, corners, cropMode)
router.post('/images/:id/process', async (req, res, next) => {
  try {
    const item = imageStore.get(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Imagen no encontrada.' });
    }

    const prevRotation = item.rotation;
    if (req.body.mode !== undefined) item.mode = req.body.mode;
    if (req.body.intensity !== undefined) item.intensity = Number(req.body.intensity);
    if (req.body.rotation !== undefined) {
      item.rotation = ((Number(req.body.rotation) % 360) + 360) % 360;
    }

    if (req.body.corners !== undefined) {
      item.corners = req.body.corners;
      if (req.body.cropMode) {
        item.cropMode = req.body.cropMode;
      } else {
        item.cropMode = isFullFrameCorners(item.corners) ? 'full' : 'manual';
      }
    } else if (item.rotation !== prevRotation) {
      // Re-detect sheet corners in the new orientation
      const rotatedOrig = await getRotatedOriginalPreview(item.baseBuffer, item.rotation);
      item.suggestedCorners = rotatedOrig.suggestedCorners;
      item.corners = rotatedOrig.suggestedCorners;
      item.cropMode = isFullFrameCorners(item.corners) ? 'full' : 'auto';
    }

    const scanned = await processScannedImage(item.baseBuffer, {
      mode: item.mode,
      intensity: item.intensity,
      rotation: item.rotation,
      corners: item.corners,
      forPdf: false,
    });

    item.previewBuffer = scanned.buffer;
    item.width = scanned.width;
    item.height = scanned.height;
    item.version += 1;

    res.json({ item: serializeItem(item) });
  } catch (err) {
    next(err);
  }
});

// POST /api/images/batch-process - Apply filter mode & intensity to all specified images
router.post('/images/batch-process', async (req, res, next) => {
  try {
    const { imageIds, mode, intensity } = req.body;
    if (!Array.isArray(imageIds) || imageIds.length === 0) {
      return res.status(400).json({ error: 'No hay imágenes seleccionadas.' });
    }

    const updatedItems = await Promise.all(
      imageIds.map(async (id) => {
        const item = imageStore.get(id);
        if (!item) return null;

        if (mode !== undefined) item.mode = mode;
        if (intensity !== undefined) item.intensity = Number(intensity);

        const scanned = await processScannedImage(item.baseBuffer, {
          mode: item.mode,
          intensity: item.intensity,
          rotation: item.rotation,
          corners: item.corners,
          forPdf: false,
        });

        item.previewBuffer = scanned.buffer;
        item.width = scanned.width;
        item.height = scanned.height;
        item.version += 1;
        return serializeItem(item);
      })
    );

    res.json({ items: updatedItems.filter(Boolean) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/images/:id - Remove single image
router.delete('/images/:id', (req, res) => {
  imageStore.delete(req.params.id);
  res.json({ ok: true });
});

// DELETE /api/images - Clear all images
router.delete('/images', (_req, res) => {
  imageStore.clear();
  res.json({ ok: true });
});

// POST /api/pdf - Generate and download PDF with one scanned image per page
router.post('/pdf', async (req, res, next) => {
  try {
    const {
      imageIds,
      pageSize = 'A4',
      orientation = 'auto',
      margin = 'small',
      filename = 'documento-escaneado.pdf',
    } = req.body;

    if (!Array.isArray(imageIds) || imageIds.length === 0) {
      return res.status(400).json({ error: 'Debes incluir al menos una imagen para generar el PDF.' });
    }

    const items = imageIds.map((id) => imageStore.get(id)).filter(Boolean);
    if (items.length === 0) {
      return res.status(404).json({ error: 'Las imágenes seleccionadas ya no están disponibles. Vuelve a subirlas.' });
    }

    const highResPages = await Promise.all(
      items.map((item) =>
        processScannedImage(item.baseBuffer, {
          mode: item.mode,
          intensity: item.intensity,
          rotation: item.rotation,
          corners: item.corners,
          forPdf: true,
        })
      )
    );

    const pdfBuffer = await buildScannedPdf(highResPages, {
      pageSize,
      orientation,
      margin,
    });

    const cleanName =
      String(filename || 'documento-escaneado')
        .replace(/\.pdf$/i, '')
        .replace(/[^a-zA-Z0-9_\-\sáéíóúÁÉÍÓÚñÑ]/g, '')
        .trim() || 'documento-escaneado';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(cleanName)}.pdf"`
    );
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
