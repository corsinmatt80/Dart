/**
 * Reine Geometrie-/Mathematik der Dartboard-Erkennung (ohne OpenCV).
 *
 * Portiert aus dem Python-Detektor (src/pages/cv/dartboard_detector.py): die
 * Board<->Bild-Homographie, deren Schaetzung per Levenberg-Marquardt aus dem
 * Double-Ring + Bull, sowie das Punkt-zu-Feld-Scoring. Bewusst frei von
 * Browser-/OpenCV-Abhaengigkeiten, damit es isoliert (auch in Node) testbar
 * ist. Die bildverarbeitenden Schritte liegen in dartDetector.ts.
 */

export type Mat3 = number[][]; // 3x3
export type Pt = [number, number];

/** Radien relativ zum aeusseren Double-Ring (= 1.0). */
export const RING_RADII = {
  outer_double: 170.0 / 170.0,
  inner_double: 162.0 / 170.0,
  outer_triple: 107.0 / 170.0,
  inner_triple: 99.0 / 170.0,
  outer_bull: 15.9 / 170.0,
  inner_bull: 6.35 / 170.0,
} as const;

/** Zahlenreihenfolge im Uhrzeigersinn ab oben (20). */
export const SECTOR_SEQUENCE = [
  20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5,
];

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// Homographie-Anwendung
// ---------------------------------------------------------------------------
/** Board-Punkt (Winkel phi in Grad, Radius-Anteil rho) -> Bildpixel via H. */
export function boardToImage(H: Mat3, phiDeg: number, rho: number): Pt {
  const a = phiDeg * DEG;
  const bx = rho * Math.cos(a);
  const by = rho * Math.sin(a);
  const w = H[2][0] * bx + H[2][1] * by + H[2][2];
  const x = (H[0][0] * bx + H[0][1] * by + H[0][2]) / w;
  const y = (H[1][0] * bx + H[1][1] * by + H[1][2]) / w;
  return [x, y];
}

/** Bildpixel -> Board-Koordinaten (X, Y) via inverser Homographie G. */
export function imageToBoard(G: Mat3, x: number, y: number): Pt {
  const w = G[2][0] * x + G[2][1] * y + G[2][2];
  const X = (G[0][0] * x + G[0][1] * y + G[0][2]) / w;
  const Y = (G[1][0] * x + G[1][1] * y + G[1][2]) / w;
  return [X, Y];
}

// ---------------------------------------------------------------------------
// Lineare Algebra (klein, fuer LM + Homographie-Inverse)
// ---------------------------------------------------------------------------
export function mat3Inverse(m: Mat3): Mat3 {
  const [a, b, c] = m[0];
  const [d, e, f] = m[1];
  const [g, h, i] = m[2];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const inv = 1.0 / det;
  return [
    [A * inv, (c * h - b * i) * inv, (b * f - c * e) * inv],
    [B * inv, (a * i - c * g) * inv, (c * d - a * f) * inv],
    [C * inv, (b * g - a * h) * inv, (a * e - b * d) * inv],
  ];
}

export function mat3Mul(a: Mat3, b: Mat3): Mat3 {
  const r: Mat3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
  return r;
}

/** Loest A x = b fuer n x n via Gauss-Elimination mit Teilpivotisierung. */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++)
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col] / M[col][col];
      for (let k = col; k <= n; k++) M[r][k] -= factor * M[col][k];
    }
  }
  return M.map((row, i) => row[n] / M[i][i]);
}

// ---------------------------------------------------------------------------
// Ellipse (cv2.fitEllipse-kompatibel: center + voller Achsen w/h + Winkel)
// ---------------------------------------------------------------------------
export interface Ellipse {
  cx: number;
  cy: number;
  width: number; // volle Achse
  height: number; // volle Achse
  angleDeg: number;
}

// ---------------------------------------------------------------------------
// Homographie-Schaetzung aus Double-Ring + Bull (LM), Port von _fit_homography
// ---------------------------------------------------------------------------
const PARAM_IDX: Array<[number, number]> = [
  [0, 0],
  [0, 1],
  [1, 0],
  [1, 1],
  [2, 0],
  [2, 1],
];

