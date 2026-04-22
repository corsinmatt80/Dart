import os
import cv2
import numpy as np


# Standard-WDF-Radien relativ zum äußeren Double-Ring.
DOUBLE_INNER_R = 160.0 / 170.0
TRIPLE_OUTER_R = 107.0 / 170.0
TRIPLE_INNER_R = 96.0 / 170.0
OUTER_BULL_R = 15.9 / 170.0
INNER_BULL_R = 6.35 / 170
SECTOR_COUNT = 20
SEPARATOR_LINE_COLOR = (255, 255, 0)
SEPARATOR_LINE_THICKNESS = 2
STANDARD_SECTOR_VALUES = (20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5)
FIELD_LABEL_COLOR = (255, 255, 255)
FIELD_LABEL_OUTLINE_COLOR = (0, 0, 0)


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
    axis_ratio = float(minor_axis / max(major_axis, 1e-6))
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


def _affine_matrix_to_homography(matrix):
    homography = np.eye(3, dtype=np.float32)
    homography[:2, :] = np.asarray(matrix, dtype=np.float32)
    return homography


def _transform_points(points, matrix):
    pts = np.asarray(points, dtype=np.float32)
    if pts.ndim == 1:
        pts = pts.reshape(1, 2)
    if pts.size == 0:
        return np.empty((0, 2), dtype=np.float32)

    matrix = np.asarray(matrix, dtype=np.float32)
    ones = np.ones((pts.shape[0], 1), dtype=np.float32)
    homogeneous = np.hstack((pts, ones))

    if matrix.shape == (2, 3):
        transformed = homogeneous @ matrix.T
        return transformed.astype(np.float32)

    if matrix.shape == (3, 3):
        transformed = homogeneous @ matrix.T
        scale = np.clip(transformed[:, 2:3], 1e-6, None)
        return (transformed[:, :2] / scale).astype(np.float32)

    raise ValueError("Transformationsmatrix muss 2x3 oder 3x3 sein.")


def _sample_ellipse_points(ellipse, point_count=180):
    samples, _ = _sample_ellipse_with_normals(ellipse, point_count)
    return samples.astype(np.float32)


def _ellipse_to_conic_matrix(ellipse):
    (cx, cy), (axis_a, axis_b), angle_deg = ellipse
    rx = float(axis_a) * 0.5
    ry = float(axis_b) * 0.5
    if rx <= 1e-6 or ry <= 1e-6:
        return None

    angle = np.deg2rad(float(angle_deg))
    cos_t = np.cos(angle)
    sin_t = np.sin(angle)
    transform = np.array(
        [
            [rx * cos_t, -ry * sin_t, cx],
            [rx * sin_t, ry * cos_t, cy],
            [0.0, 0.0, 1.0],
        ],
        dtype=np.float64,
    )
    inverse_transform = np.linalg.inv(transform)
    unit_circle = np.diag([1.0, 1.0, -1.0]).astype(np.float64)
    conic = inverse_transform.T @ unit_circle @ inverse_transform
    return ((conic + conic.T) * 0.5).astype(np.float64)


def _fit_ellipse_to_points(points):
    pts = np.asarray(points, dtype=np.float32)
    if pts.ndim == 1:
        pts = pts.reshape(1, 2)
    if pts.shape[0] < 5:
        return None
    return cv2.fitEllipse(pts.reshape(-1, 1, 2))


