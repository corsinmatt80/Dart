export type GameType = 'killer' | 'darts501' | 'cricket';
export type InputMode = 'manual' | 'camera' | 'api';

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
    value: [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5][i],
    multiplier: 1 as const,
    label: `1x ${[20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5][i]}`,
  })),
  // Doubles
  ...Array.from({ length: 20 }, (_, i) => ({
    id: `double_${i}`,
    value: [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5][i],
    multiplier: 2 as const,
    label: `2x ${[20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5][i]}`,
  })),
  // Triples
  ...Array.from({ length: 20 }, (_, i) => ({
    id: `triple_${i}`,
    value: [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5][i],
    multiplier: 3 as const,
    label: `3x ${[20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5][i]}`,
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
