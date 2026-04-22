import os
import cv2
import numpy as np


# Standard-WDF-Radien relativ zum äußeren Double-Ring.
DOUBLE_INNER_R = 162.0 / 170.0
TRIPLE_OUTER_R = 107.0 / 170.0
TRIPLE_INNER_R = 99.0 / 170.0
OUTER_BULL_R = 15.9 / 170.0
INNER_BULL_R = 6.35 / 170.0


def _major_minor_axis_info(ellipse):
    (cx, cy), (axis_a, axis_b), angle_deg = ellipse
    axis_a = float(axis_a)
    axis_b = float(axis_b)
    angle_deg = float(angle_deg)

    if axis_a >= axis_b:
        major_axis = axis_a
        minor_axis = axis_b
        major_angle_deg = angle_deg
    else:
        major_axis = axis_b
        minor_axis = axis_a
        major_angle_deg = angle_deg + 90.0

    major_angle_deg = (major_angle_deg + 180.0) % 180.0
    return {
        "center": (float(cx), float(cy)),
        "major_axis": float(major_axis),
        "minor_axis": float(minor_axis),
        "major_angle_deg": float(major_angle_deg),
    }


def _build_ellipse_normalization_transform(image_shape, reference_ellipse, padding_ratio=0.15):
    if reference_ellipse is None:
        return None, None, None, None

    info = _major_minor_axis_info(reference_ellipse)
    cx, cy = info["center"]
    major_axis = info["major_axis"]
    minor_axis = info["minor_axis"]
    major_angle_deg = info["major_angle_deg"]

    if major_axis <= 1e-6 or minor_axis <= 1e-6:
        return None, None, None, None

    major_radius = major_axis * 0.5
    minor_radius = minor_axis * 0.5
    axis_ratio = minor_axis / major_axis
    if axis_ratio <= 1e-6:
        return None, None, None, None

    padding = max(24.0, major_axis * float(padding_ratio))
    normalized_radius = major_radius
    normalized_center = np.array([
        normalized_radius + padding,
        normalized_radius + padding,
    ], dtype=np.float32)
    output_side = int(np.ceil((normalized_radius + padding) * 2.0))
    output_size = (output_side, output_side)

    angle_rad = np.deg2rad(major_angle_deg)
    major_dir = np.array([np.cos(angle_rad), np.sin(angle_rad)], dtype=np.float32)
    if major_dir[1] > 0.0:
        major_dir = -major_dir
    minor_dir = np.array([-major_dir[1], major_dir[0]], dtype=np.float32)
    center = np.array([cx, cy], dtype=np.float32)

    source_points = np.array(
        [
            center,
            center + major_dir * major_radius,
            center + minor_dir * minor_radius,
        ],
        dtype=np.float32,
    )
    target_points = np.array(
        [
            normalized_center,
            normalized_center + np.array([0.0, -normalized_radius], dtype=np.float32),
            normalized_center + np.array([normalized_radius, 0.0], dtype=np.float32),
        ],
        dtype=np.float32,
    )

    matrix = cv2.getAffineTransform(source_points, target_points)
    inverse_matrix = cv2.getAffineTransform(target_points, source_points)
    return matrix, inverse_matrix, output_size, (float(normalized_center[0]), float(normalized_center[1]))


def _transform_points(points, matrix):
    pts = np.asarray(points, dtype=np.float32)
    if pts.ndim == 1:
        pts = pts.reshape(1, 2)
    if pts.size == 0:
        return np.empty((0, 2), dtype=np.float32)

    ones = np.ones((pts.shape[0], 1), dtype=np.float32)
    homogeneous = np.hstack((pts, ones))
    transformed = homogeneous @ matrix.astype(np.float32).T
    return transformed.astype(np.float32)


