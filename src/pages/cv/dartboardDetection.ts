export interface Point {
  x: number;
  y: number;
}

export interface Ellipse {
  centerX: number;
  centerY: number;
  radiusX: number;
  radiusY: number;
  rotation: number;
}

export interface DartboardDetectionResult {
  ellipse: Ellipse;
  quality: number;
  patternScore: number;
  edgeScore: number;
  ringScore: number;
  fieldScore: number;
}

interface Blob {
  area: number;
  boundingBox: { x: number; y: number; width: number; height: number };
  centroid: Point;
}

interface FeatureMaps {
  mask: Uint8ClampedArray;
  colorMask: Uint8ClampedArray;
  redGreen: Float32Array;
  colorStrength: Float32Array;
  luminance: Float32Array;
  edge: Float32Array;
}

interface CandidateSeed {
  ellipse: Ellipse;
  source: 'blob' | 'previous' | 'center' | 'edge';
}

interface CandidateMetrics {
  quality01: number;
  patternScore: number;
  edgeScore: number;
  ringScore: number;
  colorCoverageScore: number;
  colorAlternationScore: number;
  scoringRingsScore: number;
  rimFitScore: number;
  fillScore: number;
  aspectScore: number;
  sizeScore: number;
  centerScore: number;
}

interface CandidateEval {
  ellipse: Ellipse;
  boundary: Point[];
  metrics: CandidateMetrics;
}

type NumericArray = Float32Array | Uint8ClampedArray;

const RING_BOUNDARIES = [0.08, 0.47, 0.54, 0.89, 1.0];
const EDGE_RINGS = [0.47, 0.54, 0.89, 1.0];
const HARMONIC_SEGMENTS = 20;

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function wrapAngle(angleRad: number): number {
  return Math.atan2(Math.sin(angleRad), Math.cos(angleRad));
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.min(sorted.length - 1, lowerIndex + 1);
  const t = position - lowerIndex;
  return sorted[lowerIndex] + (sorted[upperIndex] - sorted[lowerIndex]) * t;
}

function sampleBilinear(data: NumericArray, width: number, height: number, x: number, y: number): number {
  if (width <= 0 || height <= 0) return 0;

  if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) {
    const cx = Math.max(0, Math.min(width - 1, Math.round(x)));
    const cy = Math.max(0, Math.min(height - 1, Math.round(y)));
    return data[cy * width + cx] ?? 0;
  }

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = x - x0;
  const ty = y - y0;

  const i00 = y0 * width + x0;
  const i10 = y0 * width + x1;
  const i01 = y1 * width + x0;
  const i11 = y1 * width + x1;

  const v00 = data[i00] ?? 0;
  const v10 = data[i10] ?? 0;
  const v01 = data[i01] ?? 0;
  const v11 = data[i11] ?? 0;

  const top = v00 + (v10 - v00) * tx;
  const bottom = v01 + (v11 - v01) * tx;
  return top + (bottom - top) * ty;
}

function ellipsePoint(ellipse: Ellipse, normalizedRadius: number, angleRad: number): Point {
  const localX = Math.cos(angleRad) * ellipse.radiusX * normalizedRadius;
  const localY = Math.sin(angleRad) * ellipse.radiusY * normalizedRadius;
  const cosR = Math.cos(ellipse.rotation);
  const sinR = Math.sin(ellipse.rotation);

  return {
    x: ellipse.centerX + localX * cosR - localY * sinR,
    y: ellipse.centerY + localX * sinR + localY * cosR,
  };
}

function ellipseDistance(point: Point, ellipse: Ellipse): number {
  const dx = point.x - ellipse.centerX;
  const dy = point.y - ellipse.centerY;
  const cosR = Math.cos(-ellipse.rotation);
  const sinR = Math.sin(-ellipse.rotation);

  const localX = dx * cosR - dy * sinR;
  const localY = dx * sinR + dy * cosR;

  const nx = localX / Math.max(ellipse.radiusX, 1e-6);
  const ny = localY / Math.max(ellipse.radiusY, 1e-6);
  return Math.sqrt(nx * nx + ny * ny);
}

function sanitizeEllipse(ellipse: Ellipse, width: number, height: number): Ellipse {
  let radiusX = clamp(ellipse.radiusX, 8, Math.min(width, height) * 0.65);
  let radiusY = clamp(ellipse.radiusY, 8, Math.min(width, height) * 0.65);
  let rotation = wrapAngle(ellipse.rotation);

  if (radiusY > radiusX) {
    const temp = radiusX;
    radiusX = radiusY;
    radiusY = temp;
    rotation = wrapAngle(rotation + Math.PI / 2);
  }

  if (radiusY < radiusX * 0.38) {
    radiusY = radiusX * 0.38;
  }

  return {
    centerX: clamp(ellipse.centerX, 0, width - 1),
    centerY: clamp(ellipse.centerY, 0, height - 1),
    radiusX,
    radiusY,
    rotation,
  };
}

