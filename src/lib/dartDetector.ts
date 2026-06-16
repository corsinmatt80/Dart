/**
 * Browser-Port des Python-Dartboard-Detektors (dartboard_detector.py).
 *
 * Bildverarbeitung via OpenCV.js, Geometrie/Scoring via dartGeometry.ts.
 * Pipeline identisch zum Python-Original: Farbsegmentierung -> Double-Ring-
 * Ellipse -> Bull -> Homographie (LM) -> Sektor-Rotation -> Nummerierung.
 */
import type { CV } from './opencv';
import {
  type DetectionResult,
  type Ellipse,
  type Mat3,
  type Pt,
  RING_RADII,
  assignSectors,
  boardToImage,
  fitHomography,
} from './dartGeometry';

const TWO_PI = Math.PI * 2;

// ---------------------------------------------------------------------------
// Farbmasken (HSV) -> Ring-Maske (rot|gruen) + reine Rot-Maske (fuer Bull)
// ---------------------------------------------------------------------------
function colorMasks(cv: CV, rgba: CV): { ring: CV; red: CV } {
  const rgb = new cv.Mat();
  cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
  const hsv = new cv.Mat();
  cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
  rgb.delete();

  const lo = (h: number, s: number, v: number) =>
    new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [h, s, v, 0]);

  const red1 = new cv.Mat();
  const red2 = new cv.Mat();
  const green = new cv.Mat();
  const a = lo(0, 70, 50), b = lo(12, 255, 255);
  const c = lo(168, 70, 50), d = lo(180, 255, 255);
  const e = lo(38, 35, 35), f = lo(92, 255, 255);
  cv.inRange(hsv, a, b, red1);
  cv.inRange(hsv, c, d, red2);
  cv.inRange(hsv, e, f, green);
  [a, b, c, d, e, f].forEach((m) => m.delete());
  hsv.delete();

  const red = new cv.Mat();
  cv.add(red1, red2, red);
  red1.delete();
  red2.delete();

  const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
  cv.morphologyEx(red, red, cv.MORPH_OPEN, kernel);
  cv.morphologyEx(green, green, cv.MORPH_OPEN, kernel);

  const ring = new cv.Mat();
  cv.add(red, green, ring);
  green.delete();
  kernel.delete();
  return { ring, red };
}

/** Behaelt nur Maskenkomponenten nahe der Bildmitte (filtert Stoersignale). */
function largestCentralBlob(cv: CV, mask: CV): CV {
  const labels = new cv.Mat();
  const stats = new cv.Mat();
  const centroids = new cv.Mat();
  const n = cv.connectedComponentsWithStats(mask, labels, stats, centroids, 8, cv.CV_32S);
  if (n <= 1) {
    labels.delete();
    stats.delete();
    centroids.delete();
    return mask.clone();
  }
  const h = mask.rows;
  const w = mask.cols;
  const diag = Math.hypot(w, h);
  const minArea = h * w * 0.00005;
  const keep = new Set<number>();
  for (let i = 1; i < n; i++) {
    const area = stats.intAt(i, cv.CC_STAT_AREA);
    const cxC = centroids.doubleAt(i, 0);
    const cyC = centroids.doubleAt(i, 1);
    const dist = Math.hypot(cxC - w / 2, cyC - h / 2) / diag;
    if (area >= minArea && dist <= 0.45) keep.add(i);
  }
  const out = cv.Mat.zeros(h, w, cv.CV_8UC1);
  if (keep.size > 0) {
    const lab = labels.data32S;
    const od = out.data;
    for (let p = 0; p < lab.length; p++) if (keep.has(lab[p])) od[p] = 255;
  }
  labels.delete();
  stats.delete();
  centroids.delete();
  if (keep.size === 0) {
    out.delete();
    return mask.clone();
  }
  return out;
}

