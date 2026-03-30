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
}

interface Blob {
  area: number;
  boundingBox: { x: number; y: number; width: number; height: number };
  centroid: Point;
}

interface FeatureMaps {
  mask: Uint8ClampedArray;
  redGreen: Float32Array;
  luminance: Float32Array;
  edge: Float32Array;
}

type NumericArray = Float32Array | Uint8ClampedArray;

const RING_BOUNDARIES = [0.08, 0.47, 0.54, 0.89, 1.0];
const HARMONIC_SEGMENTS = 20;

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;

  const current = sorted[base] ?? sorted[sorted.length - 1];
  const next = sorted[base + 1] ?? current;
  return current + (next - current) * rest;
}

function sampleBilinear(data: NumericArray, width: number, height: number, x: number, y: number): number {
  if (width <= 0 || height <= 0) return 0;

  if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) {
    const clampedX = Math.max(0, Math.min(width - 1, Math.round(x)));
    const clampedY = Math.max(0, Math.min(height - 1, Math.round(y)));
    return data[clampedY * width + clampedX] ?? 0;
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

function buildFeatureMaps(imageData: ImageData): FeatureMaps {
  const { width, height, data } = imageData;
  const total = width * height;

  const mask = new Uint8ClampedArray(total);
  const redGreen = new Float32Array(total);
  const luminance = new Float32Array(total);

  for (let i = 0; i < data.length; i += 4) {
    const index = i >> 2;
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;

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

    const saturation = max <= 1e-6 ? 0 : delta / max;
    const value = max;

    const redHueDistance = Math.min(Math.abs(hue), 360 - Math.abs(hue));

    const redScore =
      clamp01(1 - redHueDistance / 24) *
      clamp01((saturation - 0.12) / 0.72) *
      clamp01((value - 0.12) / 0.72);

    const greenScore =
      clamp01(1 - Math.abs(hue - 120) / 32) *
      clamp01((saturation - 0.1) / 0.76) *
      clamp01((value - 0.1) / 0.78);

    const darkScore =
      clamp01((0.42 - value) / 0.42) *
      clamp01((0.62 - saturation) / 0.62);

    const lightScore =
      clamp01((value - 0.46) / 0.54) *
      clamp01((0.45 - saturation) / 0.45);

    const boardLikelihood = Math.max(redScore, greenScore, darkScore * 0.9, lightScore * 0.9);

    mask[index] = boardLikelihood > 0.3 ? 255 : 0;
    redGreen[index] = redScore - greenScore;
    luminance[index] = 0.299 * r + 0.587 * g + 0.114 * b;
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
      edge[idx] = clamp01(magnitude * 1.1);
    }
  }

  return { mask, redGreen, luminance, edge };
}

function dilateBinary(mask: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let hasNeighbor = false;

      for (let ky = -1; ky <= 1 && !hasNeighbor; ky++) {
        const ny = y + ky;
        if (ny < 0 || ny >= height) continue;

        for (let kx = -1; kx <= 1; kx++) {
          const nx = x + kx;
          if (nx < 0 || nx >= width) continue;

          if (mask[ny * width + nx] > 0) {
            hasNeighbor = true;
            break;
          }
        }
      }

      out[y * width + x] = hasNeighbor ? 255 : 0;
    }
  }

  return out;
}

function erodeBinary(mask: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let allNeighbors = true;

      for (let ky = -1; ky <= 1 && allNeighbors; ky++) {
        const ny = y + ky;
        if (ny < 0 || ny >= height) {
          allNeighbors = false;
          break;
        }

        for (let kx = -1; kx <= 1; kx++) {
          const nx = x + kx;
          if (nx < 0 || nx >= width || mask[ny * width + nx] === 0) {
            allNeighbors = false;
            break;
          }
        }
      }

      out[y * width + x] = allNeighbors ? 255 : 0;
    }
  }

  return out;
}