function ellipseSimilarity(a: Ellipse, b: Ellipse): number {
  const avgRadius = (a.radiusX + a.radiusY + b.radiusX + b.radiusY) / 4;
  const centerDist = Math.hypot(a.centerX - b.centerX, a.centerY - b.centerY) / Math.max(avgRadius, 1);
  const radiusDiff =
    Math.abs(a.radiusX - b.radiusX) / Math.max(avgRadius, 1) +
    Math.abs(a.radiusY - b.radiusY) / Math.max(avgRadius, 1);
  const rotDiff = Math.abs(Math.atan2(Math.sin(a.rotation - b.rotation), Math.cos(a.rotation - b.rotation)));

  const score = 1 - centerDist * 1.3 - radiusDiff * 0.8 - rotDiff * 0.45;
  return clamp01(score);
}

function dilateBinary(mask: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let on = false;

      for (let ky = -1; ky <= 1 && !on; ky++) {
        const yy = y + ky;
        if (yy < 0 || yy >= height) continue;

        for (let kx = -1; kx <= 1; kx++) {
          const xx = x + kx;
          if (xx < 0 || xx >= width) continue;
          if (mask[yy * width + xx] > 0) {
            on = true;
            break;
          }
        }
      }

      out[y * width + x] = on ? 255 : 0;
    }
  }

  return out;
}

function erodeBinary(mask: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let on = true;

      for (let ky = -1; ky <= 1 && on; ky++) {
        const yy = y + ky;
        if (yy < 0 || yy >= height) {
          on = false;
          break;
        }

        for (let kx = -1; kx <= 1; kx++) {
          const xx = x + kx;
          if (xx < 0 || xx >= width || mask[yy * width + xx] === 0) {
            on = false;
            break;
          }
        }
      }

      out[y * width + x] = on ? 255 : 0;
    }
  }

  return out;
}

function cleanMask(mask: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const closed = erodeBinary(dilateBinary(mask, width, height), width, height);
  return dilateBinary(closed, width, height);
}

function buildFeatureMaps(imageData: ImageData): FeatureMaps {
  const { width, height, data } = imageData;
  const total = width * height;

  const rawLuma = new Float32Array(total);
  const mask = new Uint8ClampedArray(total);
  const colorMask = new Uint8ClampedArray(total);
  const redGreen = new Float32Array(total);
  const colorStrength = new Float32Array(total);

  for (let i = 0; i < data.length; i += 4) {
    const idx = i >> 2;
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;

    rawLuma[idx] = 0.299 * r + 0.587 * g + 0.114 * b;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    let hue = 0;
    if (delta > 1e-6) {
      if (max === r) {
        hue = ((g - b) / delta + (g < b ? 6 : 0)) * 60;
      } else if (max === g) {
        hue = ((b - r) / delta + 2) * 60;
      } else {
        hue = ((r - g) / delta + 4) * 60;
      }
    }

    const sat = max <= 1e-6 ? 0 : delta / max;
    const val = max;

    const redDistance = Math.min(Math.abs(hue), 360 - Math.abs(hue));

    const redScore =
      clamp01(1 - redDistance / 28) *
      clamp01((sat - 0.1) / 0.82) *
      clamp01((val - 0.08) / 0.82);

    const greenScore =
      clamp01(1 - Math.abs(hue - 120) / 40) *
      clamp01((sat - 0.09) / 0.84) *
      clamp01((val - 0.08) / 0.84);

    const darkScore =
      clamp01((0.44 - val) / 0.4) *
      clamp01((0.62 - sat) / 0.62) *
      clamp01((val - 0.02) / 0.18);

    const lightScore =
      clamp01((val - 0.42) / 0.58) *
      clamp01((0.52 - sat) / 0.52);

    const colorScore = Math.max(redScore, greenScore);
    const boardScore = Math.max(redScore * 1.08, greenScore * 1.08, darkScore * 0.62, lightScore * 0.84);

    mask[idx] = boardScore > 0.155 ? 255 : 0;
    colorMask[idx] = colorScore > 0.1 ? 255 : 0;
    redGreen[idx] = redScore - greenScore;
    colorStrength[idx] = colorScore;
  }

  const luminance = new Float32Array(total);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;

      const blurred =
        rawLuma[idx - width - 1] +
        2 * rawLuma[idx - width] +
        rawLuma[idx - width + 1] +
        2 * rawLuma[idx - 1] +
        4 * rawLuma[idx] +
        2 * rawLuma[idx + 1] +
        rawLuma[idx + width - 1] +
        2 * rawLuma[idx + width] +
        rawLuma[idx + width + 1];

      luminance[idx] = blurred / 16;
    }
  }

  for (let x = 0; x < width; x++) {
    luminance[x] = rawLuma[x];
    luminance[(height - 1) * width + x] = rawLuma[(height - 1) * width + x];
  }
  for (let y = 0; y < height; y++) {
    luminance[y * width] = rawLuma[y * width];
    luminance[y * width + (width - 1)] = rawLuma[y * width + (width - 1)];
  }

  const edge = new Float32Array(total);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;

      const gx =
        -luminance[idx - width - 1] -
        2 * luminance[idx - 1] -
        luminance[idx + width - 1] +
        luminance[idx - width + 1] +
        2 * luminance[idx + 1] +
        luminance[idx + width + 1];

      const gy =
        -luminance[idx - width - 1] -
        2 * luminance[idx - width] -
        luminance[idx - width + 1] +
        luminance[idx + width - 1] +
        2 * luminance[idx + width] +
        luminance[idx + width + 1];

      const magnitude = Math.sqrt(gx * gx + gy * gy);
      edge[idx] = clamp01(magnitude * 1.35);
    }
  }

  return {
    mask,
    colorMask,
    redGreen,
    colorStrength,
    luminance,
    edge,
  };
}