// ---------------------------------------------------------------------------
// Radiale Auswertung auf den Maskendaten (Uint8, 1 Kanal)
// ---------------------------------------------------------------------------
function maskCentroidMedian(mask: CV): Pt {
  const data = mask.data;
  const w = mask.cols;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (data[i]) {
      xs.push(i % w);
      ys.push((i / w) | 0);
    }
  }
  if (xs.length === 0) return [w / 2, mask.rows / 2];
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  const m = xs.length >> 1;
  return [xs[m], ys[m]];
}

/** Radius des dominanten Ring-Peaks (= Double-Ring) per Histogramm. */
function outerRingRadius(mask: CV, center: Pt): number {
  const data = mask.data;
  const w = mask.cols;
  const binW = 5.0;
  const hist: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (!data[i]) continue;
    const x = i % w;
    const y = (i / w) | 0;
    const r = Math.hypot(x - center[0], y - center[1]);
    const bin = (r / binW) | 0;
    hist[bin] = (hist[bin] || 0) + 1;
  }
  let peak = 0;
  for (let i = 1; i < hist.length; i++) if ((hist[i] || 0) > (hist[peak] || 0)) peak = i;
  return (peak + 1) * binW;
}

/** Pro Strahl der aeusserste Treffer im Double-Band -> Punkte der Aussenkante. */
function doubleRingPoints(mask: CV, center: Pt, ringR: number, nRays = 360): Pt[] {
  const data = mask.data;
  const w = mask.cols;
  const h = mask.rows;
  const maxR = ringR * 1.18;
  const loBand = ringR * 0.82;
  const pts: Pt[] = [];
  for (let k = 0; k < nRays; k++) {
    const a = (k / nRays) * TWO_PI;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    let foundX = -1;
    let foundY = -1;
    // von aussen nach innen: erster Treffer im Band ist die Aussenkante
    for (let r = maxR; r >= loBand; r -= 1.5) {
      const x = (center[0] + ca * r) | 0;
      const y = (center[1] + sa * r) | 0;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      if (data[y * w + x]) {
        foundX = x;
        foundY = y;
        break;
      }
    }
    if (foundX >= 0) pts.push([foundX, foundY]);
  }
  return pts;
}

/** Bull = Schwerpunkt der roten Pixel nahe der Boardmitte. */
function detectBull(red: CV, center: Pt, ringR: number): Pt {
  const data = red.data;
  const w = red.cols;
  const h = red.rows;
  const win = ringR * 0.15;
  const x0 = Math.max(0, Math.floor(center[0] - win));
  const x1 = Math.min(w, Math.ceil(center[0] + win));
  const y0 = Math.max(0, Math.floor(center[1] - win));
  const y1 = Math.min(h, Math.ceil(center[1] + win));
  let sx = 0;
  let sy = 0;
  let cnt = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++)
      if (data[y * w + x]) {
        sx += x;
        sy += y;
        cnt++;
      }
  if (cnt < 20) return center;
  return [sx / cnt, sy / cnt];
}

/** Robuster Ellipsen-Fit (cv.fitEllipse) mit iterativem Ausreisser-Trimmen. */
function robustEllipse(cv: CV, pts: Pt[]): Ellipse | null {
  if (pts.length < 8) return null;
  let cur = pts;
  let ell = fitEllipseCv(cv, cur);
  for (let it = 0; it < 3; it++) {
    const res = cur.map((p) => ellipseResidual(ell, p));
    const sorted = [...res].sort((a, b) => a - b);
    const thresh = Math.max(sorted[Math.floor(sorted.length * 0.8)] ?? 0, 1e-6);
    const keep = cur.filter((_, i) => res[i] <= thresh);
    if (keep.length < 8) break;
    cur = keep;
    ell = fitEllipseCv(cv, cur);
  }
  return ell;
}

function fitEllipseCv(cv: CV, pts: Pt[]): Ellipse {
  const mat = cv.matFromArray(pts.length, 1, cv.CV_32SC2, pts.flat());
  const rr = cv.fitEllipse(mat);
  mat.delete();
  return {
    cx: rr.center.x,
    cy: rr.center.y,
    width: rr.size.width,
    height: rr.size.height,
    angleDeg: rr.angle,
  };
}