def _build_planar_rectification_homography(image_shape, reference_ellipse, board_center, padding_ratio=0.15, point_count=360):
    if reference_ellipse is None or board_center is None:
        return None

    center_xy = np.asarray(board_center, dtype=np.float64).reshape(2)
    conic = _ellipse_to_conic_matrix(reference_ellipse)
    if conic is None:
        return None

    center_h = np.array([center_xy[0], center_xy[1], 1.0], dtype=np.float64)
    vanishing_line = conic @ center_h
    if not np.all(np.isfinite(vanishing_line)):
        return None

    if np.linalg.norm(vanishing_line[:2]) <= 1e-8:
        projective_rectification = np.eye(3, dtype=np.float32)
    else:
        if abs(vanishing_line[2]) <= 1e-8:
            return None
        projective_rectification = np.array(
            [
                [1.0, 0.0, 0.0],
                [0.0, 1.0, 0.0],
                [vanishing_line[0] / vanishing_line[2], vanishing_line[1] / vanishing_line[2], 1.0],
            ],
            dtype=np.float32,
        )

    outer_ring_points = _sample_ellipse_points(reference_ellipse, point_count=point_count)
    affine_rectified_points = _transform_points(outer_ring_points, projective_rectification)
    affine_rectified_ellipse = _fit_ellipse_to_points(affine_rectified_points)
    if affine_rectified_ellipse is None:
        return None

    affine_matrix, _, output_size, normalized_center = _build_ellipse_normalization_transform(
        image_shape,
        affine_rectified_ellipse,
        padding_ratio=padding_ratio,
    )
    if affine_matrix is None or output_size is None or normalized_center is None:
        return None

    affine_homography = _affine_matrix_to_homography(affine_matrix)
    homography = affine_homography @ projective_rectification
    if not np.all(np.isfinite(homography)):
        return None

    try:
        inverse_homography = np.linalg.inv(homography).astype(np.float32)
    except np.linalg.LinAlgError:
        return None

    rectified_outer_points = _transform_points(outer_ring_points, homography)
    rectified_outer_ellipse = _fit_ellipse_to_points(rectified_outer_points)
    if rectified_outer_ellipse is None:
        return None

    (_, _), (axis_a, axis_b), _ = rectified_outer_ellipse
    outer_radius = float(axis_a + axis_b) * 0.25
    if outer_radius <= 1e-6:
        return None

    axis_ratio = min(float(axis_a), float(axis_b)) / max(float(axis_a), float(axis_b), 1e-6)

    return {
        "matrix": homography.astype(np.float32),
        "inverse_matrix": inverse_homography,
        "output_size": output_size,
        "normalized_center": (float(normalized_center[0]), float(normalized_center[1])),
        "outer_radius": outer_radius,
        "vanishing_line": vanishing_line.astype(np.float32),
        "projective_matrix": projective_rectification,
        "affine_matrix": affine_homography,
        "rectified_outer_ellipse": rectified_outer_ellipse,
        "rectified_outer_axis_ratio": float(axis_ratio),
    }


def _sample_circle_points(center_xy, radius, point_count=360):
    if radius <= 0.0:
        return np.empty((0, 2), dtype=np.float32)

    angles = np.linspace(0.0, 2.0 * np.pi, point_count, endpoint=False, dtype=np.float32)
    center_xy = np.asarray(center_xy, dtype=np.float32).reshape(2)
    x = center_xy[0] + np.cos(angles) * float(radius)
    y = center_xy[1] + np.sin(angles) * float(radius)
    return np.column_stack((x, y)).astype(np.float32)


def _build_projected_ring_boundaries(rectified_center, outer_radius, inverse_homography, point_count=360):
    ring_ratios = {
        "double_outer": 1.0,
        "double_inner": DOUBLE_INNER_R,
        "triple_outer": TRIPLE_OUTER_R,
        "triple_inner": TRIPLE_INNER_R,
        "outer_bull": OUTER_BULL_R,
        "inner_bull": INNER_BULL_R,
    }
    rectified_boundaries = {}
    image_boundaries = {}

    for ring_name, ring_ratio in ring_ratios.items():
        rectified_points = _sample_circle_points(rectified_center, outer_radius * float(ring_ratio), point_count=point_count)
        rectified_boundaries[ring_name] = rectified_points
        image_boundaries[ring_name] = _transform_points(rectified_points, inverse_homography)

    return rectified_boundaries, image_boundaries


def _draw_projected_polyline(image, points, color, thickness):
    pts = np.asarray(points, dtype=np.float32)
    if pts.ndim != 2 or pts.shape[0] < 2:
        return

    polyline = np.rint(pts).astype(np.int32).reshape(-1, 1, 2)
    cv2.polylines(image, [polyline], True, color, thickness, lineType=cv2.LINE_AA)