function findTopBlobs(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  minArea: number,
  maxArea: number,
  limit: number,
): Blob[] {
  const visited = new Uint8Array(width * height);
  const blobs: Blob[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (mask[idx] === 0 || visited[idx] !== 0) continue;

      const stackX: number[] = [x];
      const stackY: number[] = [y];
      visited[idx] = 1;

      let area = 0;
      let sumX = 0;
      let sumY = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;

      while (stackX.length > 0) {
        const cx = stackX.pop() as number;
        const cy = stackY.pop() as number;

        area += 1;
        sumX += cx;
        sumY += cy;

        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        for (let ny = cy - 1; ny <= cy + 1; ny++) {
          if (ny < 0 || ny >= height) continue;

          for (let nx = cx - 1; nx <= cx + 1; nx++) {
            if (nx < 0 || nx >= width) continue;
            if (nx === cx && ny === cy) continue;

            const nIdx = ny * width + nx;
            if (mask[nIdx] === 0 || visited[nIdx] !== 0) continue;

            visited[nIdx] = 1;
            stackX.push(nx);
            stackY.push(ny);
          }
        }
      }

      if (area >= minArea && area <= maxArea) {
        blobs.push({
          area,
          boundingBox: {
            x: minX,
            y: minY,
            width: Math.max(1, maxX - minX + 1),
            height: Math.max(1, maxY - minY + 1),
          },
          centroid: {
            x: sumX / area,
            y: sumY / area,
          },
        });
      }
    }
  }

  blobs.sort((a, b) => b.area - a.area);
  return blobs.slice(0, limit);
}

function sampleBoundaryFromBlob(
  mask: Uint8ClampedArray,
  edge: Float32Array,
  width: number,
  height: number,
  blob: Blob,
): Point[] {
  const points: Point[] = [];
  const centerX = blob.centroid.x;
  const centerY = blob.centroid.y;
  const maxRadius = Math.min(
    Math.hypot(blob.boundingBox.width, blob.boundingBox.height) * 0.85,
    Math.min(width, height) * 0.65,
  );

  for (let degree = 0; degree < 360; degree += 3) {
    const angle = (degree * Math.PI) / 180;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);

    let entered = false;
    let exitRadius = -1;
    let wasInside = false;

    for (let radius = 2; radius <= maxRadius; radius += 1) {
      const x = Math.round(centerX + dx * radius);
      const y = Math.round(centerY + dy * radius);
      if (x < 0 || x >= width || y < 0 || y >= height) break;

      const inside = mask[y * width + x] > 0;
      if (inside) entered = true;

      if (entered && wasInside && !inside) {
        exitRadius = radius - 1;
        break;
      }

      wasInside = inside;
    }

    if (exitRadius < 0) {
      if (!entered) continue;
      exitRadius = maxRadius;
    }

    let bestRadius = exitRadius;
    let bestScore = -Infinity;

    const start = Math.max(4, exitRadius - 7);
    const end = Math.min(maxRadius, exitRadius + 7);

    for (let rr = start; rr <= end; rr += 1) {
      const x = Math.round(centerX + dx * rr);
      const y = Math.round(centerY + dy * rr);
      const inX = Math.round(centerX + dx * Math.max(1, rr - 2));
      const inY = Math.round(centerY + dy * Math.max(1, rr - 2));
      const outX = Math.round(centerX + dx * Math.min(maxRadius, rr + 2));
      const outY = Math.round(centerY + dy * Math.min(maxRadius, rr + 2));

      if (
        x < 0 || x >= width || y < 0 || y >= height ||
        inX < 0 || inX >= width || inY < 0 || inY >= height ||
        outX < 0 || outX >= width || outY < 0 || outY >= height
      ) {
        continue;
      }

      const edgeValue = edge[y * width + x];
      const transition = (mask[inY * width + inX] > 0 ? 1 : 0) - (mask[outY * width + outX] > 0 ? 1 : 0);
      const score = edgeValue * 1.2 + transition * 0.8;

      if (score > bestScore) {
        bestScore = score;
        bestRadius = rr;
      }
    }

    points.push({
      x: centerX + dx * bestRadius,
      y: centerY + dy * bestRadius,
    });
  }

  return points;
}

