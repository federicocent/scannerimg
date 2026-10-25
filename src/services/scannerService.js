const sharp = require('sharp');

const MAX_SCAN_DIMENSION = 2400;
const PREVIEW_DIMENSION = 1200;

/**
 * Solves an 8x8 linear system Ax = b using Gaussian elimination with partial pivoting.
 * Used to compute the 3x3 perspective homography matrix from 4 point correspondences.
 */
function solveLinearSystem8x8(A, b) {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let maxRow = col;
    let maxVal = Math.abs(M[col][col]);
    for (let row = col + 1; row < n; row++) {
      const val = Math.abs(M[row][col]);
      if (val > maxVal) {
        maxVal = val;
        maxRow = row;
      }
    }

    if (maxRow !== col) {
      const tmp = M[col];
      M[col] = M[maxRow];
      M[maxRow] = tmp;
    }

    const pivot = M[col][col];
    if (Math.abs(pivot) < 1e-12) {
      return null;
    }

    for (let j = col; j <= n; j++) {
      M[col][j] /= pivot;
    }

    for (let row = 0; row < n; row++) {
      if (row !== col) {
        const factor = M[row][col];
        for (let j = col; j <= n; j++) {
          M[row][j] -= factor * M[col][j];
        }
      }
    }
  }

  return M.map((row) => row[n]);
}

/**
 * Computes the homography matrix H mapping destination rectangle [0..dstW, 0..dstH]
 * to source quadrilateral [tl, tr, br, bl] in pixel coordinates.
 */
function computeInverseHomography(dstW, dstH, srcQuad) {
  const dstPts = [
    { u: 0, v: 0 },
    { u: dstW - 1, v: 0 },
    { u: dstW - 1, v: dstH - 1 },
    { u: 0, v: dstH - 1 },
  ];

  const A = [];
  const b = [];

  for (let i = 0; i < 4; i++) {
    const { u, v } = dstPts[i];
    const { x, y } = srcQuad[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    b.push(y);
  }

  return solveLinearSystem8x8(A, b);
}

/**
 * Checks whether normalized corners [tl, tr, br, bl] represent the full uncropped image.
 */
function isFullFrameCorners(corners) {
  if (!Array.isArray(corners) || corners.length !== 4) return true;
  const defaults = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  const eps = 0.004;
  return corners.every(
    (pt, idx) =>
      Math.abs(pt.x - defaults[idx].x) < eps &&
      Math.abs(pt.y - defaults[idx].y) < eps
  );
}

/**
 * Performs 4-point perspective warp (de-skewing) with bilinear interpolation.
 */
function warpPerspectiveRGB(srcBuf, srcW, srcH, normalizedCorners) {
  if (isFullFrameCorners(normalizedCorners)) {
    return { data: srcBuf, width: srcW, height: srcH };
  }

  const srcQuad = normalizedCorners.map((pt) => ({
    x: Math.max(0, Math.min(srcW - 1, pt.x * (srcW - 1))),
    y: Math.max(0, Math.min(srcH - 1, pt.y * (srcH - 1))),
  }));

  const [tl, tr, br, bl] = srcQuad;
  const topW = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const bottomW = Math.hypot(br.x - bl.x, br.y - bl.y);
  const leftH = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const rightH = Math.hypot(br.x - tr.x, br.y - tr.y);

  const dstW = Math.max(32, Math.round(Math.max(topW, bottomW)));
  const dstH = Math.max(32, Math.round(Math.max(leftH, rightH)));

  const H = computeInverseHomography(dstW, dstH, srcQuad);
  if (!H) {
    return { data: srcBuf, width: srcW, height: srcH };
  }

  const [h0, h1, h2, h3, h4, h5, h6, h7] = H;
  const dstBuf = Buffer.allocUnsafe(dstW * dstH * 3);

  for (let v = 0; v < dstH; v++) {
    const vTermX = h1 * v + h2;
    const vTermY = h4 * v + h5;
    const vTermW = h7 * v + 1;

    for (let u = 0; u < dstW; u++) {
      const denom = h6 * u + vTermW;
      const srcX = (h0 * u + vTermX) / denom;
      const srcY = (h3 * u + vTermY) / denom;

      const x0 = Math.max(0, Math.min(srcW - 1, Math.floor(srcX)));
      const y0 = Math.max(0, Math.min(srcH - 1, Math.floor(srcY)));
      const x1 = Math.min(srcW - 1, x0 + 1);
      const y1 = Math.min(srcH - 1, y0 + 1);

      const dx = Math.max(0, Math.min(1, srcX - x0));
      const dy = Math.max(0, Math.min(1, srcY - y0));

      const w00 = (1 - dx) * (1 - dy);
      const w10 = dx * (1 - dy);
      const w01 = (1 - dx) * dy;
      const w11 = dx * dy;

      const idx00 = (y0 * srcW + x0) * 3;
      const idx10 = (y0 * srcW + x1) * 3;
      const idx01 = (y1 * srcW + x0) * 3;
      const idx11 = (y1 * srcW + x1) * 3;

      const dstIdx = (v * dstW + u) * 3;
      dstBuf[dstIdx] = Math.round(
        srcBuf[idx00] * w00 +
          srcBuf[idx10] * w10 +
          srcBuf[idx01] * w01 +
          srcBuf[idx11] * w11
      );
      dstBuf[dstIdx + 1] = Math.round(
        srcBuf[idx00 + 1] * w00 +
          srcBuf[idx10 + 1] * w10 +
          srcBuf[idx01 + 1] * w01 +
          srcBuf[idx11 + 1] * w11
      );
      dstBuf[dstIdx + 2] = Math.round(
        srcBuf[idx00 + 2] * w00 +
          srcBuf[idx10 + 2] * w10 +
          srcBuf[idx01 + 2] * w01 +
          srcBuf[idx11 + 2] * w11
      );
    }
  }

  return { data: dstBuf, width: dstW, height: dstH };
}

/**
 * Computes 2D Monotone Chain Convex Hull of an array of {x, y} points.
 */
function computeConvexHull(points) {
  if (points.length <= 4) return points.slice();
  const sorted = points
    .slice()
    .sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));

  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/**
 * Computes the area of a quadrilateral (p0, p1, p2, p3) using the Shoelace formula.
 */
