import React, { useState } from 'react';
import { useAppStore } from '../store/appStore';
import { Plus, Trash2 } from 'lucide-react';

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function PlayerSetup() {
  const { setPlayers } = useAppStore();
  const [playerNames, setPlayerNames] = useState<string[]>(['Player 1', 'Player 2']);
  const [newPlayerName, setNewPlayerName] = useState('');

  const addPlayer = () => {
    if (newPlayerName.trim()) {
      setPlayerNames([...playerNames, newPlayerName]);
      setNewPlayerName('');
    }
  };

  const removePlayer = (index: number) => {
    if (playerNames.length > 2) {
      setPlayerNames(playerNames.filter((_, i) => i !== index));
    }
  };

  const updatePlayerName = (index: number, name: string) => {
    const updated = [...playerNames];
    updated[index] = name;
    setPlayerNames(updated);
  };

  const startGame = () => {
    const players = playerNames
      .filter((name) => name.trim())
      .map((name) => ({
        id: generateUUID(),
        name: name.trim(),
      }));

    if (players.length >= 2) {
      setPlayers(players);
    } else {
      alert('Please enter at least 2 player names');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-dark via-blue-900 to-dark flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <h1 className="text-4xl font-bold text-center mb-2 text-accent">Dart Game Hub</h1>
        <p className="text-center text-gray-400 mb-8">Enter player names</p>

        <div className="bg-white/10 backdrop-blur-md rounded-lg p-6 space-y-4">
          {playerNames.map((name, index) => (
            <div key={index} className="flex gap-2">
              <input
                type="text"
                value={name}
                onChange={(e) => updatePlayerName(index, e.target.value)}
                className="flex-1 px-4 py-2 bg-white/20 text-white placeholder-gray-400 rounded-lg border border-white/30 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/50"
                placeholder={`Player ${index + 1}`}
              />
              <button
                onClick={() => removePlayer(index)}
                disabled={playerNames.length <= 2}
                className="px-3 py-2 bg-danger/80 hover:bg-danger disabled:bg-gray-600 rounded-lg transition text-white"
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}

          <div className="flex gap-2">
            <input
              type="text"
              value={newPlayerName}
              onChange={(e) => setNewPlayerName(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && addPlayer()}
              className="flex-1 px-4 py-2 bg-white/20 text-white placeholder-gray-400 rounded-lg border border-white/30 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/50"
              placeholder="Add new player..."
            />
            <button
              onClick={addPlayer}
              className="px-4 py-2 bg-success/80 hover:bg-success rounded-lg transition text-white font-medium flex items-center gap-2"
            >
              <Plus size={18} /> Add
            </button>
          </div>
        </div>

        <button
          onClick={startGame}
          className="w-full mt-8 px-6 py-3 bg-gradient-to-r from-primary to-accent hover:from-primary/80 hover:to-accent/80 rounded-lg font-bold text-white text-lg transition transform hover:scale-105"
        >
          Start Game
        </button>
      </div>
    </div>
  );
}

export default PlayerSetup;