def _draw_projected_segment(image, points, color, thickness):
    pts = np.asarray(points, dtype=np.float32)
    if pts.ndim != 2 or pts.shape[0] < 2:
        return

    line = np.rint(pts[:2]).astype(np.int32)
    cv2.line(image, tuple(line[0]), tuple(line[1]), color, thickness, lineType=cv2.LINE_AA)


def _draw_centered_text(image, text, center_xy, font_scale, color, outline_color=FIELD_LABEL_OUTLINE_COLOR, thickness=1):
    if image is None or text is None or len(str(text)) == 0:
        return

    h, w = image.shape[:2]
    center_xy = np.asarray(center_xy, dtype=np.float32).reshape(2)
    x = int(round(float(center_xy[0])))
    y = int(round(float(center_xy[1])))
    if x < 0 or y < 0 or x >= w or y >= h:
        return

    font_scale = float(max(0.2, font_scale))
    thickness = int(max(1, thickness))
    font_face = cv2.FONT_HERSHEY_SIMPLEX
    text = str(text)
    (text_w, text_h), baseline = cv2.getTextSize(text, font_face, font_scale, thickness)
    origin = (
        int(round(float(center_xy[0]) - text_w * 0.5)),
        int(round(float(center_xy[1]) + text_h * 0.5)),
    )
    outline_thickness = thickness + 2
    cv2.putText(image, text, origin, font_face, font_scale, outline_color, outline_thickness, lineType=cv2.LINE_AA)
    cv2.putText(image, text, origin, font_face, font_scale, color, thickness, lineType=cv2.LINE_AA)


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


def _score_sector_boundary_alignment(edge_image, center_xy, angle_rad, start_radius, end_radius, radial_step=1.5, lateral_tolerance=2):
    if edge_image is None or end_radius <= start_radius:
        return 0.0

    h, w = edge_image.shape[:2]
    if h == 0 or w == 0:
        return 0.0

    center_xy = np.asarray(center_xy, dtype=np.float32).reshape(2)
    direction = np.array([np.cos(angle_rad), np.sin(angle_rad)], dtype=np.float32)
    normal = np.array([-direction[1], direction[0]], dtype=np.float32)
    radii = np.arange(start_radius, end_radius + radial_step, radial_step, dtype=np.float32)
    if radii.size == 0:
        return 0.0

    hit_mask = np.zeros((radii.shape[0],), dtype=np.float32)
    for idx, radius in enumerate(radii):
        base = center_xy + direction * float(radius)
        for offset in range(-lateral_tolerance, lateral_tolerance + 1):
            point = base + normal * float(offset)
            x = int(round(float(point[0])))
            y = int(round(float(point[1])))
            if x < 0 or y < 0 or x >= w or y >= h:
                continue
            if edge_image[y, x] > 0:
                hit_mask[idx] = 1.0
                break

    if not np.any(hit_mask):
        return 0.0

    longest_run = 0
    current_run = 0
    for hit in hit_mask:
        if hit > 0.0:
            current_run += 1
            longest_run = max(longest_run, current_run)
        else:
            current_run = 0

    occupancy = float(np.mean(hit_mask))
    continuity = float(longest_run) / float(hit_mask.shape[0])
    return occupancy * 0.6 + continuity * 0.4