function quadArea(p0, p1, p2, p3) {
  return (
    0.5 *
    Math.abs(
      p0.x * p1.y -
        p1.x * p0.y +
        p1.x * p2.y -
        p2.x * p1.y +
        p2.x * p3.y -
        p3.x * p2.y +
        p3.x * p0.y -
        p0.x * p3.y
    )
  );
}

/**
 * Orders 4 points into [tl, tr, br, bl] clockwise starting from top-left.
 */
function orderQuadCorners(pts) {
  const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
  const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;

  // Sort clockwise in image coordinates (y down, x right => atan2(y - cy, x - cx) ascending)
  const cw = pts
    .slice()
    .sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));

  // Find top-left (minimum x + y)
  let minIdx = 0;
  let minSum = Infinity;
  for (let i = 0; i < 4; i++) {
    const s = cw[i].x + cw[i].y;
    if (s < minSum) {
      minSum = s;
      minIdx = i;
    }
  }

  return [
    cw[minIdx],
    cw[(minIdx + 1) % 4],
    cw[(minIdx + 2) % 4],
    cw[(minIdx + 3) % 4],
  ];
}

/**
 * Finds the best 4 corners [tl, tr, br, bl] from a convex hull of boundary points.
 */
function fitQuadToConvexHull(hull) {
  if (hull.length < 4) return null;
  if (hull.length === 4) return orderQuadCorners(hull);

  // Subsample hull to at most 40 vertices for fast O(N^4) / iterative max-area quad search
  let candidates = hull;
  if (hull.length > 40) {
    const step = hull.length / 40;
    candidates = [];
    for (let i = 0; i < 40; i++) {
      candidates.push(hull[Math.floor(i * step)]);
    }
  }

  // Initialize with extreme points along (x+y) and (x-y)
  let tl = candidates[0];
  let tr = candidates[0];
  let br = candidates[0];
  let bl = candidates[0];
  let minSum = Infinity;
  let maxSum = -Infinity;
  let maxDiff = -Infinity;
  let minDiff = Infinity;

  for (const p of candidates) {
    const sum = p.x + p.y;
    const diff = p.x - p.y;
    if (sum < minSum) {
      minSum = sum;
      tl = p;
    }
    if (sum > maxSum) {
      maxSum = sum;
      br = p;
    }
    if (diff > maxDiff) {
      maxDiff = diff;
      tr = p;
    }
    if (diff < minDiff) {
      minDiff = diff;
      bl = p;
    }
  }

  // Coordinate-ascent optimization on hull vertices to maximize quadrilateral area
  // (Handles rotated sheets at arbitrary angles)
  let best = [tl, tr, br, bl];
  let bestArea = quadArea(best[0], best[1], best[2], best[3]);

  for (let iter = 0; iter < 3; iter++) {
    let improved = false;
    for (let cornerIdx = 0; cornerIdx < 4; cornerIdx++) {
      for (const pt of candidates) {
        const trial = best.slice();
        trial[cornerIdx] = pt;
        const area = quadArea(trial[0], trial[1], trial[2], trial[3]);
        if (area > bestArea) {
          bestArea = area;
          best = trial;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  return orderQuadCorners(best);
}

/**
 * Automatically detects the 4 corners [tl, tr, br, bl] of a paper sheet in normalized [0..1] coordinates.
 * Combines:
 * 1. Achromatic Paper Score (high luminance + low color saturation so wooden/colored tables are rejected)
 * 2. Central-region adaptive & Otsu thresholding
 * 3. Connected Component Analysis (BFS) to isolate the primary central sheet and ignore background clutter
 * 4. Convex Hull + Maximum-Area Quadrilateral corner fitting
 */
function detectDocumentCornersFromRGB(rgbBuf, width, height) {
  const fullFrame = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];

  const stepX = Math.max(1, Math.floor(width / 220));
  const stepY = Math.max(1, Math.floor(height / 220));
  const gw = Math.floor(width / stepX);
  const gh = Math.floor(height / stepY);

  if (gw < 24 || gh < 24) return fullFrame;

  const total = gw * gh;
  const rawScore = new Uint8Array(total);

  // 1. Compute Paper Score: high brightness (Y) penalized by color saturation (chroma)
  for (let gy = 0; gy < gh; gy++) {
    const py = gy * stepY;
    for (let gx = 0; gx < gw; gx++) {
      const px = gx * stepX;
      const idx = (py * width + px) * 3;
      const r = rgbBuf[idx];
      const g = rgbBuf[idx + 1];
      const b = rgbBuf[idx + 2];

      const yVal = (77 * r + 150 * g + 29 * b) >> 8;
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const chroma = maxC - minC;

      // Paper is bright and near-neutral (low chroma); wood/colored surfaces have high chroma
      const score = Math.max(0, Math.min(255, Math.round(yVal - 0.75 * chroma)));
      rawScore[gy * gw + gx] = score;
    }
  }

  // 2. Smooth Paper Score with 3x3 box filter & build histogram
  const score = new Uint8Array(total);
  const hist = new Int32Array(256);

  for (let gy = 0; gy < gh; gy++) {
    const y0 = Math.max(0, gy - 1);
    const y1 = Math.min(gh - 1, gy + 1);
    for (let gx = 0; gx < gw; gx++) {
      const x0 = Math.max(0, gx - 1);
      const x1 = Math.min(gw - 1, gx + 1);
      let sum = 0;
      let count = 0;
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          sum += rawScore[yy * gw + xx];
          count++;
        }
      }
      const val = Math.round(sum / count);
      score[gy * gw + gx] = val;
      hist[val]++;
    }
  }

  // 3. Compute Otsu threshold on Paper Score + sample central region
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];

  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let otsuThreshold = 135;

  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;

    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const betweenVar = wB * wF * (mB - mF) * (mB - mF);
    if (betweenVar > maxVar) {
      maxVar = betweenVar;
      otsuThreshold = t;
    }
  }

  // Sample central box [0.25..0.75] where the document sheet is located
  const centerValues = [];
  const cx0 = Math.floor(gw * 0.25);
  const cx1 = Math.ceil(gw * 0.75);
  const cy0 = Math.floor(gh * 0.25);
  const cy1 = Math.ceil(gh * 0.75);

  for (let gy = cy0; gy < cy1; gy++) {
    for (let gx = cx0; gx < cx1; gx++) {
      centerValues.push(score[gy * gw + gx]);
    }
  }
  centerValues.sort((a, b) => a - b);
  const center75 = centerValues[Math.floor(centerValues.length * 0.75)] || 180;

  // Blend Otsu threshold with central sheet brightness so dark text inside the sheet doesn't raise threshold too high
  const threshold = Math.round(0.6 * otsuThreshold + 0.4 * (center75 * 0.78));

  // Check if outer border is already mostly bright paper (e.g. already cropped image)
  let borderBright = 0;
  let borderTotal = 0;
  for (let gx = 0; gx < gw; gx++) {
    if (score[gx] > threshold) borderBright++;
    if (score[(gh - 1) * gw + gx] > threshold) borderBright++;
    borderTotal += 2;
  }
  for (let gy = 0; gy < gh; gy++) {
    if (score[gy * gw] > threshold) borderBright++;
    if (score[gy * gw + (gw - 1)] > threshold) borderBright++;
    borderTotal += 2;
  }

  if (borderBright / borderTotal > 0.85) {
    return fullFrame;
  }

  // 4. Connected Component Labeling (BFS) on binary paper mask
  const labels = new Int32Array(total);
  let nextLabel = 1;
  let bestLabel = -1;
  let bestComponentScore = -1;

  const queue = new Int32Array(total);

  for (let i = 0; i < total; i++) {
    if (score[i] <= threshold || labels[i] !== 0) continue;

    const currentLabel = nextLabel++;
    let head = 0;
    let tail = 0;
    queue[tail++] = i;
    labels[i] = currentLabel;

    let area = 0;
    let centerHits = 0;

    while (head < tail) {
      const curr = queue[head++];
      area++;
      const cy = Math.floor(curr / gw);
      const cx = curr - cy * gw;

      if (cx >= cx0 && cx < cx1 && cy >= cy0 && cy < cy1) {
        centerHits++;
      }

      // 4-connected neighbors
      if (cx > 0) {
        const n = curr - 1;
        if (labels[n] === 0 && score[n] > threshold) {
          labels[n] = currentLabel;
          queue[tail++] = n;
        }
      }
      if (cx < gw - 1) {
        const n = curr + 1;
        if (labels[n] === 0 && score[n] > threshold) {
          labels[n] = currentLabel;
          queue[tail++] = n;
        }
      }
      if (cy > 0) {
        const n = curr - gw;
        if (labels[n] === 0 && score[n] > threshold) {
          labels[n] = currentLabel;
          queue[tail++] = n;
        }
      }
      if (cy < gh - 1) {
        const n = curr + gw;
        if (labels[n] === 0 && score[n] > threshold) {
          labels[n] = currentLabel;
          queue[tail++] = n;
        }
      }
    }

    // Weight component by area and centrality so the main document sheet always wins
    const compScore = area + centerHits * 2.5;
    if (area >= total * 0.08 && compScore > bestComponentScore) {
      bestComponentScore = compScore;
      bestLabel = currentLabel;
    }
  }

  if (bestLabel === -1) {
    return fullFrame;
  }

  // 5. Collect boundary points of the winning sheet component
  const boundaryPoints = [];
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const idx = gy * gw + gx;
      if (labels[idx] !== bestLabel) continue;

      const isEdge =
        gx === 0 ||
        gx === gw - 1 ||
        gy === 0 ||
        gy === gh - 1 ||
        labels[idx - 1] !== bestLabel ||
        labels[idx + 1] !== bestLabel ||
        labels[idx - gw] !== bestLabel ||
        labels[idx + gw] !== bestLabel;

      if (isEdge) {
        boundaryPoints.push({
          x: gx / (gw - 1),
          y: gy / (gh - 1),
        });
      }
    }
  }

  if (boundaryPoints.length < 12) {
    return fullFrame;
  }

  const hull = computeConvexHull(boundaryPoints);
  const fittedQuad = fitQuadToConvexHull(hull);
  if (!fittedQuad) {
    return fullFrame;
  }

  // Validate quad covers at least 10% of the frame
  if (quadArea(fittedQuad[0], fittedQuad[1], fittedQuad[2], fittedQuad[3]) < 0.1) {
    return fullFrame;
  }

  return fittedQuad;
}

