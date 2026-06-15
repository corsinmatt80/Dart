export type GameType = 'killer' | 'darts501' | 'cricket' | 'limbo';
export type InputMode = 'manual' | 'camera';

/** Zahlen-Reihenfolge eines Standard-Dartboards im Uhrzeigersinn ab oben (20). */
export const DARTBOARD_ORDER: number[] = [
  20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5,
];

export interface Player {
  id: string;
  name: string;
  eliminated?: boolean;
}

export interface HitData {
  value: number;
  multiplier: 1 | 2 | 3;
  points: number;
}

export interface DartboardSection {
  id: string;
  value: number;
  multiplier: 1 | 2 | 3;
  label: string;
}

export const DARTBOARD_SECTIONS: DartboardSection[] = [
  // Singles
  ...Array.from({ length: 20 }, (_, i) => ({
    id: `single_${i}`,
    value: DARTBOARD_ORDER[i],
    multiplier: 1 as const,
    label: `1x ${DARTBOARD_ORDER[i]}`,
  })),
  // Doubles
  ...Array.from({ length: 20 }, (_, i) => ({
    id: `double_${i}`,
    value: DARTBOARD_ORDER[i],
    multiplier: 2 as const,
    label: `2x ${DARTBOARD_ORDER[i]}`,
  })),
  // Triples
  ...Array.from({ length: 20 }, (_, i) => ({
    id: `triple_${i}`,
    value: DARTBOARD_ORDER[i],
    multiplier: 3 as const,
    label: `3x ${DARTBOARD_ORDER[i]}`,
  })),
  // Bullseye
  {
    id: 'bullseye',
    value: 50,
    multiplier: 1 as const,
    label: '50 Bullseye',
  },
  // Single Bull
  {
    id: 'single_bull',
    value: 25,
    multiplier: 1 as const,
    label: '25 Single Bull',
  },
];
