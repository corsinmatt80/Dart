/**
 * Laedt OpenCV.js (WASM) einmalig per CDN und liefert das `cv`-Objekt zurueck,
 * sobald die Runtime initialisiert ist. OpenCV.js wird bewusst dynamisch
 * geladen (~8 MB), damit es den App-Start nicht blockiert.
 */

// OpenCV.js hat keine offiziellen TS-Typen -> bewusst lose typisiert.
export type CV = any;

const OPENCV_URL = 'https://docs.opencv.org/4.10.0/opencv.js';

let loadPromise: Promise<CV> | null = null;

export function loadOpenCV(): Promise<CV> {
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<CV>((resolve, reject) => {
    const w = window as unknown as { cv?: CV };

    const ready = (cv: CV) => {
      // Manche Builds liefern ein Module-Objekt, das erst nach
      // onRuntimeInitialized einsatzbereit ist.
      if (cv && cv.Mat) return resolve(cv);
      if (cv && typeof cv.then === 'function') return cv.then(resolve, reject);
      if (cv) {
        cv.onRuntimeInitialized = () => resolve(cv);
        return;
      }
      reject(new Error('OpenCV.js wurde geladen, ist aber nicht verfuegbar.'));
    };

    if (w.cv) return ready(w.cv);

    const script = document.createElement('script');
    script.src = OPENCV_URL;
    script.async = true;
    script.onload = () => ready((window as unknown as { cv: CV }).cv);
    script.onerror = () => reject(new Error('OpenCV.js konnte nicht geladen werden.'));
    document.body.appendChild(script);
  });

  return loadPromise;
}