function sampleBoundaryAroundEllipse(
  mask: Uint8ClampedArray,
  edge: Float32Array,
  width: number,
  height: number,
  ellipse: Ellipse,
): Point[] {
  const points: Point[] = [];

  for (let degree = 0; degree < 360; degree += 4) {
    const angle = (degree * Math.PI) / 180;

    let bestScale = 1;
    let bestScore = -Infinity;

    for (let scale = 0.82; scale <= 1.2; scale += 0.03) {
      const p = ellipsePoint(ellipse, scale, angle);
      const inside = ellipsePoint(ellipse, Math.max(0, scale - 0.04), angle);
      const outside = ellipsePoint(ellipse, Math.min(1.25, scale + 0.04), angle);

      const edgeValue = sampleBilinear(edge, width, height, p.x, p.y);
      const insideValue = sampleBilinear(mask, width, height, inside.x, inside.y) / 255;
      const outsideValue = sampleBilinear(mask, width, height, outside.x, outside.y) / 255;
      const transition = insideValue - outsideValue;

      const score = edgeValue * 1.25 + transition * 0.9 - Math.abs(scale - 1) * 0.2;
      if (score > bestScore) {
        bestScore = score;
        bestScale = scale;
      }
    }

    points.push(ellipsePoint(ellipse, bestScale, angle));
  }

  return points;
}

function fitEllipse(points: Point[]): Ellipse | null {
  if (points.length < 24) return null;

  let sumX = 0;
  let sumY = 0;
  for (const point of points) {
    sumX += point.x;
    sumY += point.y;
  }

  const centerX = sumX / points.length;
  const centerY = sumY / points.length;

  let covXX = 0;
  let covXY = 0;
  let covYY = 0;

  for (const point of points) {
    const dx = point.x - centerX;
    const dy = point.y - centerY;
    covXX += dx * dx;
    covXY += dx * dy;
    covYY += dy * dy;
  }

  covXX /= points.length;
  covXY /= points.length;
  covYY /= points.length;

  let rotation = 0.5 * Math.atan2(2 * covXY, covXX - covYY);
  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);

  const absU: number[] = [];
  const absV: number[] = [];
  let sumU2 = 0;
  let sumV2 = 0;

  for (const point of points) {
    const dx = point.x - centerX;
    const dy = point.y - centerY;
    const u = dx * cosR + dy * sinR;
    const v = -dx * sinR + dy * cosR;

    absU.push(Math.abs(u));
    absV.push(Math.abs(v));
    sumU2 += u * u;
    sumV2 += v * v;
  }

  const radiusVarianceU = Math.sqrt(Math.max((sumU2 / points.length) * 2, 1));
  const radiusVarianceV = Math.sqrt(Math.max((sumV2 / points.length) * 2, 1));
  const radiusQuantileU = quantile(absU, 0.88) * 1.04;
  const radiusQuantileV = quantile(absV, 0.88) * 1.04;

  let radiusX = radiusQuantileU * 0.7 + radiusVarianceU * 0.3;
  let radiusY = radiusQuantileV * 0.7 + radiusVarianceV * 0.3;

  if (!Number.isFinite(radiusX) || !Number.isFinite(radiusY)) return null;

  if (radiusY > radiusX) {
    const temp = radiusX;
    radiusX = radiusY;
    radiusY = temp;
    rotation += Math.PI / 2;
  }

  if (radiusX < 8 || radiusY < 8) return null;

  return {
    centerX,
    centerY,
    radiusX,
    radiusY,
    rotation: wrapAngle(rotation),
  };
}

function computeRimFitScore(boundary: Point[], ellipse: Ellipse): number {
  if (boundary.length === 0) return 0;

  let sumError = 0;
  let sumSqError = 0;

  for (const point of boundary) {
    const distance = ellipseDistance(point, ellipse);
    const error = Math.abs(distance - 1);
    sumError += error;
    sumSqError += error * error;
  }

  const mean = sumError / boundary.length;
  const variance = Math.max(0, sumSqError / boundary.length - mean * mean);
  const stdDev = Math.sqrt(variance);

  return clamp01(1 - mean * 2.8 - stdDev * 1.8);
}

function computeEdgeScore(edge: Float32Array, width: number, height: number, ellipse: Ellipse): number {
  const weights = [0.2, 0.24, 0.22, 0.34];
  let weightedScore = 0;

  for (let ringIndex = 0; ringIndex < EDGE_RINGS.length; ringIndex++) {
    const radius = EDGE_RINGS[ringIndex];
    let sum = 0;
    let strongCount = 0;
    let sampleCount = 0;

    for (let degree = 0; degree < 360; degree += 4) {
      const angle = (degree * Math.PI) / 180;
      const point = ellipsePoint(ellipse, radius, angle);
      const edgeValue = sampleBilinear(edge, width, height, point.x, point.y);
      sum += edgeValue;
      if (edgeValue > 0.12) strongCount += 1;
      sampleCount += 1;
    }

    if (sampleCount === 0) continue;

    const avg = sum / sampleCount;
    const continuity = strongCount / sampleCount;
    const ringScore = clamp01((avg - 0.05) / 0.25) * 0.6 + continuity * 0.4;

    weightedScore += ringScore * weights[ringIndex];
  }

  return clamp01(weightedScore);
}

function computeRingScore(luminance: Float32Array, width: number, height: number, ellipse: Ellipse): number {
  let contrastSum = 0;
  let count = 0;

  for (let degree = 0; degree < 360; degree += 6) {
    const angle = (degree * Math.PI) / 180;

    for (const boundary of RING_BOUNDARIES) {
      const innerPoint = ellipsePoint(ellipse, Math.max(0, boundary - 0.02), angle);
      const outerPoint = ellipsePoint(ellipse, Math.min(1.1, boundary + 0.02), angle);

      const innerLuma = sampleBilinear(luminance, width, height, innerPoint.x, innerPoint.y);
      const outerLuma = sampleBilinear(luminance, width, height, outerPoint.x, outerPoint.y);
      contrastSum += Math.abs(outerLuma - innerLuma);
      count += 1;
    }
  }

  if (count === 0) return 0;
  const avgContrast = contrastSum / count;
  return clamp01((avgContrast - 0.015) / 0.09);
}

