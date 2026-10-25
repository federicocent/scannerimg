const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const app = require('../src/server');

/**
 * Creates a synthetic test image simulating a photographed paper sheet on a wooden/dark desk
 * with uneven shadow lighting and dark ink strokes.
 */
async function createTestDocumentImage(width = 600, height = 800) {
  const buf = Buffer.allocUnsafe(width * height * 3);
  const padX = Math.round(width * 0.12);
  const padY = Math.round(height * 0.12);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3;
      const inPaper = x >= padX && x <= width - padX && y >= padY && y <= height - padY;
      if (!inPaper) {
        // Wooden desk background (warm brown, high chroma, lower paper score)
        buf[idx] = 115;
        buf[idx + 1] = 72;
        buf[idx + 2] = 35;
      } else {
        // Simulated shadow gradient across the paper sheet
        const shadow = Math.round(175 + 65 * (x / width) * (y / height));
        // Simulated dark ink horizontal text lines every 45px
        const isTextLine =
          y > padY + 50 &&
          y < height - padY - 50 &&
          y % 45 < 5 &&
          x > padX + 40 &&
          x < width - padX - 40;
        if (isTextLine) {
          buf[idx] = 20;
          buf[idx + 1] = 25;
          buf[idx + 2] = 90;
        } else {
          buf[idx] = shadow;
          buf[idx + 1] = shadow - 2;
          buf[idx + 2] = shadow - 5;
        }
      }
    }
  }

  return sharp(buf, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 90 })
    .toBuffer();
}

test('Detección y recorte automático de hoja al subir + modificación manual + PDF', async () => {
  const server = app.listen(0);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const img1 = await createTestDocumentImage(600, 800);
    const img2 = await createTestDocumentImage(800, 600);

    const formData = new FormData();
    formData.append('images', new Blob([img1], { type: 'image/jpeg' }), 'hoja1.jpg');
    formData.append('images', new Blob([img2], { type: 'image/jpeg' }), 'hoja2.jpg');
    formData.append('mode', 'magic_color');
    formData.append('intensity', '65');

    // 1. Upload images -> should auto-detect sheet and auto-crop by default
    const uploadRes = await fetch(`${baseUrl}/api/upload`, {
      method: 'POST',
      body: formData,
    });
    assert.equal(uploadRes.status, 200);
    const uploadData = await uploadRes.json();
    assert.equal(uploadData.items.length, 2);

    const [item1, item2] = uploadData.items;
    assert.equal(item1.cropMode, 'auto', 'Debe aplicar recorte automático por defecto');

    // Verify detected top-left corner is near (0.12, 0.12), not (0, 0)
    assert.ok(
      item1.corners[0].x > 0.06 && item1.corners[0].x < 0.2,
      `Esquina TL X detectada (${item1.corners[0].x}) debe ajustarse al borde de la hoja (~0.12)`
    );
    assert.ok(
      item1.corners[0].y > 0.06 && item1.corners[0].y < 0.2,
      `Esquina TL Y detectada (${item1.corners[0].y}) debe ajustarse al borde de la hoja (~0.12)`
    );

    // Verify auto-cropped width/height is smaller than the full 600x800 frame
    assert.ok(item1.width < 550 && item1.height < 740);

    // 2. Fetch crop-data for manual editing
    const cropDataRes = await fetch(`${baseUrl}/api/images/${item1.id}/crop-data`);
    assert.equal(cropDataRes.status, 200);
    const cropData = await cropDataRes.json();
    assert.ok(cropData.imageDataUrl.startsWith('data:image/jpeg;base64,'));
    assert.equal(cropData.suggestedCorners.length, 4);

    // 3. Modify crop manually
    const manualCorners = [
      { x: 0.05, y: 0.05 },
      { x: 0.95, y: 0.05 },
      { x: 0.95, y: 0.95 },
      { x: 0.05, y: 0.95 },
    ];
    const procRes = await fetch(`${baseUrl}/api/images/${item1.id}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        corners: manualCorners,
        cropMode: 'manual',
      }),
    });
    assert.equal(procRes.status, 200);
    const procData = await procRes.json();
    assert.equal(procData.item.cropMode, 'manual');
    assert.deepEqual(procData.item.corners, manualCorners);

    // 4. Generate PDF with 1 image per page
    const pdfRes = await fetch(`${baseUrl}/api/pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageIds: [item1.id, item2.id],
        pageSize: 'A4',
        orientation: 'auto',
        margin: 'small',
        filename: 'hojas-recortadas.pdf',
      }),
    });
    assert.equal(pdfRes.status, 200);
    const pdfBytes = Buffer.from(await pdfRes.arrayBuffer());
    const loadedPdf = await PDFDocument.load(pdfBytes);
    assert.equal(loadedPdf.getPageCount(), 2);
  } finally {
    server.close();
  }
});
