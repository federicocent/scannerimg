const { PDFDocument, rgb } = require('pdf-lib');

const PAGE_DIMENSIONS = {
  A4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
};

const MARGIN_POINTS = {
  none: 0,
  small: 18,
  normal: 36,
};

/**
 * Generates a PDF buffer with one scanned image per page.
 *
 * @param {Array<{buffer: Buffer, width: number, height: number}>} pages
 * @param {Object} options
 * @param {'A4'|'letter'|'fit'} [options.pageSize='A4']
 * @param {'auto'|'portrait'|'landscape'} [options.orientation='auto']
 * @param {'none'|'small'|'normal'} [options.margin='small']
 * @returns {Promise<Buffer>}
 */
async function buildScannedPdf(pages, options = {}) {
  const {
    pageSize = 'A4',
    orientation = 'auto',
    margin = 'small',
  } = options;

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setCreator('ScannerPDF');
  pdfDoc.setProducer('ScannerPDF (Node.js + pdf-lib + sharp)');
  pdfDoc.setCreationDate(new Date());

  const marginPt = MARGIN_POINTS[margin] ?? MARGIN_POINTS.small;

  for (const item of pages) {
    const embeddedImage = await pdfDoc.embedJpg(item.buffer);
    const imgW = embeddedImage.width;
    const imgH = embeddedImage.height;

    let pageW;
    let pageH;

    if (pageSize === 'fit') {
      // Scale image pixels to standard PDF points (target ~595pt on shorter side)
      const scale = 595.28 / Math.min(imgW, imgH);
      pageW = Math.round(imgW * scale) + marginPt * 2;
      pageH = Math.round(imgH * scale) + marginPt * 2;
    } else {
      const baseDim = PAGE_DIMENSIONS[pageSize] || PAGE_DIMENSIONS.A4;
      const isImageLandscape = imgW > imgH;
      const useLandscape =
        orientation === 'landscape' ||
        (orientation === 'auto' && isImageLandscape);

      pageW = useLandscape ? baseDim.height : baseDim.width;
      pageH = useLandscape ? baseDim.width : baseDim.height;
    }

    const page = pdfDoc.addPage([pageW, pageH]);

    // Pure white page background
    page.drawRectangle({
      x: 0,
      y: 0,
      width: pageW,
      height: pageH,
      color: rgb(1, 1, 1),
    });

    const availW = Math.max(10, pageW - marginPt * 2);
    const availH = Math.max(10, pageH - marginPt * 2);

    const scale = Math.min(availW / imgW, availH / imgH);
    const drawW = imgW * scale;
    const drawH = imgH * scale;

    const drawX = (pageW - drawW) / 2;
    const drawY = (pageH - drawH) / 2;

    page.drawImage(embeddedImage, {
      x: drawX,
      y: drawY,
      width: drawW,
      height: drawH,
    });
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

module.exports = {
  buildScannedPdf,
};