/**
 * Applies document scanner enhancement using Summed Area Table (Integral Image)
 * illumination normalization to remove shadows, uneven lighting, and background tint.
 */
function applyScannerFilterRGB(rgbBuf, width, height, mode = 'magic_color', intensity = 60) {
  if (mode === 'original') {
    return Buffer.from(rgbBuf);
  }

  const clampedIntensity = Math.max(0, Math.min(100, Number(intensity) || 60));
  const numPixels = width * height;
  const outBuf = Buffer.allocUnsafe(numPixels * 3);

  // 1. Compute luminance and build Integral Image (Summed Area Table)
  const lum = new Uint8Array(numPixels);
  const satW = width + 1;
  const sat = new Float64Array(satW * (height + 1));

  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    const prevRowOffset = y * satW;
    const currRowOffset = (y + 1) * satW;
    const imgRowOffset = y * width;

    for (let x = 0; x < width; x++) {
      const pIdx = (imgRowOffset + x) * 3;
      const yVal =
        (77 * rgbBuf[pIdx] + 150 * rgbBuf[pIdx + 1] + 29 * rgbBuf[pIdx + 2]) >> 8;
      lum[imgRowOffset + x] = yVal;
      rowSum += yVal;
      sat[currRowOffset + x + 1] = sat[prevRowOffset + x + 1] + rowSum;
    }
  }

  const minDim = Math.min(width, height);
  const maxDim = Math.max(width, height);
  const radSmall = Math.max(12, Math.round(minDim / 42));
  const radLarge = Math.max(45, Math.round(maxDim / 12));

  const bwThreshold = 188 + (clampedIntensity - 50) * 0.55;
  const bwDelta = 20;

  const whiteClip = 232 - clampedIntensity * 0.25;
  const blackCrush = 24 + clampedIntensity * 0.35;
  const levelSpan = Math.max(40, whiteClip - blackCrush);

  for (let y = 0; y < height; y++) {
    const sy0 = Math.max(0, y - radSmall);
    const sy1 = Math.min(height, y + radSmall + 1);
    const ly0 = Math.max(0, y - radLarge);
    const ly1 = Math.min(height, y + radLarge + 1);

    const sy0Off = sy0 * satW;
    const sy1Off = sy1 * satW;
    const ly0Off = ly0 * satW;
    const ly1Off = ly1 * satW;

    const sH = sy1 - sy0;
    const lH = ly1 - ly0;
    const rowOff = y * width;

    for (let x = 0; x < width; x++) {
      const sx0 = Math.max(0, x - radSmall);
      const sx1 = Math.min(width, x + radSmall + 1);
      const lx0 = Math.max(0, x - radLarge);
      const lx1 = Math.min(width, x + radLarge + 1);

      const areaSmall = (sx1 - sx0) * sH;
      const sumSmall =
        sat[sy1Off + sx1] -
        sat[sy0Off + sx1] -
        sat[sy1Off + sx0] +
        sat[sy0Off + sx0];
      const bgSmall = sumSmall / areaSmall;

      const areaLarge = (lx1 - lx0) * lH;
      const sumLarge =
        sat[ly1Off + lx1] -
        sat[ly0Off + lx1] -
        sat[ly1Off + lx0] +
        sat[ly0Off + lx0];
      const bgLarge = sumLarge / areaLarge;

      const bg = Math.max(85, 0.65 * bgLarge + 0.35 * bgSmall);

      const pIdx = (rowOff + x) * 3;
      const yVal = lum[rowOff + x];
      const normY = Math.min(255, (yVal * 250) / (bg + 1));

      if (mode === 'bw') {
        let v;
        if (normY >= bwThreshold + bwDelta) {
          v = 255;
        } else if (normY <= bwThreshold - bwDelta) {
          v = 0;
        } else {
          const t = (normY - (bwThreshold - bwDelta)) / (2 * bwDelta);
          v = Math.round(255 * t * t * (3 - 2 * t));
        }
        outBuf[pIdx] = v;
        outBuf[pIdx + 1] = v;
        outBuf[pIdx + 2] = v;
      } else if (mode === 'grayscale') {
        let t = (normY - blackCrush) / levelSpan;
        t = Math.max(0, Math.min(1, t));
        const v = Math.round(255 * t * t * (3 - 2 * t));
        outBuf[pIdx] = v;
        outBuf[pIdx + 1] = v;
        outBuf[pIdx + 2] = v;
      } else {
        const gain = 250 / (bg + 1);
        let r = Math.min(255, rgbBuf[pIdx] * gain);
        let g = Math.min(255, rgbBuf[pIdx + 1] * gain);
        let b = Math.min(255, rgbBuf[pIdx + 2] * gain);

        r = Math.max(0, Math.min(1, (r - blackCrush) / levelSpan));
        g = Math.max(0, Math.min(1, (g - blackCrush) / levelSpan));
        b = Math.max(0, Math.min(1, (b - blackCrush) / levelSpan));

        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        if (l < 0.92) {
          const satBoost = 1.28;
          r = Math.max(0, Math.min(1, l + (r - l) * satBoost));
          g = Math.max(0, Math.min(1, l + (g - l) * satBoost));
          b = Math.max(0, Math.min(1, l + (b - l) * satBoost));
        }

        outBuf[pIdx] = Math.round(r * 255);
        outBuf[pIdx + 1] = Math.round(g * 255);
        outBuf[pIdx + 2] = Math.round(b * 255);
      }
    }
  }

  return outBuf;
}