function computePatternScore(redGreen: Float32Array, width: number, height: number, ellipse: Ellipse): number {
  let harmonicCos = 0;
  let harmonicSin = 0;
  let signalMagnitude = 0;

  for (let degree = 0; degree < 360; degree += 3) {
    const angle = (degree * Math.PI) / 180;

    const triplePoint = ellipsePoint(ellipse, 0.505, angle);
    const doublePoint = ellipsePoint(ellipse, 0.945, angle);

    const tripleSignal = sampleBilinear(redGreen, width, height, triplePoint.x, triplePoint.y);
    const doubleSignal = sampleBilinear(redGreen, width, height, doublePoint.x, doublePoint.y);

    const signal = tripleSignal * 0.68 + doubleSignal * 0.32;

    const harmonicAngle = angle * HARMONIC_SEGMENTS;
    harmonicCos += signal * Math.cos(harmonicAngle);
    harmonicSin += signal * Math.sin(harmonicAngle);
    signalMagnitude += Math.abs(signal);
  }

  if (signalMagnitude < 1e-5) return 0;

  const amplitude = Math.sqrt(harmonicCos * harmonicCos + harmonicSin * harmonicSin) / signalMagnitude;
  return clamp01((amplitude - 0.045) / 0.28);
}

function computeColorCoverageScore(
  colorStrength: Float32Array,
  width: number,
  height: number,
  ellipse: Ellipse,
): number {
  const rings = [0.505, 0.945];
  let present = 0;
  let count = 0;

  for (const radius of rings) {
    for (let degree = 0; degree < 360; degree += 3) {
      const angle = (degree * Math.PI) / 180;
      const point = ellipsePoint(ellipse, radius, angle);
      const value = sampleBilinear(colorStrength, width, height, point.x, point.y);
      if (value > 0.085) {
        present += 1;
      }
      count += 1;
    }
  }

  if (count === 0) return 0;
  const ratio = present / count;
  return clamp01((ratio - 0.16) / 0.52);
}

function computeColorAlternationScore(
  redGreen: Float32Array,
  colorStrength: Float32Array,
  width: number,
  height: number,
  ellipse: Ellipse,
): number {
  const rings = [0.505, 0.945];
  let total = 0;

  for (const radius of rings) {
    const segments = new Array<number>(20).fill(0);
    const segmentWeights = new Array<number>(20).fill(0);

    for (let degree = 0; degree < 360; degree += 1.5) {
      const angle = (degree * Math.PI) / 180;
      const point = ellipsePoint(ellipse, radius, angle);
      const rg = sampleBilinear(redGreen, width, height, point.x, point.y);
      const strength = sampleBilinear(colorStrength, width, height, point.x, point.y);

      const segment = Math.floor(((degree + 9) % 360) / 18);
      segments[segment] += rg * (0.4 + strength * 0.9);
      segmentWeights[segment] += 1;
    }

    for (let i = 0; i < 20; i++) {
      if (segmentWeights[i] > 0) {
        segments[i] /= segmentWeights[i];
      }
    }

    let adjacency = 0;
    let magnitude = 0;
    let transitions = 0;

    for (let i = 0; i < 20; i++) {
      const current = segments[i];
      const next = segments[(i + 1) % 20];
      adjacency += Math.abs(current - next);
      magnitude += Math.abs(current);
      if (current * next < 0) {
        transitions += 1;
      }
    }

    if (magnitude < 1e-5) continue;

    const adjacencyRatio = adjacency / (magnitude + 1e-6);
    const transitionRatio = transitions / 20;

    const localScore =
      clamp01((adjacencyRatio - 1.2) / 2.2) * 0.65 +
      clamp01((transitionRatio - 0.35) / 0.5) * 0.35;

    total += localScore;
  }

  return clamp01(total / rings.length);
}