def _build_sector_boundary_angle_response(normalized_edges, center_xy, outer_radius, angular_step_deg=0.25):
    if normalized_edges is None or center_xy is None or outer_radius <= 0.0:
        return np.array([], dtype=np.float32), np.array([], dtype=np.float32)

    start_radius = float(max(outer_radius * OUTER_BULL_R + 2.0, outer_radius * 0.10))
    end_radius = float(max(start_radius + 12.0, outer_radius - 3.0))
    if end_radius <= start_radius:
        return np.array([], dtype=np.float32), np.array([], dtype=np.float32)

    center_xy = np.asarray(center_xy, dtype=np.float32).reshape(2)
    radial_values = np.arange(start_radius, end_radius + 1.0, 1.0, dtype=np.float32)
    angle_values_deg = np.arange(0.0, 360.0, angular_step_deg, dtype=np.float32)
    angle_values_rad = np.deg2rad(angle_values_deg)
    if radial_values.size == 0 or angle_values_deg.size == 0:
        return np.array([], dtype=np.float32), np.array([], dtype=np.float32)

    map_x = center_xy[0] + np.cos(angle_values_rad)[None, :] * radial_values[:, None]
    map_y = center_xy[1] + np.sin(angle_values_rad)[None, :] * radial_values[:, None]
    polar_edges = cv2.remap(
        normalized_edges,
        map_x.astype(np.float32),
        map_y.astype(np.float32),
        interpolation=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=0,
    )

    polar_edges = cv2.dilate(
        polar_edges,
        cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)),
        iterations=1,
    )
    polar_edges = cv2.morphologyEx(
        polar_edges,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_RECT, (1, 9)),
        iterations=1,
    )
    vertical_kernel_height = max(9, int(round(polar_edges.shape[0] * 0.12)))
    sector_verticals = cv2.morphologyEx(
        polar_edges,
        cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_RECT, (1, vertical_kernel_height)),
        iterations=1,
    )
    sector_verticals = cv2.morphologyEx(
        sector_verticals,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_RECT, (9, 1)),
        iterations=1,
    )

    response = np.mean(sector_verticals.astype(np.float32) / 255.0, axis=0)
    padded = np.concatenate((response[-6:], response, response[:6]))
    smoothed = np.convolve(padded, np.ones((13,), dtype=np.float32) / 13.0, mode="same")
    response = smoothed[6:-6].astype(np.float32)
    return angle_values_deg, response


def _detect_sector_boundary_angles(normalized_edges, center_xy, outer_radius, sector_count=SECTOR_COUNT):
    if normalized_edges is None or center_xy is None or outer_radius <= 0.0 or sector_count <= 0:
        return np.array([], dtype=np.float32), np.array([], dtype=np.float32)

    sector_step_deg = 360.0 / float(sector_count)
    angle_values_deg, angle_response = _build_sector_boundary_angle_response(
        normalized_edges,
        center_xy,
        outer_radius,
    )
    if angle_values_deg.size == 0 or angle_response.size == 0:
        return np.array([], dtype=np.float32), np.array([], dtype=np.float32)

    angular_step_deg = float(angle_values_deg[1] - angle_values_deg[0]) if angle_values_deg.size > 1 else 0.25

    def response_at(angle_deg):
        wrapped_angle = float(angle_deg) % 360.0
        sample_index = wrapped_angle / angular_step_deg
        left_index = int(np.floor(sample_index)) % angle_response.shape[0]
        right_index = (left_index + 1) % angle_response.shape[0]
        mix = float(sample_index - np.floor(sample_index))
        return float(angle_response[left_index] * (1.0 - mix) + angle_response[right_index] * mix)

    coarse_offsets = np.arange(0.0, sector_step_deg, angular_step_deg, dtype=np.float32)
    best_offset_deg = 0.0
    best_offset_score = -1.0
    for offset_deg in coarse_offsets:
        score = sum(response_at(float(offset_deg + sector_index * sector_step_deg)) for sector_index in range(sector_count))
        if score > best_offset_score:
            best_offset_score = score
            best_offset_deg = float(offset_deg)

    boundary_angles = []
    boundary_scores = []
    for sector_index in range(sector_count):
        base_angle_deg = best_offset_deg + sector_index * sector_step_deg
        local_angles = np.arange(base_angle_deg - 4.0, base_angle_deg + 4.01, angular_step_deg, dtype=np.float32)
        local_scores = np.array([response_at(float(candidate_angle_deg)) for candidate_angle_deg in local_angles], dtype=np.float32)
        peak_score = float(np.max(local_scores)) if local_scores.size > 0 else 0.0
        support_mask = local_scores >= peak_score * 0.65
        if not np.any(support_mask):
            support_mask = local_scores == np.max(local_scores)

        support_angles_rad = np.deg2rad(local_angles[support_mask])
        support_weights = np.clip(local_scores[support_mask], 1e-6, None)
        mean_vector = np.array(
            [
                np.sum(np.cos(support_angles_rad) * support_weights),
                np.sum(np.sin(support_angles_rad) * support_weights),
            ],
            dtype=np.float64,
        )
        best_angle_deg = float(np.degrees(np.arctan2(mean_vector[1], mean_vector[0])) % 360.0)
        boundary_angles.append(best_angle_deg)
        boundary_scores.append(peak_score)

    order = np.argsort(np.asarray(boundary_angles, dtype=np.float32))
    return (
        np.asarray(boundary_angles, dtype=np.float32)[order],
        np.asarray(boundary_scores, dtype=np.float32)[order],
    )