function ellipseResidual(e: Ellipse, p: Pt): number {
  const ra = Math.max(e.width / 2, 1e-6);
  const rb = Math.max(e.height / 2, 1e-6);
  const t = (e.angleDeg * Math.PI) / 180;
  const ct = Math.cos(t);
  const st = Math.sin(t);
  const dx = p[0] - e.cx;
  const dy = p[1] - e.cy;
  const xr = dx * ct + dy * st;
  const yr = -dx * st + dy * ct;
  const norm = Math.sqrt((xr / ra) ** 2 + (yr / rb) ** 2);
  return Math.abs(norm - 1.0) * ((ra + rb) / 2);
}

/** Sektor-Rotation aus dem alternierenden schwarz/creme-Muster (Graubild). */
function detectRotation(gray: CV, H: Mat3): number {
  const data = gray.data;
  const w = gray.cols;
  const h = gray.rows;
  const n = 720;
  const fracs = [0.45, 0.55, 0.65, 0.78];
  const profile = new Float64Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) {
    const phi = (i / n) * 360;
    let acc = 0;
    for (const frac of fracs) {
      const [px, py] = boardToImage(H, phi, frac);
      const x = Math.min(w - 1, Math.max(0, px | 0));
      const y = Math.min(h - 1, Math.max(0, py | 0));
      acc += data[y * w + x];
    }
    profile[i] = acc / fracs.length;
    mean += profile[i];
  }
  mean /= n;
  for (let i = 0; i < n; i++) profile[i] -= mean;

  let bestPhase = 0;
  let bestScore = -Infinity;
  const k = 20;
  for (let shift = 0; shift < n / k; shift++) {
    const phase = (TWO_PI * shift) / n;
    let score = 0;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * TWO_PI;
      score += profile[i] * Math.sign(Math.sin(k * (ang - phase)));
    }
    score = Math.abs(score);
    if (score > bestScore) {
      bestScore = score;
      bestPhase = (phase * 180) / Math.PI;
    }
  }
  return bestPhase % 18.0;
}

// ---------------------------------------------------------------------------
// Hauptfunktion: erkennt das Board in einem RGBA-Frame (cv.Mat)
// ---------------------------------------------------------------------------
export interface DetectOptions {
  workSize?: number;
}

/**
 * Erkennt das Dartboard. `rgba` ist ein 4-Kanal cv.Mat (z.B. via
 * cv.matFromImageData). Liefert eine DetectionResult in **Frame-Pixeln**
 * (Originalaufloesung des uebergebenen Mats) oder null.
 */
