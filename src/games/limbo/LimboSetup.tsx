import React, { useState } from 'react';
import { ArrowLeft, Heart, Target } from 'lucide-react';

interface LimboSetupProps {
  onStart: (startLimit: number, lives: number) => void;
  onBack: () => void;
}

const LIMIT_OPTIONS = [60, 80, 100, 120, 150];
const LIVES_OPTIONS = [1, 2, 3, 4, 5];

function LimboSetup({ onStart, onBack }: LimboSetupProps) {
  const [startLimit, setStartLimit] = useState(120);
  const [lives, setLives] = useState(3);

  return (
    <div className="min-h-screen bg-gradient-to-br from-dark via-purple-900 to-dark p-4 flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 border border-white/20 shadow-2xl">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={onBack}
              className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white transition"
            >
              <ArrowLeft size={20} />
            </button>
            <h1 className="text-2xl font-bold text-white">🎯 Limbo</h1>
          </div>

          {/* Start Limit Selection */}
          <div className="mb-6">
            <label className="flex items-center gap-2 text-gray-300 text-sm font-bold mb-3">
              <Target size={16} className="text-purple-400" />
              Starting Limit
            </label>
            <div className="grid grid-cols-5 gap-2">
              {LIMIT_OPTIONS.map((limit) => (
                <button
                  key={limit}
                  onClick={() => setStartLimit(limit)}
                  className={`py-3 rounded-xl font-bold text-lg transition ${
                    startLimit === limit
                      ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white ring-2 ring-yellow-400'
                      : 'bg-white/10 text-white hover:bg-white/20'
                  }`}
                >
                  {limit}
                </button>
              ))}
            </div>
          </div>

          {/* Lives Selection */}
          <div className="mb-6">
            <label className="flex items-center gap-2 text-gray-300 text-sm font-bold mb-3">
              <Heart size={16} className="text-red-400" />
              Lives per Player
            </label>
            <div className="grid grid-cols-5 gap-2">
              {LIVES_OPTIONS.map((l) => (
                <button
                  key={l}
                  onClick={() => setLives(l)}
                  className={`py-3 rounded-xl font-bold text-lg transition flex items-center justify-center gap-1 ${
                    lives === l
                      ? 'bg-gradient-to-r from-red-600 to-orange-600 text-white ring-2 ring-yellow-400'
                      : 'bg-white/10 text-white hover:bg-white/20'
                  }`}
                >
                  {l}
                  <Heart size={14} className={lives === l ? 'fill-white' : ''} />
                </button>
              ))}
            </div>
          </div>

          {/* Rules Overview */}
          <div className="mb-6 p-4 bg-white/5 rounded-lg border border-white/10">
            <p className="text-gray-400 text-sm mb-2">Game Rules:</p>
            <ul className="text-white text-sm space-y-2">
              <li>🎯 <strong>Throw 3 darts</strong> per turn</li>
              <li>📉 <strong>Total must be UNDER</strong> the current limit</li>
              <li>🎯 <strong>Your total</strong> = new limit for next player</li>
              <li>❌ <strong>Miss = 25 points!</strong></li>
              <li>💔 <strong>At or over limit</strong> = lose a life, reset to {startLimit}</li>
              <li>👑 <strong>Last player standing</strong> wins!</li>
            </ul>
          </div>

          {/* Start Button */}
          <button
            onClick={() => onStart(startLimit, lives)}
            className="w-full py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 rounded-xl font-black text-xl text-white transition shadow-lg"
          >
            🎯 Start Limbo!
          </button>
        </div>
      </div>
    </div>
  );
}

export default LimboSetup;