def _build_projected_sector_boundaries(rectified_center, outer_radius, boundary_angles_deg, inverse_homography, inner_ratio=OUTER_BULL_R, outer_ratio=1.0):
    if boundary_angles_deg is None:
        return [], []

    center_xy = np.asarray(rectified_center, dtype=np.float32).reshape(2)
    inner_radius = float(max(0.0, outer_radius * float(inner_ratio)))
    outer_radius = float(max(inner_radius, outer_radius * float(outer_ratio)))
    rectified_boundaries = []
    image_boundaries = []

    for angle_deg in np.asarray(boundary_angles_deg, dtype=np.float32):
        angle_rad = np.deg2rad(float(angle_deg))
        direction = np.array([np.cos(angle_rad), np.sin(angle_rad)], dtype=np.float32)
        rectified_segment = np.vstack(
            (
                center_xy + direction * inner_radius,
                center_xy + direction * outer_radius,
            )
        ).astype(np.float32)
        rectified_boundaries.append(rectified_segment)
        image_boundaries.append(_transform_points(rectified_segment, inverse_homography))

    return rectified_boundaries, image_boundaries


def _sector_mid_angles_from_boundaries(boundary_angles_deg):
    boundaries = np.sort(np.asarray(boundary_angles_deg, dtype=np.float32) % 360.0)
    if boundaries.size == 0:
        return np.array([], dtype=np.float32)

    next_boundaries = np.roll(boundaries, -1)
    deltas = (next_boundaries - boundaries) % 360.0
    return (boundaries + deltas * 0.5) % 360.0


def _find_top_sector_index(mid_angles_deg, rectified_center=None, outer_radius=None, inverse_homography=None, top_angle_deg=270.0):
    mid_angles_deg = np.asarray(mid_angles_deg, dtype=np.float32)
    if mid_angles_deg.size == 0:
        return None

    if rectified_center is not None and outer_radius is not None and inverse_homography is not None and outer_radius > 0.0:
        rectified_center = np.asarray(rectified_center, dtype=np.float32).reshape(2)
        probe_radius_ratios = (
            0.5 * (DOUBLE_INNER_R + 1.0),
            0.5 * (TRIPLE_OUTER_R + DOUBLE_INNER_R),
            0.5 * (TRIPLE_INNER_R + TRIPLE_OUTER_R),
            0.5 * (OUTER_BULL_R + TRIPLE_INNER_R),
        )

        vertical_scores = []
        for mid_angle_deg in mid_angles_deg:
            angle_rad = np.deg2rad(float(mid_angle_deg))
            direction = np.array([np.cos(angle_rad), np.sin(angle_rad)], dtype=np.float32)
            projected_ys = []
            for radius_ratio in probe_radius_ratios:
                rectified_anchor = rectified_center + direction * float(outer_radius * radius_ratio)
                image_anchor = _transform_points(np.array([rectified_anchor], dtype=np.float32), inverse_homography)[0]
                projected_ys.append(float(image_anchor[1]))

            vertical_scores.append(float(np.mean(projected_ys)))

        return int(np.argmin(np.asarray(vertical_scores, dtype=np.float32)))

    wrapped_distance = np.abs(((mid_angles_deg - float(top_angle_deg) + 180.0) % 360.0) - 180.0)
    return int(np.argmin(wrapped_distance))


