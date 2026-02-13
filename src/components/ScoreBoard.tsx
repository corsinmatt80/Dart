import React from 'react';
import { KillerGameState } from './types';
import { RotateCcw } from 'lucide-react';

interface ScoreBoardProps {
  gameState: KillerGameState | any;
  gameType: 'killer' | 'darts501';
  onReset: () => void;
}

function ScoreBoard({ gameState, gameType, onReset }: ScoreBoardProps) {
  const currentPlayer = gameState?.players?.[gameState?.currentPlayerIndex];

  return (
    <div className="space-y-4">
      {/* Current Player Info */}
      <div className="bg-gradient-to-r from-primary to-accent rounded-lg p-6 text-white">
        <p className="text-sm text-gray-200 mb-1">Current Player</p>
        <h2 className="text-3xl font-bold mb-2">{currentPlayer?.name}</h2>
        
        {gameType === 'killer' && (
          <div className="flex gap-4">
            <div>
              <p className="text-xs text-gray-300">Target Number</p>
              <p className="text-2xl font-bold">{currentPlayer?.randomNumber}</p>
            </div>
            <div>
              <p className="text-xs text-gray-300">Hits</p>
              <p className="text-2xl font-bold">{currentPlayer?.hits}/3</p>
            </div>
            <div>
              <p className="text-xs text-gray-300">Status</p>
              <p className="text-xl font-bold">{currentPlayer?.killer ? '🔥 KILLER' : 'Building'}</p>
            </div>
          </div>
        )}

        {gameType === 'darts501' && (
          <div className="flex gap-4">
            <div>
              <p className="text-xs text-gray-300">Score</p>
              <p className="text-3xl font-bold">{currentPlayer?.score}</p>
            </div>
            <div>
              <p className="text-xs text-gray-300">Shots</p>
              <p className="text-2xl font-bold">{currentPlayer?.shots}/3</p>
            </div>
          </div>
        )}
      </div>

      {/* Players List */}
      <div className="bg-white/10 backdrop-blur-md rounded-lg p-4 border border-white/20">
        <h3 className="text-white font-bold mb-3 text-sm">Players</h3>
        <div className="space-y-2">
          {gameState?.players?.map((player: any, idx: number) => (
            <div
              key={player.id}
              className={`p-3 rounded-lg transition ${
                idx === gameState.currentPlayerIndex
                  ? 'bg-accent/30 border-l-4 border-accent'
                  : 'bg-white/5'
              } ${player.eliminated ? 'opacity-50 line-through' : ''}`}
            >
              <div className="flex justify-between items-center">
                <span className="text-white font-medium">{player.name}</span>
                {gameType === 'killer' && (
                  <div className="flex gap-2 text-sm">
                    <span className="text-gray-300">#{player.randomNumber}</span>
                    <span className={player.killer ? 'text-red-400 font-bold' : 'text-gray-400'}>
                      {player.hits}/3 {player.killer ? '⚡' : ''}
                    </span>
                  </div>
                )}
                {gameType === 'darts501' && (
                  <span className={`font-bold ${
                    player.score === 0 ? 'text-success' : 'text-gray-300'
                  }`}>
                    {player.score}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Winner */}
      {gameState?.winner && (
        <div className="bg-success/20 border-2 border-success rounded-lg p-4 text-center">
          <p className="text-success font-bold text-2xl">🎉 {gameState.winner.name} Wins!</p>
          <button
            onClick={onReset}
            className="mt-4 w-full px-4 py-2 bg-success hover:bg-success/80 text-white rounded-lg font-bold transition"
          >
            Play Again
          </button>
        </div>
      )}

      <button
        onClick={onReset}
        className="w-full px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg font-bold text-white transition flex items-center justify-center gap-2 border border-white/30"
      >
        <RotateCcw size={18} /> Back to Menu
      </button>
    </div>
  );
}

export default ScoreBoard;
