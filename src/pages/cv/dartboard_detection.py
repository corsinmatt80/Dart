import os
import cv2
import numpy as np


def _ellipse_metrics(points, ellipse):
    if points.size == 0:
        return np.array([], dtype=np.float32), np.array([], dtype=np.float32)

    (cx, cy), (axis_a, axis_b), angle = ellipse
    if axis_a <= 1e-6 or axis_b <= 1e-6:
        return np.array([], dtype=np.float32), np.array([], dtype=np.float32)

    theta = np.deg2rad(angle)
    cos_t, sin_t = np.cos(theta), np.sin(theta)

    rel = points.astype(np.float32) - np.array([cx, cy], dtype=np.float32)
    x_rot = rel[:, 0] * cos_t + rel[:, 1] * sin_t
    y_rot = -rel[:, 0] * sin_t + rel[:, 1] * cos_t

    # Distanz in normalisierten Ellipsenkoordinaten: 1.0 liegt exakt auf der Ellipse.
    norm_radius = np.sqrt((x_rot / (axis_a / 2.0)) ** 2 + (y_rot / (axis_b / 2.0)) ** 2)
    dist_to_ellipse = np.abs(norm_radius - 1.0)

    ellipse_angle = np.arctan2(y_rot / (axis_b / 2.0), x_rot / (axis_a / 2.0))
    return dist_to_ellipse, ellipse_angle


def _sample_ellipse_with_normals(ellipse, bins):
    (cx, cy), (axis_a, axis_b), angle_deg = ellipse
    rx = max(axis_a / 2.0, 1e-6)
    ry = max(axis_b / 2.0, 1e-6)

    angle = np.deg2rad(angle_deg)
    cos_t, sin_t = np.cos(angle), np.sin(angle)

    ts = np.linspace(0.0, 2.0 * np.pi, bins, endpoint=False)
    cos_s = np.cos(ts)
    sin_s = np.sin(ts)

    x_local = rx * cos_s
    y_local = ry * sin_s

    x = cx + x_local * cos_t - y_local * sin_t
    y = cy + x_local * sin_t + y_local * cos_t
    samples = np.column_stack((x, y)).astype(np.float32)

    # Normale via Gradientenrichtung der Ellipsengleichung.
    nx_local = cos_s / rx
    ny_local = sin_s / ry
    nx = nx_local * cos_t - ny_local * sin_t
    ny = nx_local * sin_t + ny_local * cos_t
    normals = np.column_stack((nx, ny)).astype(np.float32)
    lengths = np.linalg.norm(normals, axis=1, keepdims=True)
    normals = normals / np.maximum(lengths, 1e-6)
    return samples, normals


def _fill_missing_bins(snapped_points, found_mask, base_samples, max_gap_bins=10):
    bins = len(found_mask)
    if bins == 0 or not np.any(found_mask):
        return snapped_points

    filled = snapped_points.copy()
    i = 0
    while i < bins:
        if found_mask[i]:
            i += 1
            continue

        start = i
        while i < bins and not found_mask[i]:
            i += 1
        end = i
        gap_len = end - start
        if gap_len > max_gap_bins:
            continue

        left = (start - 1) % bins
        right = end % bins
        if not found_mask[left] or not found_mask[right]:
            continue

        p_left = filled[left]
        p_right = filled[right]
        for k in range(gap_len):
            t = float(k + 1) / float(gap_len + 1)
            interp = p_left * (1.0 - t) + p_right * t
            idx = (start + k) % bins
            # Leicht zum Modellpunkt ziehen, damit gefuellte Stellen nicht driften.
            filled[idx] = interp * 0.8 + base_samples[idx] * 0.2
            found_mask[idx] = True

    return filled


def _refit_ellipse_to_edges(initial_ellipse, edges, iterations=3, bins=120):
    edge_mask = edges > 0
    h, w = edge_mask.shape[:2]
    ellipse = initial_ellipse
    coverage = 0.0
    inlier_ratio = 0.0

    for _ in range(iterations):
        samples, normals = _sample_ellipse_with_normals(ellipse, bins)
        (_, _), (axis_a, axis_b), _ = ellipse
        search_radius = int(max(6.0, min(axis_a, axis_b) * 0.04))

        snapped = samples.copy()
        found_mask = np.zeros((bins,), dtype=bool)

        for i in range(bins):
            base = samples[i]
            normal = normals[i]
            best_dist = float("inf")
            best_point = None

            for step in range(-search_radius, search_radius + 1):
                cand = base + normal * float(step)
                x = int(round(cand[0]))
                y = int(round(cand[1]))
                if x < 0 or y < 0 or x >= w or y >= h:
                    continue
                if not edge_mask[y, x]:
                    continue
                dist = abs(step)
                if dist < best_dist:
                    best_dist = dist
                    best_point = np.array([x, y], dtype=np.float32)

            if best_point is not None:
                snapped[i] = best_point
                found_mask[i] = True

        coverage = float(np.sum(found_mask)) / float(bins)
        inlier_ratio = coverage
        if np.sum(found_mask) < 12:
            break

        snapped = _fill_missing_bins(snapped, found_mask, samples, max_gap_bins=12)
        fit_points = snapped[found_mask]
        if fit_points.shape[0] < 12:
            break

        ellipse = cv2.fitEllipse(fit_points.reshape(-1, 1, 2))

    return ellipse, coverage, inlier_ratio