/**
 * Prepares the normalized base image (EXIF auto-orient + resized within MAX_SCAN_DIMENSION)
 * and computes suggested document corners automatically.
 */
async function normalizeUploadedImage(inputBuffer) {
  const { data, info } = await sharp(inputBuffer)
    .rotate()
    .resize({
      width: MAX_SCAN_DIMENSION,
      height: MAX_SCAN_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const suggestedCorners = detectDocumentCornersFromRGB(data, info.width, info.height);

  const normalizedJpeg = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 3 },
  })
    .jpeg({ quality: 92 })
    .toBuffer();

  return {
    baseBuffer: normalizedJpeg,
    width: info.width,
    height: info.height,
    suggestedCorners,
    autoCropped: !isFullFrameCorners(suggestedCorners),
  };
}

/**
 * Processes an image with rotation, 4-point perspective crop, and scanner filter mode.
 */
async function processScannedImage(baseBuffer, options = {}) {
  const {
    mode = 'magic_color',
    intensity = 60,
    rotation = 0,
    corners = null,
    forPdf = false,
  } = options;

  const validRotation = ((Number(rotation) % 360) + 360) % 360;
  const maxDim = forPdf ? MAX_SCAN_DIMENSION : PREVIEW_DIMENSION;

  let pipeline = sharp(baseBuffer);
  if (validRotation === 90 || validRotation === 180 || validRotation === 270) {
    pipeline = pipeline.rotate(validRotation);
  }

  const { data: rotatedRaw, info } = await pipeline
    .resize({
      width: maxDim,
      height: maxDim,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const warped = warpPerspectiveRGB(rotatedRaw, info.width, info.height, corners);

  const scannedRaw = applyScannerFilterRGB(
    warped.data,
    warped.width,
    warped.height,
    mode,
    intensity
  );

  let outPipeline = sharp(scannedRaw, {
    raw: { width: warped.width, height: warped.height, channels: 3 },
  });

  if (mode !== 'original') {
    outPipeline = outPipeline.sharpen({ sigma: 0.85, m1: 0.8, m2: 1.8 });
  }

  const outputBuffer = await outPipeline
    .jpeg({ quality: forPdf ? 90 : 84, mozjpeg: true })
    .toBuffer();

  return {
    buffer: outputBuffer,
    width: warped.width,
    height: warped.height,
    isCropped: !isFullFrameCorners(corners),
  };
}

/**
 * Returns the rotated base image buffer (without scan filter or crop) for the interactive crop modal,
 * along with newly detected corners for that orientation.
 */
async function getRotatedOriginalPreview(baseBuffer, rotation = 0) {
  const validRotation = ((Number(rotation) % 360) + 360) % 360;
  let pipeline = sharp(baseBuffer);
  if (validRotation === 90 || validRotation === 180 || validRotation === 270) {
    pipeline = pipeline.rotate(validRotation);
  }

  const { data, info } = await pipeline
    .resize({
      width: PREVIEW_DIMENSION,
      height: PREVIEW_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const suggestedCorners = detectDocumentCornersFromRGB(data, info.width, info.height);
  const jpegBuffer = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 3 },
  })
    .jpeg({ quality: 86 })
    .toBuffer();

  return {
    buffer: jpegBuffer,
    width: info.width,
    height: info.height,
    suggestedCorners,
  };
}

module.exports = {
  normalizeUploadedImage,
  processScannedImage,
  getRotatedOriginalPreview,
  isFullFrameCorners,
};
