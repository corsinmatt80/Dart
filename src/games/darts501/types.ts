import { Player, HitData } from '../types';

export type InMode = 'straight' | 'double';
export type OutMode = 'straight' | 'double' | 'master';

export interface Darts501Options {
  inMode: InMode;
  outMode: OutMode;
  startScore: number;
}

export interface Darts501GameState {
  players: (Player & {
    score: number;
    shots: number;
    scoreAtTurnStart?: number;
    turnBusted?: boolean;
    legsWon: number;
    hasStarted?: boolean; // For double-in tracking
  })[];
  currentPlayerIndex: number;
  winner: Player | null;
  gamePhase: 'setup' | 'playing' | 'ended';
  options: Darts501Options;
}

export interface Darts501GameActions {
  recordHit(hitData: HitData): void;
  endTurn(): void;
  reset(): void;
}

export const DEFAULT_501_OPTIONS: Darts501Options = {
  inMode: 'straight',
  outMode: 'double',
  startScore: 501,
};

export function createInitialDarts501State(
  players: Player[], 
  existingPlayers?: Darts501GameState['players'],
  options?: Darts501Options
): Darts501GameState {
  const opts = options ?? DEFAULT_501_OPTIONS;
  return {
    players: players.map((player, index) => ({
      ...player,
      score: opts.startScore,
      shots: 0,
      legsWon: existingPlayers?.[index]?.legsWon ?? 0,
      hasStarted: opts.inMode === 'straight', // If straight-in, already started
    })),
    currentPlayerIndex: 0,
    winner: null,
    gamePhase: 'playing',
    options: opts,
  };
}

export function processDarts501Hit(
  state: Darts501GameState,
  hitData: HitData
): Darts501GameState {
  const newState = JSON.parse(JSON.stringify(state)) as Darts501GameState;
  const currentPlayer = newState.players[newState.currentPlayerIndex];
  const { inMode, outMode } = newState.options;

  // Initialize turn tracking on first shot
  if (currentPlayer.shots === 0) {
    currentPlayer.scoreAtTurnStart = currentPlayer.score;
    currentPlayer.turnBusted = false;
  }

  currentPlayer.shots += 1;
  const points = hitData.points;

  // Double-In check: if not started yet, need a double to begin
  if (inMode === 'double' && !currentPlayer.hasStarted) {
    if (hitData.multiplier === 2) {
      currentPlayer.hasStarted = true;
      // Continue with normal scoring below
    } else {
      // Not a double - shot doesn't count, but use up the dart
      if (currentPlayer.shots === 3) {
        return endDarts501Turn(newState);
      }
      return newState;
    }
  }

  const newScore = currentPlayer.score - points;

  // Check for bust conditions
  if (newScore < 0 || newScore === 1) {
    // Bust detected: revert score to start of turn and end turn immediately
    currentPlayer.score = currentPlayer.scoreAtTurnStart!;
    currentPlayer.turnBusted = true;
    return endDarts501Turn(newState);
  } else if (newScore === 0) {
    // Player reached exactly 0 - check out mode
    const isValidFinish = checkValidFinish(hitData.multiplier, outMode);
    
    if (isValidFinish) {
      // Valid finish - game won!
      currentPlayer.score = 0;
      currentPlayer.legsWon += 1;
      newState.winner = currentPlayer;
      newState.gamePhase = 'ended';
      return newState;
    } else {
      // Invalid finish - bust, revert and end turn
      currentPlayer.score = currentPlayer.scoreAtTurnStart!;
      currentPlayer.turnBusted = true;
      return endDarts501Turn(newState);
    }
  } else {
    // Normal valid hit - deduct points
    currentPlayer.score = newScore;
  }

  // End turn after 3 shots
  if (currentPlayer.shots === 3) {
    return endDarts501Turn(newState);
  }

  return newState;
}

function checkValidFinish(multiplier: number, outMode: OutMode): boolean {
  switch (outMode) {
    case 'straight':
      return true; // Any finish is valid
    case 'double':
      return multiplier === 2; // Must be a double
    case 'master':
      return multiplier === 2 || multiplier === 3; // Double or triple
    default:
      return multiplier === 2;
  }
}

function endDarts501Turn(state: Darts501GameState): Darts501GameState {
  const newState = JSON.parse(JSON.stringify(state)) as Darts501GameState;
  
  // Move to next player
  newState.currentPlayerIndex = (newState.currentPlayerIndex + 1) % newState.players.length;

  // Reset shot counter and bust flag for next player
  newState.players[newState.currentPlayerIndex].shots = 0;
  newState.players[newState.currentPlayerIndex].turnBusted = false;
  return newState;
}