function seedG(ellipse: Ellipse, s: number): Mat3 {
  const rxn = ellipse.width / 2.0 / s;
  const ryn = ellipse.height / 2.0 / s;
  const t = ellipse.angleDeg * DEG;
  const ct = Math.cos(t);
  const st = Math.sin(t);
  // diag(1/rxn,1/ryn) @ Rinv, Rinv = [[ct,st],[-st,ct]]
  return [
    [ct / rxn, st / rxn, 0],
    [-st / ryn, ct / ryn, 0],
    [0, 0, 1],
  ];
}

function circleResiduals(G: Mat3, Du: Pt[]): number[] {
  const res = new Array(Du.length);
  for (let i = 0; i < Du.length; i++) {
    const u = Du[i][0];
    const v = Du[i][1];
    const w = G[2][0] * u + G[2][1] * v + 1.0;
    const X = (G[0][0] * u + G[0][1] * v) / w;
    const Y = (G[1][0] * u + G[1][1] * v) / w;
    res[i] = Math.hypot(X, Y) - 1.0;
  }
  return res;
}

function sumSq(a: number[]): number {
  let s = 0;
  for (const v of a) s += v * v;
  return s;
}

export interface Homography {
  G: Mat3; // Bild -> Board
  H: Mat3; // Board -> Bild
  rmsPx: number;
}

/**
 * Schaetzt die Homographie aus den Double-Ringpunkten und dem Bull (= Ursprung).
 * `dpts` und `bull` in Bildpixeln. Spiegelt den Python-LM (6 Parameter,
 * G02=G12=0 -> Bull bildet exakt auf den Ursprung ab).
 */
export function fitHomography(ellipse: Ellipse, dptsIn: Pt[], bull: Pt): Homography {
  const s = (ellipse.width + ellipse.height) / 4.0;
  let Du: Pt[] = dptsIn.map((p) => [(p[0] - bull[0]) / s, (p[1] - bull[1]) / s]);

  let G = seedG(ellipse, s);

  for (let round = 0; round < 2; round++) {
    let lam = 1e-3;
    for (let iter = 0; iter < 40; iter++) {
      const r0 = circleResiduals(G, Du);
      const c0 = sumSq(r0);
      // Numerische Jacobi-Matrix (len(r) x 6).
      const J: number[][] = r0.map(() => new Array(6).fill(0));
      for (let k = 0; k < 6; k++) {
        const [i, j] = PARAM_IDX[k];
        const step = 1e-6 * (1.0 + Math.abs(G[i][j]));
        const Gp = G.map((row) => [...row]);
        Gp[i][j] += step;
        const rp = circleResiduals(Gp, Du);
        for (let m = 0; m < r0.length; m++) J[m][k] = (rp[m] - r0[m]) / step;
      }
      // JtJ (6x6), Jtr (6)
      const JtJ: number[][] = Array.from({ length: 6 }, () => new Array(6).fill(0));
      const Jtr: number[] = new Array(6).fill(0);
      for (let m = 0; m < r0.length; m++) {
        for (let a = 0; a < 6; a++) {
          Jtr[a] += J[m][a] * r0[m];
          for (let b = 0; b < 6; b++) JtJ[a][b] += J[m][a] * J[m][b];
        }
      }
      let improved = false;
      for (let ls = 0; ls < 8; ls++) {
        const damped = JtJ.map((row, a) => row.map((val, b) => (a === b ? val + lam * val : val)));
        const negJtr = Jtr.map((v) => -v);
        const delta = solveLinear(damped, negJtr);
        if (!delta) {
          lam *= 10;
          continue;
        }
        const Gn = G.map((row) => [...row]);
        for (let k = 0; k < 6; k++) {
          const [i, j] = PARAM_IDX[k];
          Gn[i][j] += delta[k];
        }
        if (sumSq(circleResiduals(Gn, Du)) < c0) {
          G = Gn;
          lam *= 0.5;
          improved = true;
          break;
        }
        lam *= 4;
      }
      const gradNorm = Math.hypot(...Jtr);
      if (!improved || gradNorm < 1e-9) break;
    }
    // Ausreisser verwerfen und erneut fitten.
    const res = circleResiduals(G, Du).map(Math.abs);
    const sorted = [...res].sort((a, b) => a - b);
    const q90 = sorted[Math.floor(sorted.length * 0.9)] ?? Infinity;
    const median = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
    const thresh = Math.max(q90, 3.0 * median);
    const kept = Du.filter((_, i) => res[i] <= thresh);
    if (kept.length >= 12 && kept.length < Du.length) Du = kept;
    else break;
  }

  const finalRes = circleResiduals(G, Du);
  const rmsBoard = Math.sqrt(sumSq(finalRes) / Math.max(finalRes.length, 1));

  // Normierte -> Pixel-Homographie: u = (x - bull)/s
  const N: Mat3 = [
    [1.0 / s, 0, -bull[0] / s],
    [0, 1.0 / s, -bull[1] / s],
    [0, 0, 1],
  ];
  const Gpx = mat3Mul(G, N);
  const Hpx = mat3Inverse(Gpx);
  return { G: Gpx, H: Hpx, rmsPx: rmsBoard * s };
}

