import React, { useState } from 'react';
import { InMode, OutMode, Darts501Options } from './types';
import { ArrowLeft } from 'lucide-react';

interface Darts501SetupProps {
  onStart: (options: Darts501Options) => void;
  onBack: () => void;
}

function Darts501Setup({ onStart, onBack }: Darts501SetupProps) {
  const [startScore, setStartScore] = useState<number>(501);
  const [inMode, setInMode] = useState<InMode>('straight');
  const [outMode, setOutMode] = useState<OutMode>('double');

  const scoreOptions = [301, 501, 701];

  const inModeOptions: { value: InMode; label: string; desc: string }[] = [
    { value: 'straight', label: 'Straight In', desc: 'Sofort punkten' },
    { value: 'double', label: 'Double In', desc: 'Mit Double starten' },
  ];

  const outModeOptions: { value: OutMode; label: string; desc: string }[] = [
    { value: 'straight', label: 'Straight Out', desc: 'Beliebig auschecken' },
    { value: 'double', label: 'Double Out', desc: 'Mit Double beenden' },
    { value: 'master', label: 'Master Out', desc: 'Double oder Triple' },
  ];

  const handleStart = () => {
    onStart({ startScore, inMode, outMode });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-dark via-blue-900 to-dark p-4 flex items-center justify-center">
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
            <h1 className="text-2xl font-bold text-white">🎯 501 Setup</h1>
          </div>

          {/* Start Score */}
          <div className="mb-6">
            <label className="block text-gray-300 text-sm font-bold mb-3">Startwert</label>
            <div className="grid grid-cols-3 gap-2">
              {scoreOptions.map((score) => (
                <button
                  key={score}
                  onClick={() => setStartScore(score)}
                  className={`py-3 rounded-lg font-black text-xl transition ${
                    startScore === score
                      ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white ring-2 ring-yellow-400'
                      : 'bg-white/10 text-white hover:bg-white/20'
                  }`}
                >
                  {score}
                </button>
              ))}
            </div>
          </div>

          {/* In Mode */}
          <div className="mb-6">
            <label className="block text-gray-300 text-sm font-bold mb-3">Einstieg</label>
            <div className="space-y-2">
              {inModeOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setInMode(option.value)}
                  className={`w-full p-3 rounded-lg text-left transition ${
                    inMode === option.value
                      ? 'bg-gradient-to-r from-green-600 to-emerald-600 text-white ring-2 ring-yellow-400'
                      : 'bg-white/10 text-white hover:bg-white/20'
                  }`}
                >
                  <div className="font-bold">{option.label}</div>
                  <div className={`text-sm ${inMode === option.value ? 'text-green-100' : 'text-gray-400'}`}>
                    {option.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Out Mode */}
          <div className="mb-6">
            <label className="block text-gray-300 text-sm font-bold mb-3">Finish</label>
            <div className="space-y-2">
              {outModeOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setOutMode(option.value)}
                  className={`w-full p-3 rounded-lg text-left transition ${
                    outMode === option.value
                      ? 'bg-gradient-to-r from-red-600 to-orange-600 text-white ring-2 ring-yellow-400'
                      : 'bg-white/10 text-white hover:bg-white/20'
                  }`}
                >
                  <div className="font-bold">{option.label}</div>
                  <div className={`text-sm ${outMode === option.value ? 'text-red-100' : 'text-gray-400'}`}>
                    {option.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Summary */}
          <div className="mb-6 p-4 bg-white/5 rounded-lg border border-white/10">
            <p className="text-gray-400 text-sm mb-2">Zusammenfassung:</p>
            <p className="text-white font-bold text-lg">
              {startScore} • {inModeOptions.find(o => o.value === inMode)?.label} • {outModeOptions.find(o => o.value === outMode)?.label}
            </p>
          </div>

          {/* Start Button */}
          <button
            onClick={handleStart}
            className="w-full py-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 rounded-xl font-black text-xl text-white transition shadow-lg"
          >
            🎯 Spiel starten!
          </button>
        </div>
      </div>
    </div>
  );
}

export default Darts501Setup;
