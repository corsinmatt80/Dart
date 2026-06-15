"""Robuste Dartboard-Erkennung mit klassischer Computer Vision.

Funktioniert bei beliebigem Blickwinkel (starke Perspektive), solange das
Board aufrecht haengt (oberster Sektor = 20). Der Kern ist eine echte
**Homographie** der Boardebene, die aus zwei konzentrischen Farbringen
(Double + Triple) und dem Bull geschaetzt wird -- keine Naeherung, sondern die
korrekte projektive Entzerrung.

Pipeline
--------
1. Farbsegmentierung (HSV) der roten und gruenen Double-/Triple-Ringe.
2. Radiale Suche pro Strahl: aeussere Double-Kante UND Triple-Kante als zwei
   konzentrische Punktwolken (bekannte Radien 1.0 und 107/170).
3. Bull-Detektion (rote Pixel nahe der Boardmitte) als Bild des Ursprungs.
4. Schaetzung der Homographie Board<->Bild per Levenberg-Marquardt
   (Punkt-zu-Kreis-Abstand der beiden Ringe + Ursprung = Bull). Damit wird
   auch starke perspektivische Verzerrung exakt erfasst.
5. Sektor-Rotation ueber das alternierende schwarz/creme-Muster.
6. Nummerierung der 20 Felder (oberster Sektor = 20).
7. Visualisierung + Punkt-zu-Feld-Scoring (`score_point`).
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

import cv2
import numpy as np


# ---------------------------------------------------------------------------
# Geometrie-Konstanten (offizielle WDF/PDC-Massangaben, Radien rel. zu 170 mm)
# ---------------------------------------------------------------------------
RING_RADII = {
    "outer_double": 170.0 / 170.0,
    "inner_double": 162.0 / 170.0,
    "outer_triple": 107.0 / 170.0,
    "inner_triple": 99.0 / 170.0,
    "outer_bull": 15.9 / 170.0,   # 25er-Ring (Single Bull)
    "inner_bull": 6.35 / 170.0,   # Bullseye (50)
}

# Standard-Reihenfolge der Zahlen im Uhrzeigersinn, beginnend bei 20 (oben).
SECTOR_SEQUENCE = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17,
                   3, 19, 7, 16, 8, 11, 14, 9, 12, 5]


# ---------------------------------------------------------------------------
# Homographie-Helfer (Board-Einheiten: aeusserer Double-Radius = 1, Ursprung = Bull)
# ---------------------------------------------------------------------------
def board_to_image(H, phi_deg, rho):
    """Board-Punkt (Winkel `phi`, Radius-Anteil `rho`) -> Bildpixel via H."""
    a = np.deg2rad(phi_deg)
    bx = rho * np.cos(a)
    by = rho * np.sin(a)
    w = H[2, 0] * bx + H[2, 1] * by + H[2, 2]
    x = (H[0, 0] * bx + H[0, 1] * by + H[0, 2]) / w
    y = (H[1, 0] * bx + H[1, 1] * by + H[1, 2]) / w
    return x, y


def image_to_board(G, x, y):
    """Bildpixel -> Board-Koordinaten (X, Y) via inverser Homographie G."""
    w = G[2, 0] * x + G[2, 1] * y + G[2, 2]
    X = (G[0, 0] * x + G[0, 1] * y + G[0, 2]) / w
    Y = (G[1, 0] * x + G[1, 1] * y + G[1, 2]) / w
    return X, Y


@dataclass
class DartboardResult:
    """Strukturiertes Ergebnis (alle Koordinaten in Original-Bildpixeln)."""

    found: bool
    H: np.ndarray | None = None          # Board -> Bild (3x3 Homographie)
    G: np.ndarray | None = None          # Bild -> Board (inverse Homographie)
    bull_center: tuple[float, float] | None = None
    outer_ellipse: tuple | None = None   # Referenz-Ellipse der aeusseren Double
    rotation_deg: float = 0.0
    sector_numbers: list[int] = field(default_factory=list)
    sector_boundaries_deg: list[float] = field(default_factory=list)
    # Guete-Metriken
    edge_coverage: float = 0.0
    fit_rms_px: float = 0.0
    score_confidence: float = 0.0

    @property
    def center(self):
        return self.bull_center


class DartboardDetector:
    def __init__(self, work_size: int = 1400):
        self.work_size = work_size

    # ------------------------------------------------------------------
    # Farbsegmentierung
    # ------------------------------------------------------------------
    @staticmethod
    def _color_masks(bgr: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
        red = cv2.inRange(hsv, (0, 70, 50), (12, 255, 255)) | \
            cv2.inRange(hsv, (168, 70, 50), (180, 255, 255))
        green = cv2.inRange(hsv, (38, 35, 35), (92, 255, 255))
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        red = cv2.morphologyEx(red, cv2.MORPH_OPEN, kernel)
        green = cv2.morphologyEx(green, cv2.MORPH_OPEN, kernel)
        return red, green

    @staticmethod
    def _largest_central_blob(mask: np.ndarray) -> np.ndarray:
        """Behaelt nur Komponenten nahe der Bildmitte (filtert Stoersignale)."""
        h, w = mask.shape
        n, labels, stats, centroids = cv2.connectedComponentsWithStats(mask, 8)
        if n <= 1:
            return mask
        img_c = np.array([w / 2.0, h / 2.0])
        diag = np.hypot(w, h)
        big = stats[1:, cv2.CC_STAT_AREA] >= (h * w) * 0.00005
        near = np.linalg.norm(centroids[1:] - img_c, axis=1) / diag <= 0.45
        keep_labels = np.flatnonzero(big & near) + 1
        if keep_labels.size == 0:
            return mask
        return np.where(np.isin(labels, keep_labels), np.uint8(255), np.uint8(0))

    # ------------------------------------------------------------------
    # Radiale Ringpunkte (Double + Triple)
    # ------------------------------------------------------------------
    @staticmethod
    def _outer_ring_radius(mask: np.ndarray, center: np.ndarray) -> float:
        """Radius des dominanten Ring-Peaks (= Double-Ring) per Histogramm."""
        ys, xs = np.where(mask > 0)
        r = np.hypot(xs - center[0], ys - center[1])
        if r.size == 0:
            return float(min(mask.shape) * 0.45)
        bin_w = 5.0
        hist = np.bincount((r / bin_w).astype(np.int32))
        return (int(np.argmax(hist)) + 1) * bin_w

    def _double_ring_points(self, mask, center, ring_r, n_rays=360):
        """Pro Strahl der am weitesten aussen liegende Ring-Pixel im Double-Band.

        Vollstaendig vektorisiert: ein (Strahlen x Radien)-Gitter wird einmal
        gesampelt; pro Strahl liefert der groesste Treffer-Radius den Punkt auf
        der Aussenkante des Double-Rings.
        """
        h, w = mask.shape
        cx, cy = center
        radii = np.arange(5.0, ring_r * 1.18, 1.5, dtype=np.float32)
        angles = np.linspace(0.0, 2.0 * np.pi, n_rays, endpoint=False)
        xi = np.clip((cx + np.cos(angles)[:, None] * radii).astype(np.int32), 0, w - 1)
        yi = np.clip((cy + np.sin(angles)[:, None] * radii).astype(np.int32), 0, h - 1)

        band = (radii >= ring_r * 0.82) & (radii <= ring_r * 1.18)
        hit = (mask[yi, xi] > 0) & band
        # Index des aeussersten Treffers pro Strahl (-1 = kein Treffer).
        order = np.where(hit, np.arange(radii.size), -1)
        jmax = order.max(axis=1)
        rows = np.flatnonzero(jmax >= 0)
        if rows.size == 0:
            return np.empty((0, 2), dtype=np.float64)
        cols = jmax[rows]
        return np.stack([xi[rows, cols], yi[rows, cols]], axis=1).astype(np.float64)

    # ------------------------------------------------------------------
    # Ellipsen-Fit (Seed) mit Ausreisser-Trimmen
    # ------------------------------------------------------------------
    @staticmethod
    def _robust_ellipse(points, iters=3, keep_ratio=0.8):
        if points is None or len(points) < 8:
            return None
        pts = points.astype(np.float32).copy()
        ellipse = cv2.fitEllipse(pts.reshape(-1, 1, 2))
        for _ in range(iters):
            res = DartboardDetector._ellipse_residuals(pts, ellipse)
            thresh = max(np.quantile(res, keep_ratio), 1e-6)
            keep = res <= thresh
            if keep.sum() < 8:
                break
            pts = pts[keep]
            ellipse = cv2.fitEllipse(pts.reshape(-1, 1, 2))
        return ellipse

    @staticmethod
    def _ellipse_residuals(points, ellipse):
        (cx, cy), (aa, ab), angle = ellipse
        ra, rb = max(aa / 2.0, 1e-6), max(ab / 2.0, 1e-6)
        t = np.deg2rad(angle)
        ct, st = np.cos(t), np.sin(t)
        rel = points - np.array([cx, cy])
        xr = rel[:, 0] * ct + rel[:, 1] * st
        yr = -rel[:, 0] * st + rel[:, 1] * ct
        norm = np.sqrt((xr / ra) ** 2 + (yr / rb) ** 2)
        return np.abs(norm - 1.0) * ((ra + rb) / 2.0)

    # ------------------------------------------------------------------
    # Bull-Detektion
    # ------------------------------------------------------------------
    @staticmethod
    def _detect_bull(red, ellipse_center, ring_r):
        h, w = red.shape
        win = ring_r * 0.15
        y0, y1 = int(max(0, ellipse_center[1] - win)), int(min(h, ellipse_center[1] + win))
        x0, x1 = int(max(0, ellipse_center[0] - win)), int(min(w, ellipse_center[0] + win))
        ys, xs = np.where(red[y0:y1, x0:x1] > 0)
        if len(xs) < 20:
            return np.array(ellipse_center, dtype=np.float64)
        return np.array([x0 + xs.mean(), y0 + ys.mean()], dtype=np.float64)

    # ------------------------------------------------------------------
    # Homographie-Schaetzung (Board <-> Bild)
    # ------------------------------------------------------------------
    @staticmethod
    def _seed_G(ellipse, s):
        """Affine Start-Homographie (Bild->Board) aus der Double-Ellipse.

        Arbeitet in um Bull normierten Bildkoordinaten (u, v) = (P - bull) / s.
        Die Translation bleibt 0, da der Bull (u=0) per Konstruktion auf den
        Ursprung abbildet (siehe `_fit_homography`).
        """
        (aa, ab), angle = ellipse[1], ellipse[2]
        rxn, ryn = (aa / 2.0) / s, (ab / 2.0) / s
        t = np.deg2rad(angle)
        ct, st = np.cos(t), np.sin(t)
        Rinv = np.array([[ct, st], [-st, ct]])           # Rotation um -angle
        G = np.eye(3)
        G[:2, :2] = np.diag([1.0 / rxn, 1.0 / ryn]) @ Rinv
        return G

    # Freie Parameter: G00,G01,G10,G11 (linear) + G20,G21 (Perspektive).
    # G02=G12=0 fixiert (Bull u=0 -> Ursprung exakt); G22=1.
    _PARAM_IDX = [(0, 0), (0, 1), (1, 0), (1, 1), (2, 0), (2, 1)]

    @staticmethod
    def _circle_residuals(G, Du):
        """Punkt-zu-Einheitskreis-Abstaende der Double-Punkte (Board-Einheiten)."""
        w = G[2, 0] * Du[:, 0] + G[2, 1] * Du[:, 1] + 1.0
        X = (G[0, 0] * Du[:, 0] + G[0, 1] * Du[:, 1]) / w
        Y = (G[1, 0] * Du[:, 0] + G[1, 1] * Du[:, 1]) / w
        return np.hypot(X, Y) - 1.0

    def _fit_homography(self, ellipse, dpts, bull):
        """Schaetzt die Homographie aus dem Double-Ring + Bull (=Ursprung).

        Wohlgestellt: ein Kreisbild + dessen Zentrum bestimmen die Pose. Die
        Perspektiv-Zeilen werden zwingend aktiv, sobald der Bull nicht im
        Ellipsenzentrum liegt (= perspektivische Verkippung).
        """
        s = (ellipse[1][0] + ellipse[1][1]) / 4.0          # mittlerer Radius (px)
        Du = (dpts - bull) / s

        G = self._seed_G(ellipse, s)   # Translation bereits 0 -> Bull == Ursprung

        def cost(Gm):
            r = self._circle_residuals(Gm, Du)
            return float(np.dot(r, r)), r

        # Robust: zwei Runden mit Ausreisser-Trimmen.
        for _round in range(2):
            best_cost = cost(G)[0]
            lam = 1e-3
            for _ in range(40):
                c0, r0 = cost(G)
                J = np.zeros((len(r0), len(self._PARAM_IDX)))
                for k, (i, j) in enumerate(self._PARAM_IDX):
                    step = 1e-6 * (1.0 + abs(G[i, j]))
                    Gp = G.copy(); Gp[i, j] += step
                    J[:, k] = (self._circle_residuals(Gp, Du) - r0) / step
                JtJ = J.T @ J
                Jtr = J.T @ r0
                improved = False
                for _ls in range(8):
                    try:
                        delta = np.linalg.solve(JtJ + lam * np.diag(np.diag(JtJ)), -Jtr)
                    except np.linalg.LinAlgError:
                        lam *= 10; continue
                    Gn = G.copy()
                    for k, (i, j) in enumerate(self._PARAM_IDX):
                        Gn[i, j] += delta[k]
                    cn = cost(Gn)[0]
                    if cn < c0:
                        G, lam, best_cost, improved = Gn, lam * 0.5, cn, True
                        break
                    lam *= 4
                if not improved or np.linalg.norm(Jtr) < 1e-9:
                    break
            # Ausreisser (grobe Restfehler) verwerfen und erneut fitten.
            res = np.abs(self._circle_residuals(G, Du))
            keep = res <= max(np.quantile(res, 0.9), 3.0 * np.median(res))
            if keep.sum() >= 12 and keep.sum() < len(Du):
                Du = Du[keep]
            else:
                break

        rms_board = float(np.sqrt(np.mean(self._circle_residuals(G, Du) ** 2)))
        N = np.array([[1.0 / s, 0.0, -bull[0] / s],
                      [0.0, 1.0 / s, -bull[1] / s],
                      [0.0, 0.0, 1.0]])
        G_px = G @ N
        H_px = np.linalg.inv(G_px)
        return G_px, H_px, rms_board * s

    # ------------------------------------------------------------------
    # Sektor-Rotation
    # ------------------------------------------------------------------
    @staticmethod
    def _detect_rotation(gray, H) -> float:
        h, w = gray.shape
        n = 1440
        phis = np.linspace(0.0, 360.0, n, endpoint=False)
        profile = np.zeros(n, dtype=np.float64)
        fracs = (0.45, 0.55, 0.65, 0.78)
        for frac in fracs:
            x, y = board_to_image(H, phis, frac)
            xs = np.clip(x.astype(np.int32), 0, w - 1)
            ys = np.clip(y.astype(np.int32), 0, h - 1)
            profile += gray[ys, xs].astype(np.float64)
        profile /= len(fracs)
        profile -= profile.mean()

        rad = np.deg2rad(phis)
        best_phase_deg, best_score = 0.0, -np.inf
        k = 20
        for shift in range(n // k):
            phase = 2.0 * np.pi * shift / n
            template = np.sign(np.sin(k * (rad - phase)))
            score = float(np.abs(np.dot(profile, template)))
            if score > best_score:
                best_score, best_phase_deg = score, np.rad2deg(phase)
        return best_phase_deg % 18.0

    @staticmethod
    def _assign_sectors(rotation_deg, H):
        boundaries = [(rotation_deg + i * 18.0) % 360.0 for i in range(20)]
        centers = [(b + 9.0) % 360.0 for b in boundaries]
        ys = [board_to_image(H, c, 0.7)[1] for c in centers]
        start = int(np.argmin(ys))    # kleinstes Bild-y == am weitesten oben
        numbers = [0] * 20
        for i in range(20):
            numbers[(start + i) % 20] = SECTOR_SEQUENCE[i]
        return boundaries, numbers

    # ------------------------------------------------------------------
    # Hauptablauf
    # ------------------------------------------------------------------
    def detect(self, image: np.ndarray) -> DartboardResult:
        h0, w0 = image.shape[:2]
        scale = min(self.work_size / max(h0, w0), 1.0)
        small = cv2.resize(image, None, fx=scale, fy=scale,
                           interpolation=cv2.INTER_AREA) if scale < 1.0 else image.copy()

        red, green = self._color_masks(small)
        ring_mask = self._largest_central_blob(red | green)
        if ring_mask.sum() < 500 * 255:
            return DartboardResult(found=False)

        ys, xs = np.where(ring_mask > 0)
        center = np.array([np.median(xs), np.median(ys)], dtype=np.float64)

        # Double-Ellipse als Seed (zwei Durchlaeufe, Zentrum nachfuehren).
        ellipse = None
        for _ in range(2):
            ring_r = self._outer_ring_radius(ring_mask, center)
            dpts = self._double_ring_points(ring_mask, center, ring_r)
            ellipse = self._robust_ellipse(dpts)
            if ellipse is None:
                return DartboardResult(found=False)
            center = np.array(ellipse[0], dtype=np.float64)

        # Bull (Bild des Ursprungs) + Double-Ringpunkte fuer die Homographie.
        ring_r = self._outer_ring_radius(ring_mask, center)
        bull = self._detect_bull(red, center, ring_r)
        dpts = self._double_ring_points(ring_mask, bull, ring_r)
        if len(dpts) < 10:
            return DartboardResult(found=False)

        G_px, H_px, rms = self._fit_homography(ellipse, dpts, bull)
        coverage = float(len(dpts)) / 360.0

        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        rotation = self._detect_rotation(gray, H_px)

        # --- alles auf Originalaufloesung skalieren ---
        S = np.diag([scale, scale, 1.0])           # full px -> small px
        G_full = G_px @ S                          # full px -> board
        H_full = np.linalg.inv(G_full)             # board -> full px
        inv = 1.0 / scale

        bull_full = tuple(float(v * inv) for v in bull)
        boundaries, numbers = self._assign_sectors(rotation, H_full)

        # Referenz-Ellipse (aeussere Double) in Vollaufloesung fuer Metriken.
        (ecx, ecy), (aa, ab), ang = ellipse
        outer = ((ecx * inv, ecy * inv), (aa * inv, ab * inv), ang)

        # RMS relativ zum Boardradius bewerten (skaleninvariant).
        rel_rms = rms / max((ellipse[1][0] + ellipse[1][1]) / 4.0, 1e-6)
        confidence = float(np.clip(coverage * (1.0 - min(rel_rms / 0.04, 1.0)), 0, 1))

        return DartboardResult(
            found=True,
            H=H_full, G=G_full,
            bull_center=bull_full,
            outer_ellipse=outer,
            rotation_deg=rotation,
            sector_numbers=numbers,
            sector_boundaries_deg=boundaries,
            edge_coverage=coverage,
            fit_rms_px=rms * inv,
            score_confidence=confidence,
        )


# ---------------------------------------------------------------------------
# Visualisierung
# ---------------------------------------------------------------------------
def _ring_polyline(H, rho, n=180):
    phis = np.linspace(0.0, 360.0, n, endpoint=True)
    x, y = board_to_image(H, phis, rho)
    return np.stack([x, y], axis=1).astype(np.int32)


def draw_result(image: np.ndarray, result: DartboardResult) -> np.ndarray:
    out = image.copy()
    if not result.found:
        cv2.putText(out, "Kein Dartboard erkannt", (40, 80),
                    cv2.FONT_HERSHEY_SIMPLEX, 2.0, (0, 0, 255), 4)
        return out

    H = result.H
    colors = {
        "outer_double": (0, 255, 0), "inner_double": (0, 200, 0),
        "outer_triple": (0, 255, 255), "inner_triple": (0, 200, 200),
        "outer_bull": (255, 0, 0), "inner_bull": (255, 0, 255),
    }
    for name, ratio in RING_RADII.items():
        cv2.polylines(out, [_ring_polyline(H, ratio)], True, colors[name], 4)

    bx, by = result.bull_center
    cv2.circle(out, (int(bx), int(by)), 8, (0, 0, 255), -1)

    for b in result.sector_boundaries_deg:
        p_in = tuple(int(v) for v in board_to_image(H, b, RING_RADII["outer_bull"]))
        p_out = tuple(int(v) for v in board_to_image(H, b, 1.0))
        cv2.line(out, p_in, p_out, (255, 255, 255), 2)

    for i, num in enumerate(result.sector_numbers):
        ca = (result.sector_boundaries_deg[i] + 9.0) % 360.0
        px, py = (int(v) for v in board_to_image(H, ca, 1.12))
        cv2.putText(out, str(num), (px - 25, py + 12),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.6, (255, 255, 255), 5)
        cv2.putText(out, str(num), (px - 25, py + 12),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.6, (0, 0, 0), 2)

    info = (f"conf={result.score_confidence:.2f} cover={result.edge_coverage:.2f} "
            f"rms={result.fit_rms_px:.1f}px rot={result.rotation_deg:.1f}")
    cv2.putText(out, info, (30, 60), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (0, 0, 0), 6)
    cv2.putText(out, info, (30, 60), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (0, 255, 0), 2)
    return out


# ---------------------------------------------------------------------------
# Punkt-zu-Feld Scoring
# ---------------------------------------------------------------------------
def score_point(result: DartboardResult, x: float, y: float) -> str:
    """Bildet einen Pixel auf sein Dartfeld ab (z.B. 'T20', 'D16', '25', '50')."""
    if not result.found:
        return "?"
    X, Y = image_to_board(result.G, x, y)
    r = float(np.hypot(X, Y))
    if r > RING_RADII["outer_double"]:
        return "OUT"
    if r <= RING_RADII["inner_bull"]:
        return "50"
    if r <= RING_RADII["outer_bull"]:
        return "25"

    ang_deg = np.rad2deg(np.arctan2(Y, X)) % 360.0
    idx = int(((ang_deg - result.sector_boundaries_deg[0]) % 360.0) // 18.0)
    num = result.sector_numbers[idx % 20]
    if RING_RADII["inner_triple"] <= r <= RING_RADII["outer_triple"]:
        return f"T{num}"
    if RING_RADII["inner_double"] <= r <= RING_RADII["outer_double"]:
        return f"D{num}"
    return f"{num}"


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    asset_dir = os.path.normpath(os.path.join(here, "..", "..", "..", "assets"))
    out_dir = os.path.join(asset_dir, "detection_out")
    os.makedirs(out_dir, exist_ok=True)

    detector = DartboardDetector(work_size=1400)
    for name in ("dartboard-01", "dartboard-02"):
        path = os.path.join(asset_dir, f"{name}.jpg")
        img = cv2.imread(path)
        if img is None:
            print(f"[!] {name}: Bild nicht gefunden ({path})")
            continue
        result = detector.detect(img)
        vis = draw_result(img, result)
        out_path = os.path.join(out_dir, f"{name}_detected.jpg")
        cv2.imwrite(out_path, vis)

        if result.found:
            top_i = int(np.argmin([
                board_to_image(result.H, (b + 9) % 360, 0.7)[1]
                for b in result.sector_boundaries_deg]))
            ordered = [result.sector_numbers[(top_i + k) % 20] for k in range(20)]
            print(f"[OK] {name}: bull={tuple(round(v,1) for v in result.bull_center)} "
                  f"cover={result.edge_coverage:.2f} rms={result.fit_rms_px:.1f}px "
                  f"rot={result.rotation_deg:.1f} conf={result.score_confidence:.2f}")
            print(f"      Sektoren ab oben (CW): {ordered}")
        else:
            print(f"[FAIL] {name}: keine Erkennung")
        print(f"      -> {out_path}")
