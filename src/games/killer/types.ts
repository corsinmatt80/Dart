import { Player, HitData } from './types';

export interface KillerGameState {
  players: (Player & {
    randomNumber: number;
    hits: number;
    killer: boolean;
    shots: number;
  })[];
  currentPlayerIndex: number;
  winner: Player | null;
  gamePhase: 'setup' | 'playing' | 'ended';
}

export interface KillerGameActions {
  recordHit(hitData: HitData): void;
  endTurn(): void;
  reset(): void;
}

export function createInitialKillerState(players: Player[]): KillerGameState {
  const numbersToAssign = assignBalancedRandomNumbers(players.length);
  
  return {
    players: players.map((player, index) => ({
      ...player,
      randomNumber: numbersToAssign[index],
      hits: 0,
      killer: false,
      shots: 0,
    })),
    currentPlayerIndex: 0,
    winner: null,
    gamePhase: 'playing',
  };
}

function assignBalancedRandomNumbers(playerCount: number): number[] {
  const numbers = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
  const assigned: number[] = [];
  const used = new Set<number>();

  for (let i = 0; i < playerCount; i++) {
    let number: number;
    do {
      number = numbers[Math.floor(Math.random() * numbers.length)];
    } while (used.has(number));
    
    assigned.push(number);
    used.add(number);
    
    // Mark adjacent numbers as unavailable
    const index = numbers.indexOf(number);
    for (let j = Math.max(0, index - 2); j <= Math.min(19, index + 2); j++) {
      used.add(numbers[j]);
    }
  }

  return assigned;
}

export function procesKillerHit(
  state: KillerGameState,
  hitData: HitData
): KillerGameState {
  const newState = JSON.parse(JSON.stringify(state)) as KillerGameState;
  const currentPlayer = newState.players[newState.currentPlayerIndex];

  currentPlayer.shots += 1;

  // Update hit count
  if (currentPlayer.hits < 3) {
    currentPlayer.hits += hitData.multiplier;
    if (currentPlayer.hits >= 3) {
      currentPlayer.hits = 3;
      currentPlayer.killer = true;
    }
  }

  // If killer, eliminate other players with this number
  if (currentPlayer.killer) {
    for (const player of newState.players) {
      if (
        player.randomNumber === hitData.value &&
        player.id !== currentPlayer.id &&
        !player.eliminated
      ) {
        player.hits -= hitData.multiplier;
        if (player.hits < 0) {
          player.eliminated = true;
        }
        break;
      }
    }
  }

  // Check if only one player remains
  const activePlayers = newState.players.filter((p) => !p.eliminated);
  if (activePlayers.length === 1) {
    newState.winner = activePlayers[0];
    newState.gamePhase = 'ended';
  }

  return newState;
}