def _build_field_labels(rectified_center, outer_radius, boundary_angles_deg, inverse_homography):
    mid_angles_deg = _sector_mid_angles_from_boundaries(boundary_angles_deg)
    if mid_angles_deg.size == 0 or outer_radius <= 0.0:
        return [], []

    rectified_center = np.asarray(rectified_center, dtype=np.float32).reshape(2)
    top_sector_index = _find_top_sector_index(
        mid_angles_deg,
        rectified_center=rectified_center,
        outer_radius=outer_radius,
        inverse_homography=inverse_homography,
    )
    if top_sector_index is None:
        return [], []

    ordered_sector_values = [None] * mid_angles_deg.shape[0]
    for index, sector_value in enumerate(STANDARD_SECTOR_VALUES[: mid_angles_deg.shape[0]]):
        ordered_sector_values[(top_sector_index + index) % mid_angles_deg.shape[0]] = int(sector_value)

    ring_definitions = (
        ("double", 0.5 * (DOUBLE_INNER_R + 1.0), lambda value: value * 2, 0.70),
        ("single_outer", 0.5 * (TRIPLE_OUTER_R + DOUBLE_INNER_R), lambda value: value, 0.78),
        ("triple", 0.5 * (TRIPLE_INNER_R + TRIPLE_OUTER_R), lambda value: value * 3, 0.66),
        ("single_inner", 0.5 * (OUTER_BULL_R + TRIPLE_INNER_R), lambda value: value, 0.72),
    )

    rectified_labels = []
    image_labels = []
    for sector_index, (mid_angle_deg, sector_value) in enumerate(zip(mid_angles_deg, ordered_sector_values)):
        if sector_value is None:
            continue
        direction = np.array(
            [
                np.cos(np.deg2rad(float(mid_angle_deg))),
                np.sin(np.deg2rad(float(mid_angle_deg))),
            ],
            dtype=np.float32,
        )
        for ring_name, radius_ratio, score_fn, font_factor in ring_definitions:
            rectified_anchor = rectified_center + direction * float(outer_radius * radius_ratio)
            score = int(score_fn(sector_value))
            label = {
                "text": str(score),
                "score": score,
                "sector_value": int(sector_value),
                "ring_name": ring_name,
                "sector_index": int(sector_index),
                "angle_deg": float(mid_angle_deg),
                "font_scale_factor": float(font_factor),
                "rectified_anchor": (float(rectified_anchor[0]), float(rectified_anchor[1])),
            }
            rectified_labels.append(label)

            image_anchor = _transform_points(np.array([rectified_anchor], dtype=np.float32), inverse_homography)[0]
            image_labels.append(
                {
                    **label,
                    "image_anchor": (float(image_anchor[0]), float(image_anchor[1])),
                }
            )

    bull_labels_rectified = (
        {
            "text": "25",
            "score": 25,
            "sector_value": 25,
            "ring_name": "outer_bull",
            "sector_index": -1,
            "angle_deg": 315.0,
            "font_scale_factor": 0.72,
            "rectified_anchor": (
                float(rectified_center[0] + np.cos(np.deg2rad(315.0)) * outer_radius * ((INNER_BULL_R + OUTER_BULL_R) * 0.5)),
                float(rectified_center[1] + np.sin(np.deg2rad(315.0)) * outer_radius * ((INNER_BULL_R + OUTER_BULL_R) * 0.5)),
            ),
        },
        {
            "text": "50",
            "score": 50,
            "sector_value": 50,
            "ring_name": "inner_bull",
            "sector_index": -1,
            "angle_deg": 0.0,
            "font_scale_factor": 0.80,
            "rectified_anchor": (float(rectified_center[0]), float(rectified_center[1])),
        },
    )

    for label in bull_labels_rectified:
        rectified_labels.append(label)
        image_anchor = _transform_points(
            np.array([label["rectified_anchor"]], dtype=np.float32),
            inverse_homography,
        )[0]
        image_labels.append(
            {
                **label,
                "image_anchor": (float(image_anchor[0]), float(image_anchor[1])),
            }
        )

    return rectified_labels, image_labels