function closeAndOpenMask(mask: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const closed = erodeBinary(dilateBinary(mask, width, height), width, height);
  return dilateBinary(erodeBinary(closed, width, height), width, height);
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
      const startIdx = y * width + x;
      if (mask[startIdx] === 0 || visited[startIdx] !== 0) continue;

      const stackX: number[] = [x];
      const stackY: number[] = [y];
      visited[startIdx] = 1;

      let area = 0;
      let sumX = 0;
      let sumY = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;

      while (stackX.length > 0) {
        const currentX = stackX.pop() as number;
        const currentY = stackY.pop() as number;

        area += 1;
        sumX += currentX;
        sumY += currentY;

        if (currentX < minX) minX = currentX;
        if (currentX > maxX) maxX = currentX;
        if (currentY < minY) minY = currentY;
        if (currentY > maxY) maxY = currentY;

        for (let ny = currentY - 1; ny <= currentY + 1; ny++) {
          if (ny < 0 || ny >= height) continue;

          for (let nx = currentX - 1; nx <= currentX + 1; nx++) {
            if (nx < 0 || nx >= width) continue;
            if (nx === currentX && ny === currentY) continue;

            const neighborIdx = ny * width + nx;
            if (mask[neighborIdx] === 0 || visited[neighborIdx] !== 0) continue;

            visited[neighborIdx] = 1;
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

function extractBoundaryPoints(mask: Uint8ClampedArray, edge: Float32Array, width: number, height: number, blob: Blob): Point[] {
  const points: Point[] = [];
  const centerX = blob.centroid.x;
  const centerY = blob.centroid.y;
  const maxRadius = Math.min(
    Math.hypot(blob.boundingBox.width, blob.boundingBox.height) * 0.72,
    Math.min(width, height) * 0.58,
  );

  for (let degree = 0; degree < 360; degree += 4) {
    const angle = (degree * Math.PI) / 180;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);

    let firstInside = -1;
    let lastInside = -1;

    for (let radius = 1; radius <= maxRadius; radius += 1) {
      const x = Math.round(centerX + dx * radius);
      const y = Math.round(centerY + dy * radius);

      if (x < 0 || x >= width || y < 0 || y >= height) break;

      const isInside = mask[y * width + x] > 0;

      if (isInside) {
        if (firstInside < 0) firstInside = radius;
        lastInside = radius;
      } else if (firstInside >= 0) {
        break;
      }
    }

    if (lastInside < 8) continue;

    let bestRadius = lastInside;
    let bestEdge = -1;
    const startSearch = Math.max(1, lastInside - 3);
    const endSearch = Math.min(maxRadius, lastInside + 3);

    for (let rr = startSearch; rr <= endSearch; rr += 1) {
      const x = Math.round(centerX + dx * rr);
      const y = Math.round(centerY + dy * rr);

      if (x < 0 || x >= width || y < 0 || y >= height) continue;

      const edgeStrength = edge[y * width + x];
      if (edgeStrength > bestEdge) {
        bestEdge = edgeStrength;
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

  let xx = 0;
  let xy = 0;
  let yy = 0;

  for (const point of points) {
    const dx = point.x - centerX;
    const dy = point.y - centerY;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }

  xx /= points.length;
  xy /= points.length;
  yy /= points.length;

  let rotation = 0.5 * Math.atan2(2 * xy, xx - yy);
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

  const radiusFromVarianceU = Math.sqrt(Math.max((sumU2 / points.length) * 2, 1));
  const radiusFromVarianceV = Math.sqrt(Math.max((sumV2 / points.length) * 2, 1));

  const radiusFromQuantileU = quantile(absU, 0.9) * 1.02;
  const radiusFromQuantileV = quantile(absV, 0.9) * 1.02;

  let radiusX = (radiusFromVarianceU + radiusFromQuantileU) * 0.5;
  let radiusY = (radiusFromVarianceV + radiusFromQuantileV) * 0.5;

  if (!Number.isFinite(radiusX) || !Number.isFinite(radiusY)) return null;

  if (radiusY > radiusX) {
    const temp = radiusX;
    radiusX = radiusY;
    radiusY = temp;
    rotation += Math.PI / 2;
  }

  if (radiusX < 8 || radiusY < 8) return null;

  rotation = Math.atan2(Math.sin(rotation), Math.cos(rotation));

  return {
    centerX,
    centerY,
    radiusX,
    radiusY,
    rotation,
  };
}

function computeRimFitScore(points: Point[], ellipse: Ellipse): number {
  if (points.length === 0) return 0;

  let errorSum = 0;
  for (const point of points) {
    const radialDistance = ellipseDistance(point, ellipse);
    errorSum += Math.abs(radialDistance - 1);
  }

  const meanError = errorSum / points.length;
  return clamp01(1 - meanError * 2.7);
}

function computeEdgeScore(edge: Float32Array, width: number, height: number, ellipse: Ellipse): number {
  let sum = 0;
  let strong = 0;
  let count = 0;

  for (let degree = 0; degree < 360; degree += 4) {
    const angle = (degree * Math.PI) / 180;
    const point = ellipsePoint(ellipse, 1.0, angle);
    const value = sampleBilinear(edge, width, height, point.x, point.y);

    sum += value;
    if (value > 0.12) strong += 1;
    count += 1;
  }

  if (count === 0) return 0;

  const average = sum / count;
  const continuity = strong / count;
  const score = clamp01((average - 0.06) / 0.28) * 0.6 + continuity * 0.4;
  return clamp01(score);
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
  return clamp01(1 - Math.abs(ratio - 0.62) / 0.42);
}

function computeRingScore(luminance: Float32Array, width: number, height: number, ellipse: Ellipse): number {
  let contrastSum = 0;
  let count = 0;

  for (let degree = 0; degree < 360; degree += 6) {
    const angle = (degree * Math.PI) / 180;

    for (const boundary of RING_BOUNDARIES) {
      const inner = Math.max(0, boundary - 0.018);
      const outer = Math.min(1.08, boundary + 0.018);

      const innerPoint = ellipsePoint(ellipse, inner, angle);
      const outerPoint = ellipsePoint(ellipse, outer, angle);

      const innerLuma = sampleBilinear(luminance, width, height, innerPoint.x, innerPoint.y);
      const outerLuma = sampleBilinear(luminance, width, height, outerPoint.x, outerPoint.y);

      contrastSum += Math.abs(outerLuma - innerLuma);
      count += 1;
    }
  }

  if (count === 0) return 0;

  const averageContrast = contrastSum / count;
  return clamp01((averageContrast - 0.02) / 0.11);
}

function computePatternScore(redGreen: Float32Array, width: number, height: number, ellipse: Ellipse): { score: number; phaseDeg: number } {
  let harmonicCos = 0;
  let harmonicSin = 0;
  let signalMagnitude = 0;

  for (let degree = 0; degree < 360; degree += 3) {
    const angle = (degree * Math.PI) / 180;

    const triplePoint = ellipsePoint(ellipse, 0.505, angle);
    const doublePoint = ellipsePoint(ellipse, 0.945, angle);

    const tripleSignal = sampleBilinear(redGreen, width, height, triplePoint.x, triplePoint.y);
    const doubleSignal = sampleBilinear(redGreen, width, height, doublePoint.x, doublePoint.y);
    const combinedSignal = tripleSignal * 0.65 + doubleSignal * 0.35;

    const harmonicAngle = angle * HARMONIC_SEGMENTS;
    harmonicCos += combinedSignal * Math.cos(harmonicAngle);
    harmonicSin += combinedSignal * Math.sin(harmonicAngle);
    signalMagnitude += Math.abs(combinedSignal);
  }

  if (signalMagnitude < 1e-5) {
    return { score: 0, phaseDeg: 0 };
  }

  const amplitude = Math.sqrt(harmonicCos * harmonicCos + harmonicSin * harmonicSin) / signalMagnitude;
  const score = clamp01((amplitude - 0.07) / 0.36);

  const phase = Math.atan2(harmonicSin, harmonicCos) / HARMONIC_SEGMENTS;
  const phaseDeg = ((phase * 180) / Math.PI + 360) % 360;

  return { score, phaseDeg };
}

function scoreCandidate(
  ellipse: Ellipse,
  boundaryPoints: Point[],
  maps: FeatureMaps,
  width: number,
  height: number,
): DartboardDetectionResult {
  const rimFitScore = computeRimFitScore(boundaryPoints, ellipse);
  const edgeScore = computeEdgeScore(maps.edge, width, height, ellipse);
  const fillScore = computeFillScore(maps.mask, width, height, ellipse);
  const ringScore = computeRingScore(maps.luminance, width, height, ellipse);
  const pattern = computePatternScore(maps.redGreen, width, height, ellipse);
  const patternScore = pattern.score;

  const aspectRatio = Math.min(ellipse.radiusX, ellipse.radiusY) / Math.max(ellipse.radiusX, ellipse.radiusY);
  const aspectScore = clamp01((aspectRatio - 0.52) / 0.4);

  const avgRadius = (ellipse.radiusX + ellipse.radiusY) * 0.5;
  const relativeSize = avgRadius / Math.max(1, Math.min(width, height));
  const sizeScore = clamp01(1 - Math.abs(relativeSize - 0.32) / 0.24);

  const centerDistance =
    Math.hypot(ellipse.centerX - width * 0.5, ellipse.centerY - height * 0.5) /
    Math.max(1, Math.min(width, height));
  const centerScore = clamp01(1 - centerDistance / 0.42);

  let quality01 =
    rimFitScore * 0.24 +
    edgeScore * 0.18 +
    ringScore * 0.18 +
    patternScore * 0.2 +
    fillScore * 0.1 +
    aspectScore * 0.05 +
    sizeScore * 0.03 +
    centerScore * 0.02;

  if (patternScore < 0.08 && ringScore < 0.12) {
    quality01 *= 0.65;
  }
  if (edgeScore < 0.12) {
    quality01 *= 0.7;
  }
  if (aspectScore < 0.2 || sizeScore < 0.15) {
    quality01 *= 0.45;
  }

  const quality = Math.round(clamp01(quality01) * 100);

  return {
    ellipse,
    quality,
    patternScore,
    edgeScore,
    ringScore,
  };
}

export function detectDartboardEllipse(imageData: ImageData): DartboardDetectionResult | null {
  const { width, height } = imageData;
  const frameArea = width * height;

  if (frameArea < 160 * 120) return null;

  const maps = buildFeatureMaps(imageData);
  const cleanedMask = closeAndOpenMask(maps.mask, width, height);

  const minBlobArea = Math.floor(frameArea * 0.03);
  const maxBlobArea = Math.floor(frameArea * 0.72);

  const candidateBlobs = findTopBlobs(cleanedMask, width, height, minBlobArea, maxBlobArea, 6);
  if (candidateBlobs.length === 0) return null;

  let bestCandidate: DartboardDetectionResult | null = null;

  for (const blob of candidateBlobs) {
    const boundaryPoints = extractBoundaryPoints(cleanedMask, maps.edge, width, height, blob);
    if (boundaryPoints.length < 48) continue;

    const ellipse = fitEllipse(boundaryPoints);
    if (!ellipse) continue;

    const candidate = scoreCandidate(ellipse, boundaryPoints, maps, width, height);

    if (!bestCandidate || candidate.quality > bestCandidate.quality) {
      bestCandidate = candidate;
    }
  }

  if (!bestCandidate || bestCandidate.quality < 45) {
    return null;
  }

  return bestCandidate;
}