def _ellipse_projection_geometry(reference_ellipse):
    if reference_ellipse is None:
        return None

    info = _major_minor_axis_info(reference_ellipse)
    major_axis = info["major_axis"]
    minor_axis = info["minor_axis"]
    major_angle_deg = info["major_angle_deg"]
    axis_ratio = float(minor_axis / major_axis) if major_axis > 1e-6 else 0.0
    axis_ratio = float(np.clip(axis_ratio, 0.0, 1.0))

    # ω: clockwise from vertical. OpenCV-Winkel ist entlang +x; wegen Bildkoordinaten (y nach unten)
    # entspricht ein visueller Uhrzeigersinnwinkel von der Vertikalen näherungsweise 90° - major_angle.
    tilt_from_vertical_deg = ((90.0 - major_angle_deg + 90.0) % 180.0) - 90.0
    gamma_deg = float(np.degrees(np.arccos(np.clip(axis_ratio, -1.0, 1.0))))

    return {
        **info,
        "axis_ratio": axis_ratio,
        "tilt_from_vertical_deg": float(tilt_from_vertical_deg),
        "rectification_scale": float(1.0 / max(axis_ratio, 1e-6)),
        "view_angle_gamma_deg": gamma_deg,
    }


def _build_edge_distance_map(gray_image):
    blur = cv2.GaussianBlur(gray_image, (5, 5), 0.8)
    edges = cv2.Canny(blur, 60, 160)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=1)
    distance = cv2.distanceTransform((255 - edges).astype(np.uint8), cv2.DIST_L2, 3)
    return edges, distance.astype(np.float32)


def _score_ring_alignment(distance_map, center_xy, radius, tolerance, angles):
    cx, cy = center_xy
    xs = np.rint(cx + radius * np.cos(angles)).astype(np.int32)
    ys = np.rint(cy + radius * np.sin(angles)).astype(np.int32)

    height, width = distance_map.shape[:2]
    valid = (xs >= 0) & (ys >= 0) & (xs < width) & (ys < height)
    if not np.any(valid):
        return 0.0

    distances = distance_map[ys[valid], xs[valid]]
    closeness = np.clip(1.0 - distances / max(tolerance, 1e-6), 0.0, 1.0)
    return float(np.mean(closeness))


