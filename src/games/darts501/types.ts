import { Player, HitData } from '../types';

export interface Darts501GameState {
  players: (Player & {
    score: number;
    shots: number;
  })[];
  currentPlayerIndex: number;
  winner: Player | null;
  gamePhase: 'setup' | 'playing' | 'ended';
}

export interface Darts501GameActions {
  recordHit(hitData: HitData): void;
  endTurn(): void;
  reset(): void;
}

export function createInitialDarts501State(players: Player[]): Darts501GameState {
  return {
    players: players.map((player) => ({
      ...player,
      score: 501,
      shots: 0,
    })),
    currentPlayerIndex: 0,
    winner: null,
    gamePhase: 'playing',
  };
}

export function processDarts501Hit(
  state: Darts501GameState,
  hitData: HitData
): Darts501GameState {
  const newState = JSON.parse(JSON.stringify(state)) as Darts501GameState;
  const currentPlayer = newState.players[newState.currentPlayerIndex];

  currentPlayer.shots += 1;
  const points = hitData.points;

  // Check for bust
  if (currentPlayer.score - points < 0) {
    // Bust - turn ends, score unchanged
    if (currentPlayer.shots === 3) {
      return endDarts501Turn(newState);
    }
    return newState;
  } else if (currentPlayer.score - points === 0) {
    // Must finish on a double
    if (hitData.multiplier === 2) {
      currentPlayer.score = 0;
      newState.winner = currentPlayer;
      newState.gamePhase = 'ended';
      return newState;
    } else {
      // Invalid finish - treat as bust
      if (currentPlayer.shots === 3) {
        return endDarts501Turn(newState);
      }
      return newState;
    }
  } else {
    currentPlayer.score -= points;
  }

  // End turn after 3 shots
  if (currentPlayer.shots === 3) {
    return endDarts501Turn(newState);
  }

  return newState;
}

function endDarts501Turn(state: Darts501GameState): Darts501GameState {
  const newState = JSON.parse(JSON.stringify(state)) as Darts501GameState;
  
  // Move to next non-eliminated player
  do {
    newState.currentPlayerIndex = (newState.currentPlayerIndex + 1) % newState.players.length;
  } while (newState.players[newState.currentPlayerIndex].eliminated);

  newState.players[newState.currentPlayerIndex].shots = 0;
  return newState;
}
