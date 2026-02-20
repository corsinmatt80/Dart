import { Player, HitData } from '../types';

export interface LimboPlayerState {
  lives: number;
  lastThrow: number | null;
  shots: number;
  currentThrows: number[];
}

export interface LimboGameState {
  players: (Player & LimboPlayerState)[];
  currentPlayerIndex: number;
  currentLimit: number;
  startLimit: number;
  maxLives: number;
  lastPlayerWhoSet: string | null;
  winner: Player | null;
  gamePhase: 'setup' | 'playing' | 'ended';
  message: string | null;
}

export function createInitialLimboState(
  players: Player[],
  startLimit: number = 120,
  maxLives: number = 3
): LimboGameState {
  return {
    players: players.map((player) => ({
      ...player,
      lives: maxLives,
      lastThrow: null,
      shots: 0,
      currentThrows: [],
    })),
    currentPlayerIndex: 0,
    currentLimit: startLimit,
    startLimit,
    maxLives,
    lastPlayerWhoSet: null,
    winner: null,
    gamePhase: 'playing',
    message: null,
  };
}

export function processLimboHit(
  state: LimboGameState,
  hitData: HitData
): LimboGameState {
  const newState = JSON.parse(JSON.stringify(state)) as LimboGameState;
  const currentPlayer = newState.players[newState.currentPlayerIndex];
  
  // Miss counts as 25 points!
  const throwValue = hitData.points === 0 ? 25 : hitData.points;
  
  // Add throw to current throws
  currentPlayer.currentThrows.push(throwValue);
  currentPlayer.shots += 1;
  
  // Calculate running total
  const currentTotal = currentPlayer.currentThrows.reduce((a, b) => a + b, 0);
  
  // Update message to show progress
  const throwDisplay = currentPlayer.currentThrows.map((t, i) => 
    hitData.points === 0 && i === currentPlayer.currentThrows.length - 1 ? '25 (miss)' : t
  ).join(' + ');
  newState.message = `${currentPlayer.name}: ${throwDisplay} = ${currentTotal}`;
  
  // After 3 throws, evaluate
  if (currentPlayer.shots === 3) {
    currentPlayer.lastThrow = currentTotal;
    
    // Check if total is under the limit (strictly less than)
    if (currentTotal < newState.currentLimit) {
      // Success! Set new limit
      newState.currentLimit = currentTotal;
      newState.lastPlayerWhoSet = currentPlayer.id;
      newState.message = `${currentPlayer.name} threw ${currentTotal}! New limit: ${currentTotal}`;
    } else {
      // Bust! Threw at or over the limit
      currentPlayer.lives -= 1;
      newState.message = `${currentPlayer.name} threw ${currentTotal} - BUST! (Limit was ${newState.currentLimit})`;
      
      // Reset limit
      newState.currentLimit = newState.startLimit;
      newState.lastPlayerWhoSet = null;
      
      // Check if player is eliminated
      if (currentPlayer.lives <= 0) {
        currentPlayer.eliminated = true;
        newState.message += ` - ELIMINATED!`;
      }
    }

    // Check for winner (only one player with lives remaining)
    const alivePlayers = newState.players.filter(p => p.lives > 0);
    if (alivePlayers.length === 1) {
      newState.winner = alivePlayers[0];
      newState.gamePhase = 'ended';
      newState.message = `${alivePlayers[0].name} wins!`;
      return newState;
    }
    
    if (alivePlayers.length === 0) {
      newState.gamePhase = 'ended';
      return newState;
    }

    // Move to next alive player and reset their throws
    let nextIndex = (newState.currentPlayerIndex + 1) % newState.players.length;
    while (newState.players[nextIndex].lives <= 0) {
      nextIndex = (nextIndex + 1) % newState.players.length;
    }
    newState.currentPlayerIndex = nextIndex;
    newState.players[nextIndex].shots = 0;
    newState.players[nextIndex].currentThrows = [];
  }

  return newState;
}
