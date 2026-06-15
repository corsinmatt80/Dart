/**
 * Tiefe Kopie eines serialisierbaren Werts (z. B. Spielzustand).
 *
 * Zentralisiert das zuvor an 13 Stellen wiederholte
 * `JSON.parse(JSON.stringify(...))`-Muster. Die Spielzustaende sind reine
 * JSON-Daten (keine Funktionen, Dates oder zyklischen Referenzen), daher ist
 * dieser Ansatz korrekt und ausreichend.
 */
export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