def detect_dartboard(image_path):
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError("Bild konnte nicht geladen werden.")

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.equalizeHist(gray)
    gray = cv2.GaussianBlur(gray, (7, 7), 1.5)

    edges = cv2.Canny(gray, 80, 180)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=2)

    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

    img_h, img_w = gray.shape[:2]
    img_area = img_h * img_w
    image_center = np.array([img_w / 2.0, img_h / 2.0])
    max_center_distance = np.hypot(img_w, img_h)

    best_ellipse = None
    best_coverage = 0.0
    best_inlier_ratio = 0.0
    best_score = float("inf")

    for cn in contours:
        if len(cn) < 5:
            continue

        area = cv2.contourArea(cn)
        if area < img_area * 0.003 or area > img_area * 0.8:
            continue

        ellipse = cv2.fitEllipse(cn)
        (cx, cy), (axis_a, axis_b), _ = ellipse
        major_axis = max(axis_a, axis_b)
        minor_axis = min(axis_a, axis_b)
        if minor_axis <= 0:
            continue

        axis_ratio = major_axis / minor_axis
        if axis_ratio > 2.2:
            continue

        ellipse_area = np.pi * (major_axis / 2.0) * (minor_axis / 2.0)
        if ellipse_area <= 0:
            continue

        area_ratio = area / ellipse_area
        if area_ratio < 0.30 or area_ratio > 1.60:
            continue

        perimeter = cv2.arcLength(cn, True)
        if perimeter <= 0:
            continue

        circularity = (4.0 * np.pi * area) / (perimeter * perimeter)
        if circularity < 0.10:
            continue

        center_distance = np.linalg.norm(np.array([cx, cy]) - image_center) / max_center_distance
        if center_distance > 0.60:
            continue

        dists, _ = _ellipse_metrics(cn.reshape(-1, 2).astype(np.float32), ellipse)
        mean_contour_dist = float(np.mean(dists)) if dists.size > 0 else 1.0

        # Kombiniert geometrische Plausibilitaet und wie gut die Ellipse den Konturverlauf trifft.
        score = (
            abs(1.0 - area_ratio) * 1.5
            + max(0.0, axis_ratio - 2.0) * 0.8
            + center_distance * 1.2
            - (area / img_area) * 0.8
            + mean_contour_dist * 4.0
        )
        if score < best_score:
            best_score = score
            best_ellipse = ellipse

    # Fallback: Wenn nichts die harten Kriterien trifft, nimm den plausibelsten großen Fit.
    if best_ellipse is None:
        for cn in contours:
            if len(cn) < 5:
                continue
            area = cv2.contourArea(cn)
            if area < img_area * 0.003 or area > img_area * 0.8:
                continue

            ellipse = cv2.fitEllipse(cn)
            (cx, cy), (axis_a, axis_b), _ = ellipse
            major_axis = max(axis_a, axis_b)
            minor_axis = min(axis_a, axis_b)
            if minor_axis <= 0:
                continue

            axis_ratio = major_axis / minor_axis
            if axis_ratio > 2.6:
                continue

            center_distance = np.linalg.norm(np.array([cx, cy]) - image_center) / max_center_distance
            score = center_distance * 1.8 - (area / img_area)
            if score < best_score:
                best_score = score
                best_ellipse = ellipse

    if best_ellipse is not None:
        refined_ellipse, coverage, inlier_ratio = _refit_ellipse_to_edges(best_ellipse, edges)
        # Auch bei teilweiser Kontur zeichnen wir die volle Ellipse, wenn genug saubere Segmente vorhanden sind.
        if coverage >= 0.08 or inlier_ratio >= 0.08:
            best_ellipse = refined_ellipse
            best_coverage = coverage
            best_inlier_ratio = inlier_ratio
        else:
            best_coverage = 0.0
            best_inlier_ratio = 0.0

    output = img.copy()

    if best_ellipse is not None:
        cv2.ellipse(output, best_ellipse, (0, 255, 0), 3)

    if best_ellipse is not None:
        (cx, cy), _, _ = best_ellipse
        cv2.circle(output, (int(cx), int(cy)), 4, (0, 255, 0), -1)

    return output, gray, edges, best_ellipse, best_coverage, best_inlier_ratio


if __name__ == "__main__":
    input_path = "../../../assets/dartboard-01.jpg"
    result, gray, edges, best_ellipse, coverage, inlier_ratio = detect_dartboard(input_path)

    directory = os.path.dirname(input_path)
    output_path = os.path.join(directory, "ellipse_result.jpg")
    output_path2 = os.path.join(directory, "gray.jpg")
    output_path3 = os.path.join(directory, "edges.jpg")

    cv2.imwrite(output_path, result)
    cv2.imwrite(output_path2, gray)
    cv2.imwrite(output_path3, edges)

    if best_ellipse is not None:
        (cx, cy), (a, b), angle = best_ellipse
        print(
            f"Ellipse gefunden: center=({cx:.1f}, {cy:.1f}), axes=({a:.1f}, {b:.1f}), angle={angle:.1f}, abdeckung={coverage:.2f}, inlier={inlier_ratio:.2f}"
        )
    else:
        print("Keine passende Ellipse gefunden.")

    print(f"Ergebnis gespeichert unter: {output_path}")
