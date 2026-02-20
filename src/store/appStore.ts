import { create } from 'zustand';
import { GameType, Player, InputMode } from '../games/types';
import { KillerGameState, createInitialKillerState, procesKillerHit } from '../games/killer/types';
import { Darts501GameState, Darts501Options, createInitialDarts501State, processDarts501Hit } from '../games/darts501/types';
import { CricketGameState, createInitialCricketState, processCricketHit } from '../games/cricket/types';
import { HitData } from '../games/types';

type GameState = KillerGameState | Darts501GameState | CricketGameState | null;

interface AppStore {
  // Game selection
  currentGame: GameType | null;
  setCurrentGame(game: GameType): void;

  // Players
  players: Player[];
  setPlayers(players: Player[]): void;

  // Game state
  gameState: GameState;
  darts501Options: Darts501Options | null;
  initializeGame(game: GameType, players: Player[]): void;
  initializeDarts501(players: Player[], options: Darts501Options): void;
  initializeCricket(players: Player[]): void;
  recordHit(hitData: HitData): void;
  endTurn(): void;
  resetGame(): void;
  startNewLeg(): void;

  // Input mode
  inputMode: InputMode;
  setInputMode(mode: InputMode): void;

  // History for undo
  history: GameState[];
  initialGameState: GameState;
  undo(): void;
}

export const useAppStore = create<AppStore>((set) => ({
  currentGame: null,
  players: [],
  gameState: null,
  initialGameState: null,
  darts501Options: null,
  inputMode: 'manual',
  history: [],

  setCurrentGame: (game) => set({ currentGame: game }),

  setPlayers: (players) => set({ players }),

  initializeGame: (game, players) => {
    let gameState: GameState = null;
    
    if (game === 'killer') {
      gameState = createInitialKillerState(players);
    }
    // Note: darts501 should use initializeDarts501 instead

    set({
      currentGame: game,
      players,
      gameState,
      initialGameState: JSON.parse(JSON.stringify(gameState)),
      history: [],
    });
  },

  initializeDarts501: (players, options) => {
    const gameState = createInitialDarts501State(players, undefined, options);

    set({
      currentGame: 'darts501',
      players,
      gameState,
      darts501Options: options,
      initialGameState: JSON.parse(JSON.stringify(gameState)),
      history: [],
    });
  },

  initializeCricket: (players) => {
    const gameState = createInitialCricketState(players);

    set({
      currentGame: 'cricket',
      players,
      gameState,
      initialGameState: JSON.parse(JSON.stringify(gameState)),
      history: [],
    });
  },

  recordHit: (hitData) =>
    set((state) => {
      if (!state.gameState || !state.currentGame) return state;

      const newHistory = [...state.history, JSON.parse(JSON.stringify(state.gameState))];

      let newGameState: GameState = null;
      if (state.currentGame === 'killer') {
        newGameState = procesKillerHit(state.gameState as KillerGameState, hitData);
      } else if (state.currentGame === 'darts501') {
        newGameState = processDarts501Hit(state.gameState as Darts501GameState, hitData);
      } else if (state.currentGame === 'cricket') {
        newGameState = processCricketHit(state.gameState as CricketGameState, hitData);
      }

      return {
        gameState: newGameState,
        history: newHistory,
      };
    }),

  endTurn: () =>
    set((state) => {
      if (!state.gameState || !state.currentGame) return state;

      const newState = JSON.parse(JSON.stringify(state.gameState));

      if (state.currentGame === 'killer') {
        const killerState = newState as KillerGameState;
        do {
          killerState.currentPlayerIndex = (killerState.currentPlayerIndex + 1) % killerState.players.length;
        } while (killerState.players[killerState.currentPlayerIndex].eliminated);
        killerState.players[killerState.currentPlayerIndex].shots = 0;
      } else if (state.currentGame === 'darts501') {
        const dartsState = newState as Darts501GameState;
        do {
          dartsState.currentPlayerIndex = (dartsState.currentPlayerIndex + 1) % dartsState.players.length;
        } while (dartsState.players[dartsState.currentPlayerIndex].eliminated);
        dartsState.players[dartsState.currentPlayerIndex].shots = 0;
      }

      return { gameState: newState };
    }),

  resetGame: () => set({ currentGame: null, gameState: null, initialGameState: null, players: [], history: [], darts501Options: null }),

  startNewLeg: () => set((state) => {
    if (!state.gameState || state.currentGame !== 'darts501') return state;
    
    const dartsState = state.gameState as Darts501GameState;
    const newGameState = createInitialDarts501State(
      state.players,
      dartsState.players,
      state.darts501Options ?? dartsState.options
    );
    
    return {
      gameState: newGameState,
      history: [],
    };
  }),

  setInputMode: (mode) => set({ inputMode: mode }),

  undo: () =>
    set((state) => {
      if (state.history.length === 0) return state;

      // Hole den previousState BEVOR die history gekürzt wird
      const previousState = state.history[state.history.length - 1];
      // DANN kürze die history
      const newHistory = state.history.slice(0, -1);

      if (!previousState) return state;

      return {
        gameState: previousState,
        history: newHistory,
      };
    }),
}));