export function detectBoard(cv: CV, rgba: CV, opts: DetectOptions = {}): DetectionResult | null {
  const workSize = opts.workSize ?? 1000;
  const h0 = rgba.rows;
  const w0 = rgba.cols;
  const scale = Math.min(workSize / Math.max(h0, w0), 1.0);

  const small = new cv.Mat();
  if (scale < 1.0) cv.resize(rgba, small, new cv.Size(Math.round(w0 * scale), Math.round(h0 * scale)), 0, 0, cv.INTER_AREA);
  else rgba.copyTo(small);

  const cleanup: CV[] = [small];
  const result = ((): DetectionResult | null => {
    const { ring, red } = colorMasks(cv, small);
    cleanup.push(ring, red);
    const ringMask = largestCentralBlob(cv, ring);
    cleanup.push(ringMask);

    if (cv.countNonZero(ringMask) < 500) return null;

    let center = maskCentroidMedian(ringMask);
    let ellipse: Ellipse | null = null;
    let ringR = 0;
    for (let i = 0; i < 2; i++) {
      ringR = outerRingRadius(ringMask, center);
      const dp = doubleRingPoints(ringMask, center, ringR);
      ellipse = robustEllipse(cv, dp);
      if (!ellipse) return null;
      center = [ellipse.cx, ellipse.cy];
    }

    ringR = outerRingRadius(ringMask, center);
    const bull = detectBull(red, center, ringR);
    const dpts = doubleRingPoints(ringMask, bull, ringR);
    if (dpts.length < 10) return null;

    const homo = fitHomography(ellipse!, dpts, bull);

    const gray = new cv.Mat();
    cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
    cleanup.push(gray);
    const rotation = detectRotation(gray, homo.H);

    const { boundaries, numbers } = assignSectors(rotation, homo.H);

    // zurueck auf Frame-Aufloesung skalieren: x_small = x_frame * scale
    const S: Mat3 = [
      [scale, 0, 0],
      [0, scale, 0],
      [0, 0, 1],
    ];
    const Gfull = matMul(homo.G, S);
    const Hfull = inv3(Gfull);
    const inv = 1.0 / scale;
    const bullFull: Pt = [bull[0] * inv, bull[1] * inv];
    const avgRadius = (ellipse!.width + ellipse!.height) / 4;
    const relRms = homo.rmsPx / Math.max(avgRadius, 1e-6);
    const coverage = dpts.length / 360;
    const confidence = Math.max(0, Math.min(1, coverage * (1 - Math.min(relRms / 0.04, 1))));

    return {
      found: true,
      H: Hfull,
      G: Gfull,
      bull: bullFull,
      rotationDeg: rotation,
      boundaries,
      numbers,
      rmsPx: homo.rmsPx * inv,
      confidence,
    };
  })();

  cleanup.forEach((m) => m.delete());
  return result;
}

// kleine 3x3-Helfer (lokal, damit dartGeometry rein bleibt)
function matMul(a: Mat3, b: Mat3): Mat3 {
  const r: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
  return r;
}
function inv3(m: Mat3): Mat3 {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const iv = 1 / det;
  return [
    [A * iv, (c * h - b * i) * iv, (b * f - c * e) * iv],
    [B * iv, (a * i - c * g) * iv, (c * d - a * f) * iv],
    [C * iv, (b * g - a * h) * iv, (a * e - b * d) * iv],
  ];
}

// ---------------------------------------------------------------------------
// Overlay-Zeichnung auf einem 2D-Canvas-Context
// ---------------------------------------------------------------------------
const RING_COLORS: Record<keyof typeof RING_RADII, string> = {
  outer_double: '#00ff00',
  inner_double: '#00c800',
  outer_triple: '#ffff00',
  inner_triple: '#c8c800',
  outer_bull: '#3399ff',
  inner_bull: '#ff33ff',
};

/** Zeichnet Ringe, Speichen, Zahlen und Bull als Overlay (Koordinaten = Frame-Pixel). */
export function drawOverlay(ctx: CanvasRenderingContext2D, res: DetectionResult): void {
  if (!res.found) return;
  const H = res.H;

  ctx.lineWidth = 2;
  for (const name of Object.keys(RING_RADII) as Array<keyof typeof RING_RADII>) {
    ctx.strokeStyle = RING_COLORS[name];
    ctx.beginPath();
    for (let i = 0; i <= 120; i++) {
      const [x, y] = boardToImage(H, (i / 120) * 360, RING_RADII[name]);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // Speichen
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 1;
  for (const b of res.boundaries) {
    const [ix, iy] = boardToImage(H, b, RING_RADII.outer_bull);
    const [ox, oy] = boardToImage(H, b, 1.0);
    ctx.beginPath();
    ctx.moveTo(ix, iy);
    ctx.lineTo(ox, oy);
    ctx.stroke();
  }

  // Zahlen
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < res.numbers.length; i++) {
    const ca = (res.boundaries[i] + 9) % 360;
    const [x, y] = boardToImage(H, ca, 1.12);
    ctx.fillText(String(res.numbers[i]), x, y);
  }

  // Bull
  ctx.fillStyle = '#ff0000';
  ctx.beginPath();
  ctx.arc(res.bull[0], res.bull[1], 4, 0, TWO_PI);
  ctx.fill();
}