function computeScoringRingsScore(
  colorStrength: Float32Array,
  width: number,
  height: number,
  ellipse: Ellipse,
): number {
  let triplePeakSum = 0;
  let tripleInnerSum = 0;
  let tripleOuterSum = 0;
  let doublePeakSum = 0;
  let doubleInnerSum = 0;
  let doubleOuterSum = 0;
  let triplePresent = 0;
  let doublePresent = 0;
  let count = 0;

  for (let degree = 0; degree < 360; degree += 3) {
    const angle = (degree * Math.PI) / 180;

    const triplePeakPoint = ellipsePoint(ellipse, 0.505, angle);
    const tripleInnerPoint = ellipsePoint(ellipse, 0.44, angle);
    const tripleOuterPoint = ellipsePoint(ellipse, 0.57, angle);
    const doublePeakPoint = ellipsePoint(ellipse, 0.945, angle);
    const doubleInnerPoint = ellipsePoint(ellipse, 0.86, angle);
    const doubleOuterPoint = ellipsePoint(ellipse, 1.03, angle);

    const triplePeak = sampleBilinear(colorStrength, width, height, triplePeakPoint.x, triplePeakPoint.y);
    const tripleInner = sampleBilinear(colorStrength, width, height, tripleInnerPoint.x, tripleInnerPoint.y);
    const tripleOuter = sampleBilinear(colorStrength, width, height, tripleOuterPoint.x, tripleOuterPoint.y);
    const doublePeak = sampleBilinear(colorStrength, width, height, doublePeakPoint.x, doublePeakPoint.y);
    const doubleInner = sampleBilinear(colorStrength, width, height, doubleInnerPoint.x, doubleInnerPoint.y);
    const doubleOuter = sampleBilinear(colorStrength, width, height, doubleOuterPoint.x, doubleOuterPoint.y);

    triplePeakSum += triplePeak;
    tripleInnerSum += tripleInner;
    tripleOuterSum += tripleOuter;
    doublePeakSum += doublePeak;
    doubleInnerSum += doubleInner;
    doubleOuterSum += doubleOuter;

    if (triplePeak > 0.08) triplePresent += 1;
    if (doublePeak > 0.08) doublePresent += 1;

    count += 1;
  }

  if (count === 0) return 0;

  const invCount = 1 / count;

  const triplePeakAvg = triplePeakSum * invCount;
  const tripleInnerAvg = tripleInnerSum * invCount;
  const tripleOuterAvg = tripleOuterSum * invCount;
  const doublePeakAvg = doublePeakSum * invCount;
  const doubleInnerAvg = doubleInnerSum * invCount;
  const doubleOuterAvg = doubleOuterSum * invCount;

  const tripleContrast = triplePeakAvg - (tripleInnerAvg + tripleOuterAvg) * 0.5;
  const doubleContrast = doublePeakAvg - (doubleInnerAvg + doubleOuterAvg) * 0.5;

  const tripleContinuity = triplePresent * invCount;
  const doubleContinuity = doublePresent * invCount;

  const tripleScore =
    clamp01((tripleContrast - 0.012) / 0.12) * 0.66 +
    clamp01((tripleContinuity - 0.34) / 0.56) * 0.34;

  const doubleScore =
    clamp01((doubleContrast - 0.014) / 0.12) * 0.68 +
    clamp01((doubleContinuity - 0.3) / 0.62) * 0.32;

  const peakBalance = clamp01(1 - Math.abs(doublePeakAvg - triplePeakAvg) / 0.2);
  const pairPresence = clamp01((Math.min(tripleContinuity, doubleContinuity) - 0.24) / 0.5);

  const outsideLeak = clamp01((doubleOuterAvg - 0.12) / 0.28);
  const leakPenalty = 1 - outsideLeak * 0.42;

  return clamp01((tripleScore * 0.38 + doubleScore * 0.46 + peakBalance * 0.08 + pairPresence * 0.08) * leakPenalty);
}

function computeFillScore(mask: Uint8ClampedArray, width: number, height: number, ellipse: Ellipse): number {
  const minX = Math.max(0, Math.floor(ellipse.centerX - ellipse.radiusX));
  const maxX = Math.min(width - 1, Math.ceil(ellipse.centerX + ellipse.radiusX));
  const minY = Math.max(0, Math.floor(ellipse.centerY - ellipse.radiusY));
  const maxY = Math.min(height - 1, Math.ceil(ellipse.centerY + ellipse.radiusY));

  let insideCount = 0;
  let filledCount = 0;

  for (let y = minY; y <= maxY; y += 3) {
    for (let x = minX; x <= maxX; x += 3) {
      if (ellipseDistance({ x, y }, ellipse) > 0.98) continue;
      insideCount += 1;
      if (mask[y * width + x] > 0) filledCount += 1;
    }
  }

  if (insideCount === 0) return 0;
  const ratio = filledCount / insideCount;
  return clamp01(1 - Math.abs(ratio - 0.58) / 0.5);
}

