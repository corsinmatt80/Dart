/**
 * Dartboard Computer Vision Utilities
 * Functions for dartboard detection, calibration, and dart scoring
 */

// ============ TYPES ============

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

export interface PolarCoord {
  r: number;    // Normalized radius (0-1 for on-board)
  theta: number; // Angle in degrees
}

export interface DartScore {
  value: number;      // Segment value (1-20, 25, 50)
  multiplier: number; // 1=single, 2=double, 3=triple
  points: number;     // Total points
}

// ============ CONSTANTS ============

// Dartboard ring radii as fraction of total radius
export const DOUBLE_BULL_R = 0.032;
export const SINGLE_BULL_R = 0.074;
export const INNER_SINGLE_OUTER_R = 0.428;
export const TRIPLE_OUTER_R = 0.474;
export const OUTER_SINGLE_OUTER_R = 0.715;
export const DOUBLE_OUTER_R = 1.0;

// Dartboard numbers in clockwise order starting from top (20)
export const DART_NUMBERS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
export const SEGMENT_ANGLE = 18; // 360 / 20 segments

// Detection thresholds
export const DIFF_THRESHOLD = 25;
export const MIN_DART_AREA = 50;
export const MAX_DART_AREA = 5000;

// ============ COLOR CONVERSION ============

export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  
  if (d !== 0) {
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }
  
  return { h: h * 360, s: s * 100, v: v * 100 };
}

// ============ COORDINATE CONVERSION ============

export function pointToEllipsePolar(
  point: Point,
  ellipse: Ellipse,
  rotationOffset: number = 0
): PolarCoord {
  const dx = point.x - ellipse.centerX;
  const dy = point.y - ellipse.centerY;
  
  const cos = Math.cos(-ellipse.rotation);
  const sin = Math.sin(-ellipse.rotation);
  const nx = dx * cos - dy * sin;
  const ny = dx * sin + dy * cos;
  
  const normX = nx / ellipse.radiusX;
  const normY = ny / ellipse.radiusY;
  
  const r = Math.sqrt(normX * normX + normY * normY);
  let theta = Math.atan2(nx, -ny) * (180 / Math.PI);
  if (theta < 0) theta += 360;
  
  theta = (theta + rotationOffset + 360) % 360;
  
  return { r, theta };
}

export function polarToScore(polar: PolarCoord): DartScore {
  const { r, theta } = polar;
  
  if (r > DOUBLE_OUTER_R * 1.05) {
    return { value: 0, multiplier: 0, points: 0 };
  }
  
  if (r <= DOUBLE_BULL_R) {
    return { value: 50, multiplier: 2, points: 50 };
  }
  if (r <= SINGLE_BULL_R) {
    return { value: 25, multiplier: 1, points: 25 };
  }
  
  const adjustedTheta = (theta + SEGMENT_ANGLE / 2) % 360;
  const segmentIdx = Math.floor(adjustedTheta / SEGMENT_ANGLE) % 20;
  const value = DART_NUMBERS[segmentIdx];
  
  let multiplier = 1;
  if (r >= OUTER_SINGLE_OUTER_R && r <= DOUBLE_OUTER_R) {
    multiplier = 2;
  } else if (r >= INNER_SINGLE_OUTER_R && r <= TRIPLE_OUTER_R) {
    multiplier = 3;
  }
  
  return { value, multiplier, points: value * multiplier };
}

// ============ DARTBOARD DETECTION ============

export function createDartboardColorMask(imageData: ImageData): Uint8Array {
  const { width, height, data } = imageData;
  const mask = new Uint8Array(width * height);
  
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const hsv = rgbToHsv(r, g, b);
    const pixelIdx = i / 4;
    
    // Red detection
    const isRed = (
      ((hsv.h >= 0 && hsv.h <= 15) || (hsv.h >= 345 && hsv.h <= 360)) &&
      hsv.s >= 30 && hsv.v >= 20
    );
    
    // Green detection
    const isGreen = hsv.h >= 80 && hsv.h <= 160 && hsv.s >= 30 && hsv.v >= 20;
    
    // Black detection
    const isBlack = hsv.v <= 30;
    
    // White detection
    const isWhite = hsv.v >= 70 && hsv.s <= 30;
    
    mask[pixelIdx] = (isRed || isGreen || isBlack || isWhite) ? 255 : 0;
  }
  
  return mask;
}

