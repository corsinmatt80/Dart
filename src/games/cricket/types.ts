import { Player, HitData } from '../types';

// Cricket targets: 15, 16, 17, 18, 19, 20, Bull (25)
export const CRICKET_TARGETS = [20, 19, 18, 17, 16, 15, 25] as const;
export type CricketTarget = typeof CRICKET_TARGETS[number];

export interface CricketPlayerState {
  // How many marks on each number (0-3)
  marks: Record<CricketTarget, number>;
  // Total points (lower is better!)
  points: number;
}

export interface CricketGameState {
  players: (Player & CricketPlayerState & {
    shots: number;
  })[];
  currentPlayerIndex: number;
  round: number;
  maxRounds: number;
  winner: Player | null;
  gamePhase: 'setup' | 'playing' | 'ended';
}

export function createInitialCricketState(
  players: Player[]
): CricketGameState {
  const initialMarks: Record<CricketTarget, number> = {
    20: 0, 19: 0, 18: 0, 17: 0, 16: 0, 15: 0, 25: 0
  };

  return {
    players: players.map((player) => ({
      ...player,
      marks: { ...initialMarks },
      points: 0,
      shots: 0,
    })),
    currentPlayerIndex: 0,
    round: 1,
    maxRounds: 20,
    winner: null,
    gamePhase: 'playing',
  };
}

export function processCricketHit(
  state: CricketGameState,
  hitData: HitData
): CricketGameState {
  const newState = JSON.parse(JSON.stringify(state)) as CricketGameState;
  const currentPlayer = newState.players[newState.currentPlayerIndex];
  
  currentPlayer.shots += 1;

  const value = hitData.value as CricketTarget;
  const multiplier = hitData.multiplier;

  // Check if this is a cricket target (or miss with value 0)
  if (!CRICKET_TARGETS.includes(value)) {
    // Not a cricket number (miss or irrelevant) - check for 3 shots
    if (currentPlayer.shots === 3) {
      return endCricketTurn(newState);
    }
    return newState;
  }

  // Current marks for this number
  const currentMarks = currentPlayer.marks[value];
  
  if (currentMarks < 3) {
    // Still opening this number
    const marksToClose = Math.min(3 - currentMarks, multiplier);
    const extraMarks = multiplier - marksToClose;
    
    // Add marks (max 3)
    currentPlayer.marks[value] = Math.min(currentMarks + multiplier, 3);
    
    // Extra marks beyond 3 give points to ALL OTHER players who haven't closed
    if (extraMarks > 0) {
      const pointValue = value === 25 ? 25 : value;
      newState.players.forEach((p, idx) => {
        if (idx !== newState.currentPlayerIndex && p.marks[value] < 3) {
          p.points += extraMarks * pointValue;
        }
      });
    }
  } else {
    // Already closed (3 marks) - give points to ALL OTHER players who haven't closed
    const pointValue = value === 25 ? 25 : value;
    newState.players.forEach((p, idx) => {
      if (idx !== newState.currentPlayerIndex && p.marks[value] < 3) {
        p.points += multiplier * pointValue;
      }
    });
  }

  // Check for winner: closed all AND has fewest (or equal) points
  const hasClosedAll = CRICKET_TARGETS.every(t => currentPlayer.marks[t] >= 3);
  
  if (hasClosedAll) {
    const minOpponentPoints = Math.min(...newState.players
      .filter((_, idx) => idx !== newState.currentPlayerIndex)
      .map(p => p.points));
    
    if (currentPlayer.points <= minOpponentPoints) {
      newState.winner = currentPlayer;
      newState.gamePhase = 'ended';
      return newState;
    }
  }

  // End turn after 3 shots
  if (currentPlayer.shots === 3) {
    return endCricketTurn(newState);
  }

  return newState;
}

function endCricketTurn(state: CricketGameState): CricketGameState {
  const newState = JSON.parse(JSON.stringify(state)) as CricketGameState;
  
  const nextPlayerIndex = (newState.currentPlayerIndex + 1) % newState.players.length;
  
  // If we're going back to player 0, increment round
  if (nextPlayerIndex === 0) {
    newState.round += 1;
    
    // Check if max rounds reached
    if (newState.round > newState.maxRounds) {
      // Game over - lowest points wins
      const sortedPlayers = [...newState.players].sort((a, b) => a.points - b.points);
      newState.winner = sortedPlayers[0];
      newState.gamePhase = 'ended';
      return newState;
    }
  }
  
  newState.currentPlayerIndex = nextPlayerIndex;
  newState.players[newState.currentPlayerIndex].shots = 0;
  
  return newState;
}
