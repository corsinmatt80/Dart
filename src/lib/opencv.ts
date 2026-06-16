/**
 * Laedt OpenCV.js (WASM) einmalig und liefert das `cv`-Objekt zurueck, sobald
 * die Runtime initialisiert ist. OpenCV.js wird bewusst dynamisch geladen
 * (~10 MB), damit es den App-Start nicht blockiert.
 *
 * Robust gegen die ueblichen Stolperfallen:
 *  - mehrere CDN-Quellen (faellt der Reihe nach durch, falls eine 404/down ist),
 *  - drei moegliche Init-Formen von `window.cv` (fertig / Promise / Module mit
 *    `onRuntimeInitialized`) plus Polling gegen die Race-Condition, dass die
 *    Runtime bereits vor unserem Handler initialisiert ist,
 *  - Timeout pro Quelle, damit ein haengender Load nicht ewig blockiert,
 *  - bei komplettem Fehlschlag wird der Cache geleert -> ein erneuter Aufruf
 *    (Retry-Button) versucht es frisch.
 */

// OpenCV.js hat keine offiziellen TS-Typen -> bewusst lose typisiert.
export type CV = any;

// Mehrere Quellen: erste, die wirklich initialisiert, gewinnt.
const OPENCV_URLS = [
  // docs.opencv.org/4.10.0 liefert 404 (Version vom Server entfernt). 4.13.0 ist
  // aktuell die latest stable und das Ziel des 4.x-Redirects.
  'https://docs.opencv.org/4.13.0/opencv.js',
  'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js',
];

const LOAD_TIMEOUT_MS = 30_000;

let loadPromise: Promise<CV> | null = null;

export function loadOpenCV(): Promise<CV> {
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const w = window as unknown as { cv?: CV };
    if (w.cv && w.cv.Mat) return w.cv;

    const errors: string[] = [];
    for (const url of OPENCV_URLS) {
      try {
        return await loadFromUrl(url);
      } catch (err) {
        errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // Alle Quellen gescheitert -> Cache leeren, damit ein Retry frisch startet.
    loadPromise = null;
    throw new Error(`OpenCV.js konnte nicht geladen werden.\n${errors.join('\n')}`);
  })();

  return loadPromise;
}

/** Erlaubt einen sauberen Retry nach einem Fehler (Cache verwerfen). */
export function resetOpenCV(): void {
  loadPromise = null;
}

function loadFromUrl(url: string): Promise<CV> {
  return new Promise<CV>((resolve, reject) => {
    const w = window as unknown as { cv?: CV };
    let settled = false;
    let pollId: ReturnType<typeof setInterval> | null = null;

    const cleanup = () => {
      if (pollId) clearInterval(pollId);
      clearTimeout(timeoutId);
    };
    const ok = (cv: CV) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(cv);
    };
    const fail = (msg: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      // gescheiterte Quelle entfernen, damit ein Fallback `window.cv` sauber neu setzt
      script.remove();
      reject(new Error(msg));
    };

    const timeoutId = setTimeout(
      () => fail(`Timeout nach ${LOAD_TIMEOUT_MS / 1000}s`),
      LOAD_TIMEOUT_MS,
    );

    // `window.cv` kann je nach Build sein: fertiges Modul, Promise/thenable oder
    // ein Modul, das erst nach `onRuntimeInitialized` Mat & Co. besitzt.
    const tryResolve = (cv: CV): boolean => {
      if (!cv) return false;
      if (cv.Mat) {
        ok(cv);
        return true;
      }
      if (typeof cv.then === 'function') {
        cv.then((m: CV) => ok(m ?? (w.cv as CV)), (e: unknown) => fail(String(e)));
        return true;
      }
      // Modul vorhanden, Runtime evtl. noch nicht fertig:
      cv.onRuntimeInitialized = () => ok(cv);
      // Race-Absicherung: falls Runtime schon initialisiert ist, greift Polling.
      pollId = setInterval(() => {
        if (w.cv && w.cv.Mat) ok(w.cv);
      }, 100);
      return true;
    };

    const existing = document.querySelector<HTMLScriptElement>(`script[data-opencv="${url}"]`);
    const script = existing ?? document.createElement('script');
    script.src = url;
    script.async = true;
    script.dataset.opencv = url;
    script.onload = () => {
      if (!tryResolve(w.cv)) fail('geladen, aber `cv` nicht verfuegbar');
    };
    script.onerror = () => fail('Script-Load fehlgeschlagen (Netzwerk/404)');
    if (!existing) document.body.appendChild(script);
    // Falls cv schon da ist (z.B. Script bereits im DOM), sofort versuchen.
    if (w.cv) tryResolve(w.cv);
  });
}