function scoreEllipse(
  ellipse: Ellipse,
  boundary: Point[],
  maps: FeatureMaps,
  width: number,
  height: number,
): CandidateMetrics {
  const rimFitScore = computeRimFitScore(boundary, ellipse);
  const edgeScore = computeEdgeScore(maps.edge, width, height, ellipse);
  const ringScore = computeRingScore(maps.luminance, width, height, ellipse);
  const patternScore = computePatternScore(maps.redGreen, width, height, ellipse);
  const colorCoverageScore = computeColorCoverageScore(maps.colorStrength, width, height, ellipse);
  const colorAlternationScore = computeColorAlternationScore(
    maps.redGreen,
    maps.colorStrength,
    width,
    height,
    ellipse,
  );
  const scoringRingsScore = computeScoringRingsScore(maps.colorStrength, width, height, ellipse);
  const fillScore = computeFillScore(maps.mask, width, height, ellipse);

  const aspectRatio = Math.min(ellipse.radiusX, ellipse.radiusY) / Math.max(ellipse.radiusX, ellipse.radiusY);
  const aspectScore = clamp01((aspectRatio - 0.42) / 0.5);

  const avgRadius = (ellipse.radiusX + ellipse.radiusY) * 0.5;
  const relativeSize = avgRadius / Math.max(1, Math.min(width, height));
  const sizeScore = clamp01(1 - Math.abs(relativeSize - 0.31) / 0.28);

  const centerDistance =
    Math.hypot(ellipse.centerX - width * 0.5, ellipse.centerY - height * 0.5) /
    Math.max(1, Math.min(width, height));
  const centerScore = clamp01(1 - centerDistance / 0.48);

  let quality01 =
    rimFitScore * 0.19 +
    edgeScore * 0.18 +
    ringScore * 0.14 +
    patternScore * 0.09 +
    colorCoverageScore * 0.13 +
    colorAlternationScore * 0.1 +
    scoringRingsScore * 0.15 +
    fillScore * 0.01 +
    aspectScore * 0.005 +
    sizeScore * 0.005;

  if (rimFitScore < 0.1) quality01 *= 0.55;
  if (edgeScore < 0.07) quality01 *= 0.56;
  if (ringScore < 0.05 && patternScore < 0.05 && colorAlternationScore < 0.05) quality01 *= 0.72;
  if (colorCoverageScore < 0.04 && scoringRingsScore < 0.18) quality01 *= 0.74;
  if (scoringRingsScore < 0.13) quality01 *= 0.72;
  if (aspectScore < 0.14) quality01 *= 0.7;
  if (sizeScore < 0.1) quality01 *= 0.7;

  quality01 += centerScore * 0.01;

  return {
    quality01: clamp01(quality01),
    patternScore,
    edgeScore,
    ringScore,
    colorCoverageScore,
    colorAlternationScore,
    scoringRingsScore,
    rimFitScore,
    fillScore,
    aspectScore,
    sizeScore,
    centerScore,
  };
}

function evaluateEllipse(ellipse: Ellipse, maps: FeatureMaps, width: number, height: number): CandidateEval {
  const sanitized = sanitizeEllipse(ellipse, width, height);
  const boundary = sampleBoundaryAroundEllipse(maps.mask, maps.edge, width, height, sanitized);
  const metrics = scoreEllipse(sanitized, boundary, maps, width, height);

  return {
    ellipse: sanitized,
    boundary,
    metrics,
  };
}

function optimizeEllipse(seed: Ellipse, maps: FeatureMaps, width: number, height: number): CandidateEval {
  let best = evaluateEllipse(seed, maps, width, height);

  let stepCenter = Math.max(2, ((best.ellipse.radiusX + best.ellipse.radiusY) * 0.5) * 0.12);
  let stepRadius = Math.max(2, ((best.ellipse.radiusX + best.ellipse.radiusY) * 0.5) * 0.12);
  let stepRotation = 0.12;

  for (let iteration = 0; iteration < 5; iteration++) {
    let improved = false;

    const proposals: Ellipse[] = [
      { ...best.ellipse, centerX: best.ellipse.centerX - stepCenter },
      { ...best.ellipse, centerX: best.ellipse.centerX + stepCenter },
      { ...best.ellipse, centerY: best.ellipse.centerY - stepCenter },
      { ...best.ellipse, centerY: best.ellipse.centerY + stepCenter },
      { ...best.ellipse, radiusX: best.ellipse.radiusX - stepRadius },
      { ...best.ellipse, radiusX: best.ellipse.radiusX + stepRadius },
      { ...best.ellipse, radiusY: best.ellipse.radiusY - stepRadius },
      { ...best.ellipse, radiusY: best.ellipse.radiusY + stepRadius },
      { ...best.ellipse, rotation: best.ellipse.rotation - stepRotation },
      { ...best.ellipse, rotation: best.ellipse.rotation + stepRotation },
    ];

    for (const proposal of proposals) {
      const evalCandidate = evaluateEllipse(proposal, maps, width, height);
      if (evalCandidate.metrics.quality01 > best.metrics.quality01 + 0.0015) {
        best = evalCandidate;
        improved = true;
      }
    }

    if (!improved) {
      stepCenter *= 0.62;
      stepRadius *= 0.62;
      stepRotation *= 0.62;
    } else {
      stepCenter *= 0.72;
      stepRadius *= 0.72;
      stepRotation *= 0.72;
    }
  }

  return best;
}

function estimateEdgeSeed(edge: Float32Array, width: number, height: number): Ellipse | null {
  let sumW = 0;
  let sumX = 0;
  let sumY = 0;

  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const value = edge[y * width + x];
      if (value < 0.14) continue;

      const weight = value - 0.14;
      sumW += weight;
      sumX += x * weight;
      sumY += y * weight;
    }
  }

  if (sumW < 12) return null;

  const centerX = sumX / sumW;
  const centerY = sumY / sumW;
  const distances: number[] = [];

  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const value = edge[y * width + x];
      if (value < 0.2) continue;

      distances.push(Math.hypot(x - centerX, y - centerY));
    }
  }

  if (distances.length < 40) return null;

  const radius = quantile(distances, 0.84);
  if (!Number.isFinite(radius) || radius < Math.min(width, height) * 0.08) return null;

  return {
    centerX,
    centerY,
    radiusX: radius,
    radiusY: radius,
    rotation: 0,
  };
}