def _estimate_bull_center_in_normalized_image(normalized_gray, reference_center, outer_radius):
    edges, distance_map = _build_edge_distance_map(normalized_gray)
    detect_dartboard.last_normalization_edges = edges

    angles = np.linspace(0.0, 2.0 * np.pi, 180, endpoint=False, dtype=np.float32)
    search_radius = int(max(10.0, outer_radius * 0.12))
    tolerance = float(max(3.0, outer_radius * 0.012))
    candidate_rings = (
        (OUTER_BULL_R, 3.0),
        (INNER_BULL_R, 3.5),
        (TRIPLE_INNER_R, 1.2),
        (TRIPLE_OUTER_R, 1.2),
        (DOUBLE_INNER_R, 0.8),
    )

    def candidate_score(center_xy):
        score = 0.0
        weight_sum = 0.0
        for ring_ratio, weight in candidate_rings:
            ring_radius = float(outer_radius * ring_ratio)
            ring_score = _score_ring_alignment(distance_map, center_xy, ring_radius, tolerance, angles)
            score += ring_score * weight
            weight_sum += weight

        offset_penalty = np.hypot(center_xy[0] - reference_center[0], center_xy[1] - reference_center[1]) / max(search_radius, 1)
        return (score / max(weight_sum, 1e-6)) - offset_penalty * 0.08

    best_center = (float(reference_center[0]), float(reference_center[1]))
    best_score = candidate_score(best_center)

    coarse_step = max(2, search_radius // 10)
    for step, radius in ((coarse_step, search_radius), (2, max(6, coarse_step * 3)), (1, 3)):
        current_best = best_center
        current_score = best_score
        for dy in range(-radius, radius + 1, step):
            for dx in range(-radius, radius + 1, step):
                candidate = (best_center[0] + dx, best_center[1] + dy)
                score = candidate_score(candidate)
                if score > current_score:
                    current_best = candidate
                    current_score = score

        best_center = current_best
        best_score = current_score

    return (float(best_center[0]), float(best_center[1])), float(best_score), edges


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
    lengths = np.linalg.norm(normals, axis=1, keepdims=True).astype(np.float32)
    normals = normals / np.clip(lengths, 1e-6, None)
    return samples, normals


def _fill_missing_bins(snapped_points, found_mask, base_samples, max_gap_bins=10):
    bins = int(len(found_mask))
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
        search_radius = int(max(6.0, float(min(float(axis_a), float(axis_b))) * 0.04))

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
    detect_dartboard.last_normalization = None
    detect_dartboard.last_normalization_edges = None

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
        major_axis = float(max(float(axis_a), float(axis_b)))
        minor_axis = float(min(float(axis_a), float(axis_b)))
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
            major_axis = float(max(float(axis_a), float(axis_b)))
            minor_axis = float(min(float(axis_a), float(axis_b)))
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

        matrix, inverse_matrix, output_size, normalized_center = _build_ellipse_normalization_transform(
            img.shape,
            best_ellipse,
        )
        projection_geometry = _ellipse_projection_geometry(best_ellipse)

        if matrix is not None and inverse_matrix is not None and output_size is not None and normalized_center is not None:
            normalized_image = cv2.warpAffine(
                img,
                matrix,
                output_size,
                flags=cv2.INTER_LINEAR,
                borderMode=cv2.BORDER_CONSTANT,
                borderValue=(0, 0, 0),
            )
            normalized_gray = cv2.warpAffine(
                gray,
                matrix,
                output_size,
                flags=cv2.INTER_LINEAR,
                borderMode=cv2.BORDER_CONSTANT,
                borderValue=0,
            )

            normalized_marker = normalized_image.copy()
            outer_radius = projection_geometry["major_axis"] * 0.5 if projection_geometry is not None else max(output_size) * 0.25
            bull_center_normalized, bull_score, normalized_edges = _estimate_bull_center_in_normalized_image(
                normalized_gray,
                normalized_center,
                outer_radius,
            )
            bull_center_xy = np.array([bull_center_normalized], dtype=np.float32)
            cv2.circle(
                normalized_marker,
                (int(round(bull_center_normalized[0])), int(round(bull_center_normalized[1]))),
                6,
                (255, 0, 0),
                -1,
            )

            back_transformed_center = _transform_points(bull_center_xy, inverse_matrix)[0]
            back_center_xy = (
                int(round(float(back_transformed_center[0]))),
                int(round(float(back_transformed_center[1]))),
            )
            cv2.circle(output, back_center_xy, 6, (255, 0, 0), -1)

            detect_dartboard.last_normalization = {
                "matrix": matrix,
                "inverse_matrix": inverse_matrix,
                "output_size": output_size,
                "normalized_center": normalized_center,
                "bull_center_normalized": bull_center_normalized,
                "normalized_image": normalized_marker,
                "normalized_edges": normalized_edges,
                "back_transformed_center": (
                    float(back_transformed_center[0]),
                    float(back_transformed_center[1]),
                ),
                "bull_score": bull_score,
                "projection_geometry": projection_geometry,
            }

    return output, gray, edges, best_ellipse, best_coverage, best_inlier_ratio


if __name__ == "__main__":
    input_path = "../../../assets/dartboard-02.jpg"
    result, gray, edges, best_ellipse, coverage, inlier_ratio = detect_dartboard(input_path)

    directory = os.path.dirname(input_path)
    output_path = os.path.join(directory, "ellipse_result.jpg")
    output_path_normalized = os.path.join(directory, "ellipse_normalized.jpg")
    output_path2 = os.path.join(directory, "gray.jpg")
    output_path3 = os.path.join(directory, "edges.jpg")

    cv2.imwrite(output_path, result)
    if detect_dartboard.last_normalization is not None:
        cv2.imwrite(output_path_normalized, detect_dartboard.last_normalization["normalized_image"])
    cv2.imwrite(output_path2, gray)
    cv2.imwrite(output_path3, edges)

    if best_ellipse is not None:
        (cx, cy), (a, b), angle = best_ellipse
        projection_geometry = detect_dartboard.last_normalization["projection_geometry"] if detect_dartboard.last_normalization else None
        print(
            f"Ellipse gefunden: center=({cx:.1f}, {cy:.1f}), axes=({a:.1f}, {b:.1f}), angle={angle:.1f}, abdeckung={coverage:.2f}, inlier={inlier_ratio:.2f}"
        )
        if projection_geometry is not None:
            print(
                "Normalisierung: "
                f"k={projection_geometry['axis_ratio']:.4f}, "
                f"omega={projection_geometry['tilt_from_vertical_deg']:.2f} deg, "
                f"gamma=+-{projection_geometry['view_angle_gamma_deg']:.2f} deg, "
                f"Stretch={projection_geometry['rectification_scale']:.3f}x"
            )
    else:
        print("Keine passende Ellipse gefunden.")

    print(f"Ergebnis gespeichert unter: {output_path}")


detect_dartboard.last_normalization = None