export function morphologicalClose(
  mask: Uint8Array,
  width: number,
  height: number,
  kernelSize: number = 5
): Uint8Array {
  const halfKernel = Math.floor(kernelSize / 2);
  const dilated = new Uint8Array(width * height);
  const closed = new Uint8Array(width * height);
  
  // Dilate
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let maxVal = 0;
      for (let ky = -halfKernel; ky <= halfKernel; ky++) {
        for (let kx = -halfKernel; kx <= halfKernel; kx++) {
          const ny = y + ky;
          const nx = x + kx;
          if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
            maxVal = Math.max(maxVal, mask[ny * width + nx]);
          }
        }
      }
      dilated[y * width + x] = maxVal;
    }
  }
  
  // Erode
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let minVal = 255;
      for (let ky = -halfKernel; ky <= halfKernel; ky++) {
        for (let kx = -halfKernel; kx <= halfKernel; kx++) {
          const ny = y + ky;
          const nx = x + kx;
          if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
            minVal = Math.min(minVal, dilated[ny * width + nx]);
          }
        }
      }
      closed[y * width + x] = minVal;
    }
  }
  
  return closed;
}

export function findLargestBlob(
  mask: Uint8Array,
  width: number,
  height: number
): { points: Point[]; bounds: { minX: number; minY: number; maxX: number; maxY: number } } | null {
  const visited = new Uint8Array(width * height);
  let largestBlob: Point[] = [];
  let largestBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  
  const floodFill = (startX: number, startY: number) => {
    const points: Point[] = [];
    const bounds = { minX: startX, minY: startY, maxX: startX, maxY: startY };
    const stack: Point[] = [{ x: startX, y: startY }];
    
    while (stack.length > 0) {
      const { x, y } = stack.pop()!;
      const idx = y * width + x;
      
      if (x < 0 || x >= width || y < 0 || y >= height) continue;
      if (visited[idx] || mask[idx] === 0) continue;
      
      visited[idx] = 1;
      points.push({ x, y });
      bounds.minX = Math.min(bounds.minX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.maxY = Math.max(bounds.maxY, y);
      
      stack.push({ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 });
    }
    
    return { points, bounds };
  };
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (mask[idx] > 0 && !visited[idx]) {
        const blob = floodFill(x, y);
        if (blob.points.length > largestBlob.length) {
          largestBlob = blob.points;
          largestBounds = blob.bounds;
        }
      }
    }
  }
  
  return largestBlob.length > 0 ? { points: largestBlob, bounds: largestBounds } : null;
}

export function fitEllipse(points: Point[]): Ellipse | null {
  if (points.length < 6) return null;
  
  let samplePoints = points;
  if (points.length > 500) {
    samplePoints = [];
    const step = Math.floor(points.length / 500);
    for (let i = 0; i < points.length; i += step) {
      samplePoints.push(points[i]);
    }
  }
  
  let cx = 0, cy = 0;
  for (const p of samplePoints) {
    cx += p.x;
    cy += p.y;
  }
  cx /= samplePoints.length;
  cy /= samplePoints.length;
  
  const n = samplePoints.length;
  let sumX2 = 0, sumY2 = 0, sumXY = 0;
  
  for (const p of samplePoints) {
    const x = p.x - cx;
    const y = p.y - cy;
    sumX2 += x * x;
    sumY2 += y * y;
    sumXY += x * y;
  }
  
  const covXX = sumX2 / n;
  const covYY = sumY2 / n;
  const covXY = sumXY / n;
  
  const theta = 0.5 * Math.atan2(2 * covXY, covXX - covYY);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  
  const uValues: number[] = [];
  const vValues: number[] = [];
  for (const p of samplePoints) {
    const x = p.x - cx;
    const y = p.y - cy;
    uValues.push(Math.abs(x * cos + y * sin));
    vValues.push(Math.abs(-x * sin + y * cos));
  }
  uValues.sort((a, b) => a - b);
  vValues.sort((a, b) => a - b);
  
  const percentile95 = Math.floor(samplePoints.length * 0.95);
  const radiusX = uValues[percentile95] || uValues[uValues.length - 1];
  const radiusY = vValues[percentile95] || vValues[vValues.length - 1];
  
  if (radiusX < 10 || radiusY < 10) return null;
  
  return { centerX: cx, centerY: cy, radiusX, radiusY, rotation: theta };
}