function addSeedIfDistinct(seeds: CandidateSeed[], seed: CandidateSeed): void {
  for (const existing of seeds) {
    const similarity = ellipseSimilarity(existing.ellipse, seed.ellipse);
    if (similarity > 0.78) {
      return;
    }
  }

  seeds.push(seed);
}

function generateSeeds(
  maps: FeatureMaps,
  width: number,
  height: number,
  previousEllipse?: Ellipse | null,
): CandidateSeed[] {
  const seeds: CandidateSeed[] = [];
  const frameArea = width * height;
  const minBlobArea = Math.floor(frameArea * 0.01);
  const colorMinBlobArea = Math.floor(frameArea * 0.0025);
  const maxBlobArea = Math.floor(frameArea * 0.8);

  if (previousEllipse) {
    addSeedIfDistinct(seeds, {
      ellipse: sanitizeEllipse(previousEllipse, width, height),
      source: 'previous',
    });
  }

  const addSeedsFromBlobs = (blobMask: Uint8ClampedArray, localMinBlobArea: number, maxCount: number) => {
    const blobs = findTopBlobs(blobMask, width, height, localMinBlobArea, maxBlobArea, maxCount);

    for (const blob of blobs) {
      const boundary = sampleBoundaryFromBlob(blobMask, maps.edge, width, height, blob);
      if (boundary.length >= 24) {
        const fitted = fitEllipse(boundary);
        if (fitted) {
          addSeedIfDistinct(seeds, {
            ellipse: sanitizeEllipse(fitted, width, height),
            source: 'blob',
          });
        }
      }

      const ellipseFromBox: Ellipse = {
        centerX: blob.centroid.x,
        centerY: blob.centroid.y,
        radiusX: blob.boundingBox.width * 0.52,
        radiusY: blob.boundingBox.height * 0.52,
        rotation: 0,
      };

      addSeedIfDistinct(seeds, {
        ellipse: sanitizeEllipse(ellipseFromBox, width, height),
        source: 'blob',
      });
    }
  };

  addSeedsFromBlobs(maps.mask, minBlobArea, 8);
  addSeedsFromBlobs(maps.colorMask, colorMinBlobArea, 10);

  const edgeSeed = estimateEdgeSeed(maps.edge, width, height);
  if (edgeSeed) {
    addSeedIfDistinct(seeds, {
      ellipse: sanitizeEllipse(edgeSeed, width, height),
      source: 'edge',
    });
  }

  const base = Math.min(width, height);
  const radiusFactors = [0.22, 0.28, 0.34, 0.4];
  for (const factor of radiusFactors) {
    addSeedIfDistinct(seeds, {
      ellipse: {
        centerX: width * 0.5,
        centerY: height * 0.5,
        radiusX: base * factor,
        radiusY: base * factor,
        rotation: 0,
      },
      source: 'center',
    });
  }

  const centerOffsets: Array<[number, number]> = [
    [-0.09, 0],
    [0.09, 0],
    [0, -0.09],
    [0, 0.09],
  ];

  for (const [ox, oy] of centerOffsets) {
    addSeedIfDistinct(seeds, {
      ellipse: {
        centerX: width * (0.5 + ox),
        centerY: height * (0.5 + oy),
        radiusX: base * 0.31,
        radiusY: base * 0.31,
        rotation: 0,
      },
      source: 'center',
    });
  }

  return seeds.slice(0, 18);
}

export function detectDartboardEllipse(
  imageData: ImageData,
  previousEllipse?: Ellipse | null,
): DartboardDetectionResult | null {
  const { width, height } = imageData;
  const area = width * height;
  if (area < 160 * 120) return null;

  const maps = buildFeatureMaps(imageData);
  maps.mask = cleanMask(maps.mask, width, height);
  maps.colorMask = cleanMask(maps.colorMask, width, height);

  for (let i = 0; i < maps.mask.length; i++) {
    if (maps.colorMask[i] > 0) {
      maps.mask[i] = 255;
    }
  }

  const seeds = generateSeeds(maps, width, height, previousEllipse);
  if (seeds.length === 0) return null;

  let best: CandidateEval | null = null;
  let bestSource: CandidateSeed['source'] = 'center';

  for (const seed of seeds) {
    const optimized = optimizeEllipse(seed.ellipse, maps, width, height);

    if (!best || optimized.metrics.quality01 > best.metrics.quality01) {
      best = optimized;
      bestSource = seed.source;
    }
  }

  if (!best) return null;

  let quality01 = best.metrics.quality01;

  if (bestSource === 'previous') {
    quality01 += 0.03;
  }

  if (previousEllipse) {
    quality01 += ellipseSimilarity(best.ellipse, previousEllipse) * 0.05;
  }

  quality01 = clamp01(quality01);
  const quality = Math.round(quality01 * 100);

  if (quality < 24) {
    return null;
  }

  return {
    ellipse: best.ellipse,
    quality,
    patternScore: best.metrics.patternScore,
    edgeScore: best.metrics.edgeScore,
    ringScore: best.metrics.ringScore,
    fieldScore: best.metrics.scoringRingsScore,
  };
}
