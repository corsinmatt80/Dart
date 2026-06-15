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

interface OpenCvGlobal {
  // Keep this intentionally loose: OpenCV.js API surface can vary per build.
  [key: string]: unknown;
}

let hasWarnedMissingOpenCv = false;
let hasWarnedTodo = false;

function getOpenCv(): OpenCvGlobal | null {
  const host = globalThis as typeof globalThis & { cv?: OpenCvGlobal };
  return host.cv ?? null;
}

/**
 * OpenCV-based dartboard detection entry point.
 *
 * TODO: Implement your OpenCV pipeline here, e.g.
 * 1) Convert ImageData to Mat
 * 2) Preprocess (blur / color space / threshold)
 * 3) Find contours / ellipse candidates
 * 4) Score candidates and return best match
 */
export function detectDartboardEllipse(
  imageData: ImageData,
  previousEllipse?: Ellipse | null,
): DartboardDetectionResult | null {
  const cv = getOpenCv();

  if (!cv) {
    if (!hasWarnedMissingOpenCv) {
      hasWarnedMissingOpenCv = true;
      console.warn('[dartboardDetection] OpenCV (window.cv) not available. Returning null.');
    }
    return null;
  }

  // Keep placeholders referenced so strict/lint configs do not flag unused params.
  void cv;
  void imageData;
  void previousEllipse;

  if (!hasWarnedTodo) {
    hasWarnedTodo = true;
    console.warn('[dartboardDetection] OpenCV detection is not implemented yet. Returning null.');
  }

  return null;
}
