import React from 'react';
import { useAppStore } from '../store/appStore';
import { navigateTo, navigateToMenu } from '../App';
import { Skull, Target, RotateCcw, Smartphone, CircleDot, TrendingDown } from 'lucide-react';

function GameMenu() {
  const { players, setPlayers } = useAppStore();

  const selectGame = (game: 'killer' | 'darts501' | 'cricket' | 'limbo') => {
    navigateTo(game);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-dark via-blue-900 to-dark flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <h1 className="text-4xl font-bold text-center mb-2 text-accent">Game Selection</h1>
        <p className="text-center text-gray-400 mb-12">Choose your Dart game</p>

        {/* Handy-Kamera verbinden */}
        <button
          onClick={() => navigateTo('connect')}
          className="w-full bg-blue-600/30 border border-blue-500 rounded-lg p-4 mb-8 text-left hover:bg-blue-600/50 transition flex items-center gap-3"
        >
          <Smartphone className="text-blue-400" size={24} />
          <div className="flex-1">
            <h3 className="text-white font-bold">📱 Mit Handy-Kamera verbinden</h3>
            <p className="text-blue-200 text-sm">
              QR-Code anzeigen, mit dem Handy scannen — das Kamerabild wird hier live ausgewertet.
            </p>
          </div>
        </button>

        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {/* Killer Card */}
          <div
            onClick={() => selectGame('killer')}
            className="bg-white/10 backdrop-blur-md rounded-lg p-6 cursor-pointer hover:bg-white/20 transition transform hover:scale-105 border border-white/30"
          >
            <Skull className="text-red-500 mb-4" size={40} />
            <h2 className="text-2xl font-bold text-white mb-2">Killer</h2>
            <p className="text-gray-300 mb-4">
              The classic elimination game. Get three on your number, then eliminate opponents.
            </p>
            <div className="text-red-500 font-semibold">Click to Play →</div>
          </div>

          {/* 501 Card */}
          <div
            onClick={() => selectGame('darts501')}
            className="bg-white/10 backdrop-blur-md rounded-lg p-6 cursor-pointer hover:bg-white/20 transition transform hover:scale-105 border border-white/30"
          >
            <Target className="text-accent mb-4" size={40} />
            <h2 className="text-2xl font-bold text-white mb-2">501</h2>
            <p className="text-gray-300 mb-4">
              The professional scoring game. Count down from 501 to exactly 0 on a double.
            </p>
            <div className="text-accent font-semibold">Click to Play →</div>
          </div>

          {/* Cricket Card */}
          <div
            onClick={() => selectGame('cricket')}
            className="bg-white/10 backdrop-blur-md rounded-lg p-6 cursor-pointer hover:bg-white/20 transition transform hover:scale-105 border border-white/30"
          >
            <CircleDot className="text-green-400 mb-4" size={40} />
            <h2 className="text-2xl font-bold text-white mb-2">Cricket</h2>
            <p className="text-gray-300 mb-4">
              Hit 15-20 and Bull three times to close, then score points. First to close all wins!
            </p>
            <div className="text-green-400 font-semibold">Click to Play →</div>
          </div>

          {/* Limbo Card */}
          <div
            onClick={() => selectGame('limbo')}
            className="bg-white/10 backdrop-blur-md rounded-lg p-6 cursor-pointer hover:bg-white/20 transition transform hover:scale-105 border border-white/30"
          >
            <TrendingDown className="text-purple-400 mb-4" size={40} />
            <h2 className="text-2xl font-bold text-white mb-2">Limbo</h2>
            <p className="text-gray-300 mb-4">
              How low can you go? Throw 3 darts under the limit. Your total sets the new limit!
            </p>
            <div className="text-purple-400 font-semibold">Click to Play →</div>
          </div>
        </div>

        <button
          onClick={() => { setPlayers([]); navigateToMenu(); }}
          className="w-full px-6 py-3 bg-white/10 hover:bg-white/20 rounded-lg font-bold text-white transition flex items-center justify-center gap-2 border border-white/30"
        >
          <RotateCcw size={20} /> Change Players
        </button>

        {/* Players Info */}
        <div className="mt-8 bg-white/5 rounded-lg p-4 border border-white/20">
          <p className="text-gray-400 text-sm mb-2">Players ({players.length})</p>
          <div className="flex flex-wrap gap-2">
            {players.map((player) => (
              <span key={player.id} className="bg-accent/20 text-accent px-3 py-1 rounded-full text-sm">
                {player.name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default GameMenu;