// ---------------------------------------------------------------------------
// Sektor-Zuordnung (oberster Sektor = 20)
// ---------------------------------------------------------------------------
export function assignSectors(
  rotationDeg: number,
  H: Mat3,
): { boundaries: number[]; numbers: number[] } {
  const boundaries: number[] = [];
  for (let i = 0; i < 20; i++) boundaries.push((rotationDeg + i * 18.0) % 360.0);
  const centers = boundaries.map((b) => (b + 9.0) % 360.0);
  const ys = centers.map((c) => boardToImage(H, c, 0.7)[1]);
  let start = 0;
  for (let i = 1; i < 20; i++) if (ys[i] < ys[start]) start = i;
  const numbers = new Array(20).fill(0);
  for (let i = 0; i < 20; i++) numbers[(start + i) % 20] = SECTOR_SEQUENCE[i];
  return { boundaries, numbers };
}

// ---------------------------------------------------------------------------
// Punkt-zu-Feld Scoring
// ---------------------------------------------------------------------------
export interface DetectionResult {
  found: boolean;
  H: Mat3;
  G: Mat3;
  bull: Pt;
  rotationDeg: number;
  boundaries: number[];
  numbers: number[];
  rmsPx: number;
  confidence: number;
}

/** Bildet einen Pixel auf sein Dartfeld ab (z.B. 'T20', 'D16', '25', '50'). */
export function scorePoint(res: DetectionResult, x: number, y: number): string {
  if (!res.found) return '?';
  const [X, Y] = imageToBoard(res.G, x, y);
  const r = Math.hypot(X, Y);
  if (r > RING_RADII.outer_double) return 'OUT';
  if (r <= RING_RADII.inner_bull) return '50';
  if (r <= RING_RADII.outer_bull) return '25';
  const angDeg = ((Math.atan2(Y, X) * 180) / Math.PI + 360) % 360;
  const idx = Math.floor(((angDeg - res.boundaries[0] + 360) % 360) / 18.0) % 20;
  const num = res.numbers[idx];
  if (r >= RING_RADII.inner_triple && r <= RING_RADII.outer_triple) return `T${num}`;
  if (r >= RING_RADII.inner_double && r <= RING_RADII.outer_double) return `D${num}`;
  return `${num}`;
}

/** Numerischer Punktwert eines Feld-Labels (fuer Spiel-Logik). */
export function labelToHit(label: string): { value: number; multiplier: 1 | 2 | 3 } | null {
  if (label === 'OUT' || label === '?') return null;
  if (label === '50') return { value: 50, multiplier: 1 };
  if (label === '25') return { value: 25, multiplier: 1 };
  const m = /^([TD]?)(\d+)$/.exec(label);
  if (!m) return null;
  const value = parseInt(m[2], 10);
  const multiplier = m[1] === 'T' ? 3 : m[1] === 'D' ? 2 : 1;
  return { value, multiplier };
}