def _draw_field_labels(image, labels, outer_radius, anchor_key, base_scale_divisor=520.0):
    if image is None or labels is None or outer_radius <= 0.0:
        return

    base_font_scale = float(np.clip(outer_radius / float(base_scale_divisor), 0.35, 1.8))
    for label in labels:
        anchor = label.get(anchor_key)
        if anchor is None:
            continue
        font_scale = base_font_scale * float(label.get("font_scale_factor", 1.0))
        thickness = 1 if font_scale < 0.9 else 2
        _draw_centered_text(
            image,
            label.get("text", ""),
            anchor,
            font_scale,
            FIELD_LABEL_COLOR,
            outline_color=FIELD_LABEL_OUTLINE_COLOR,
            thickness=thickness,
        )


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

        initial_matrix, initial_inverse_matrix, initial_output_size, initial_normalized_center = _build_ellipse_normalization_transform(
            img.shape,
            best_ellipse,
        )
        projection_geometry = _ellipse_projection_geometry(best_ellipse)

        approx_board_center = np.array(best_ellipse[0], dtype=np.float32)
        approx_bull_score = None
        if (
            initial_matrix is not None
            and initial_inverse_matrix is not None
            and initial_output_size is not None
            and initial_normalized_center is not None
        ):
            initial_normalized_gray = cv2.warpAffine(
                gray,
                initial_matrix,
                initial_output_size,
                flags=cv2.INTER_LINEAR,
                borderMode=cv2.BORDER_CONSTANT,
                borderValue=0,
            )
            initial_outer_radius = projection_geometry["major_axis"] * 0.5 if projection_geometry is not None else max(initial_output_size) * 0.25
            approx_bull_normalized, approx_bull_score, _ = _estimate_bull_center_in_normalized_image(
                initial_normalized_gray,
                initial_normalized_center,
                initial_outer_radius,
            )
            approx_board_center = _transform_points(
                np.array([approx_bull_normalized], dtype=np.float32),
                initial_inverse_matrix,
            )[0]

        rectification = _build_planar_rectification_homography(
            img.shape,
            best_ellipse,
            approx_board_center,
        )

        if rectification is not None:
            refined_rectification = rectification
            for _ in range(2):
                normalized_gray = cv2.warpPerspective(
                    gray,
                    refined_rectification["matrix"],
                    refined_rectification["output_size"],
                    flags=cv2.INTER_LINEAR,
                    borderMode=cv2.BORDER_CONSTANT,
                    borderValue=0,
                )
                normalized_image = cv2.warpPerspective(
                    img,
                    refined_rectification["matrix"],
                    refined_rectification["output_size"],
                    flags=cv2.INTER_LINEAR,
                    borderMode=cv2.BORDER_CONSTANT,
                    borderValue=(0, 0, 0),
                )

                bull_center_normalized, bull_score, normalized_edges = _estimate_bull_center_in_normalized_image(
                    normalized_gray,
                    refined_rectification["normalized_center"],
                    refined_rectification["outer_radius"],
                )
                back_transformed_center = _transform_points(
                    np.array([bull_center_normalized], dtype=np.float32),
                    refined_rectification["inverse_matrix"],
                )[0]
                next_rectification = _build_planar_rectification_homography(
                    img.shape,
                    best_ellipse,
                    back_transformed_center,
                )
                if next_rectification is None:
                    break
                refined_rectification = next_rectification

            normalized_gray = cv2.warpPerspective(
                gray,
                refined_rectification["matrix"],
                refined_rectification["output_size"],
                flags=cv2.INTER_LINEAR,
                borderMode=cv2.BORDER_CONSTANT,
                borderValue=0,
            )
            normalized_image = cv2.warpPerspective(
                img,
                refined_rectification["matrix"],
                refined_rectification["output_size"],
                flags=cv2.INTER_LINEAR,
                borderMode=cv2.BORDER_CONSTANT,
                borderValue=(0, 0, 0),
            )
            normalized_marker = normalized_image.copy()
            bull_center_normalized, bull_score, normalized_edges = _estimate_bull_center_in_normalized_image(
                normalized_gray,
                refined_rectification["normalized_center"],
                refined_rectification["outer_radius"],
            )
            bull_center_xy = np.array([bull_center_normalized], dtype=np.float32)
            cv2.circle(
                normalized_marker,
                (int(round(bull_center_normalized[0])), int(round(bull_center_normalized[1]))),
                6,
                (255, 0, 0),
                -1,
            )

            back_transformed_center = _transform_points(
                bull_center_xy,
                refined_rectification["inverse_matrix"],
            )[0]
            back_center_xy = (
                int(round(float(back_transformed_center[0]))),
                int(round(float(back_transformed_center[1]))),
            )
            cv2.circle(output, back_center_xy, 6, (255, 0, 0), -1)

            ring_boundaries_rectified, ring_boundaries_image = _build_projected_ring_boundaries(
                bull_center_normalized,
                refined_rectification["outer_radius"],
                refined_rectification["inverse_matrix"],
            )
            sector_boundary_angles_deg, sector_boundary_scores = _detect_sector_boundary_angles(
                normalized_edges,
                bull_center_normalized,
                refined_rectification["outer_radius"],
            )
            sector_boundaries_rectified, sector_boundaries_image = _build_projected_sector_boundaries(
                bull_center_normalized,
                refined_rectification["outer_radius"],
                sector_boundary_angles_deg,
                refined_rectification["inverse_matrix"],
            )
            field_labels_rectified, field_labels_image = _build_field_labels(
                bull_center_normalized,
                refined_rectification["outer_radius"],
                sector_boundary_angles_deg,
                refined_rectification["inverse_matrix"],
            )
            ring_styles = {
                "double_outer": ((0, 255, 0), 2),
                "double_inner": ((0, 200, 255), 2),
                "triple_outer": ((255, 180, 0), 2),
                "triple_inner": ((255, 120, 0), 2),
                "outer_bull": ((255, 0, 255), 2),
                "inner_bull": ((0, 0, 255), 2),
            }
            for ring_name, image_points in ring_boundaries_image.items():
                color, thickness = ring_styles.get(ring_name, ((200, 200, 200), 1))
                _draw_projected_polyline(output, image_points, color, thickness)
            for rectified_segment in sector_boundaries_rectified:
                _draw_projected_segment(normalized_marker, rectified_segment, SEPARATOR_LINE_COLOR, 1)
            for image_segment in sector_boundaries_image:
                _draw_projected_segment(output, image_segment, SEPARATOR_LINE_COLOR, SEPARATOR_LINE_THICKNESS)
            _draw_field_labels(normalized_marker, field_labels_rectified, refined_rectification["outer_radius"], "rectified_anchor", base_scale_divisor=430.0)
            _draw_field_labels(output, field_labels_image, refined_rectification["outer_radius"], "image_anchor")
            cv2.circle(
                normalized_marker,
                (int(round(bull_center_normalized[0])), int(round(bull_center_normalized[1]))),
                6,
                (255, 0, 0),
                -1,
            )
            cv2.circle(output, back_center_xy, 6, (255, 0, 0), -1)

            detect_dartboard.last_normalization = {
                **refined_rectification,
                "normalized_image": normalized_marker,
                "normalized_edges": normalized_edges,
                "bull_center_normalized": bull_center_normalized,
                "back_transformed_center": (
                    float(back_transformed_center[0]),
                    float(back_transformed_center[1]),
                ),
                "bull_score": bull_score,
                "initial_bull_score": approx_bull_score,
                "ring_boundaries_rectified": ring_boundaries_rectified,
                "ring_boundaries_image": ring_boundaries_image,
                "sector_boundary_angles_deg": sector_boundary_angles_deg,
                "sector_boundary_scores": sector_boundary_scores,
                "sector_boundaries_rectified": sector_boundaries_rectified,
                "sector_boundaries_image": sector_boundaries_image,
                "field_labels_rectified": field_labels_rectified,
                "field_labels_image": field_labels_image,
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
        cv2.imwrite(output_path3, detect_dartboard.last_normalization["normalized_edges"])
    else:
        cv2.imwrite(output_path3, edges)
    cv2.imwrite(output_path2, gray)

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