export function detectDartboard(imageData: ImageData): Ellipse | null {
  const { width, height } = imageData;
  
  const mask = createDartboardColorMask(imageData);
  const cleanedMask = morphologicalClose(mask, width, height, 5);
  const blob = findLargestBlob(cleanedMask, width, height);
  
  if (!blob || blob.points.length < 1000) return null;
  
  // Find edge points
  const edges: Point[] = [];
  for (let y = blob.bounds.minY; y <= blob.bounds.maxY; y++) {
    for (let x = blob.bounds.minX; x <= blob.bounds.maxX; x++) {
      const idx = y * width + x;
      if (cleanedMask[idx] === 0) continue;
      
      let isEdge = false;
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || cleanedMask[ny * width + nx] === 0) {
          isEdge = true;
          break;
        }
      }
      if (isEdge) edges.push({ x, y });
    }
  }
  
  if (edges.length < 100) return null;
  
  return fitEllipse(edges);
}

// ============ DART DETECTION ============

export function detectDartInDifference(
  currentFrame: ImageData,
  referenceFrame: ImageData,
  ellipse: Ellipse,
  threshold: number = DIFF_THRESHOLD
): Point | null {
  const { width, height, data: current } = currentFrame;
  const reference = referenceFrame.data;
  
  const searchRadius = Math.max(ellipse.radiusX, ellipse.radiusY) * 1.1;
  const minX = Math.max(0, Math.floor(ellipse.centerX - searchRadius));
  const maxX = Math.min(width, Math.ceil(ellipse.centerX + searchRadius));
  const minY = Math.max(0, Math.floor(ellipse.centerY - searchRadius));
  const maxY = Math.min(height, Math.ceil(ellipse.centerY + searchRadius));
  
  const diffPoints: Point[] = [];
  
  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      const i = (y * width + x) * 4;
      
      const dr = Math.abs(current[i] - reference[i]);
      const dg = Math.abs(current[i + 1] - reference[i + 1]);
      const db = Math.abs(current[i + 2] - reference[i + 2]);
      const diff = (dr + dg + db) / 3;
      
      if (diff > threshold) {
        const polar = pointToEllipsePolar({ x, y }, ellipse);
        if (polar.r < 1.1) {
          diffPoints.push({ x, y });
        }
      }
    }
  }
  
  if (diffPoints.length < MIN_DART_AREA || diffPoints.length > MAX_DART_AREA) {
    return null;
  }
  
  const sortedByDist = diffPoints.map(p => ({
    point: p,
    dist: Math.sqrt((p.x - ellipse.centerX) ** 2 + (p.y - ellipse.centerY) ** 2)
  })).sort((a, b) => a.dist - b.dist);
  
  const tipCandidates = sortedByDist.slice(0, Math.max(5, Math.floor(sortedByDist.length * 0.1)));
  let tipX = 0, tipY = 0;
  for (const c of tipCandidates) {
    tipX += c.point.x;
    tipY += c.point.y;
  }
  
  return { x: tipX / tipCandidates.length, y: tipY / tipCandidates.length };
}

// ============ VISUALIZATION ============

export function drawEllipseOverlay(
  ctx: CanvasRenderingContext2D,
  ellipse: Ellipse,
  color: string = 'rgba(0, 255, 0, 0.8)'
) {
  ctx.save();
  ctx.translate(ellipse.centerX, ellipse.centerY);
  ctx.rotate(ellipse.rotation);
  
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(0, 0, ellipse.radiusX, ellipse.radiusY, 0, 0, Math.PI * 2);
  ctx.stroke();
  
  ctx.globalAlpha = 0.4;
  ctx.lineWidth = 1;
  const rings = [OUTER_SINGLE_OUTER_R, TRIPLE_OUTER_R, INNER_SINGLE_OUTER_R, SINGLE_BULL_R, DOUBLE_BULL_R];
  
  for (const r of rings) {
    ctx.beginPath();
    ctx.ellipse(0, 0, ellipse.radiusX * r, ellipse.radiusY * r, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  
  ctx.restore();
}

export function drawDartMarker(
  ctx: CanvasRenderingContext2D,
  point: Point,
  score: DartScore,
  color: string = '#ff0000'
) {
  ctx.save();
  
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  const size = 15;
  
  ctx.beginPath();
  ctx.moveTo(point.x - size, point.y);
  ctx.lineTo(point.x + size, point.y);
  ctx.moveTo(point.x, point.y - size);
  ctx.lineTo(point.x, point.y + size);
  ctx.stroke();
  
  ctx.beginPath();
  ctx.arc(point.x, point.y, size / 2, 0, Math.PI * 2);
  ctx.stroke();
  
  const label = score.points > 0 
    ? (score.multiplier === 3 ? 'T' : score.multiplier === 2 ? 'D' : '') + score.value
    : 'MISS';
  
  ctx.fillStyle = color;
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, point.x, point.y - 20);
  
  ctx.restore();
}
