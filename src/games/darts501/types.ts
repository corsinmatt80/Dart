import { Player, HitData } from '../types';

export interface Darts501GameState {
  players: (Player & {
    score: number;
    shots: number;
    scoreAtTurnStart?: number;
    turnBusted?: boolean;
    legsWon: number;
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

export function createInitialDarts501State(players: Player[], existingPlayers?: Darts501GameState['players']): Darts501GameState {
  return {
    players: players.map((player, index) => ({
      ...player,
      score: 501,
      shots: 0,
      legsWon: existingPlayers?.[index]?.legsWon ?? 0,
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

  // Initialize turn tracking on first shot
  if (currentPlayer.shots === 0) {
    currentPlayer.scoreAtTurnStart = currentPlayer.score;
    currentPlayer.turnBusted = false;
  }

  currentPlayer.shots += 1;
  const points = hitData.points;
  const newScore = currentPlayer.score - points;

  // Check for bust conditions
  if (newScore < 0 || newScore === 1) {
    // Bust detected: revert score to start of turn and end turn immediately
    currentPlayer.score = currentPlayer.scoreAtTurnStart!;
    currentPlayer.turnBusted = true;
    return endDarts501Turn(newState);
  } else if (newScore === 0) {
    // Player reached exactly 0 - must be a double finish!
    if (hitData.multiplier === 2) {
      // Valid finish - game won!
      currentPlayer.score = 0;
      currentPlayer.legsWon += 1;
      newState.winner = currentPlayer;
      newState.gamePhase = 'ended';
      return newState;
    } else {
      // Invalid finish (not a double) - bust, revert and end turn
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

function endDarts501Turn(state: Darts501GameState): Darts501GameState {
  const newState = JSON.parse(JSON.stringify(state)) as Darts501GameState;
  
  // Move to next player
  newState.currentPlayerIndex = (newState.currentPlayerIndex + 1) % newState.players.length;

  // Reset shot counter and bust flag for next player
  newState.players[newState.currentPlayerIndex].shots = 0;
  newState.players[newState.currentPlayerIndex].turnBusted = false;
  return newState;
}
