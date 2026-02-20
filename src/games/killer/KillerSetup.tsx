import React from 'react';
import { ArrowLeft, Skull } from 'lucide-react';

interface KillerSetupProps {
  onStart: () => void;
  onBack: () => void;
}

function KillerSetup({ onStart, onBack }: KillerSetupProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-dark via-red-900 to-dark p-4 flex items-center justify-center">
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
            <div className="flex items-center gap-2">
              <Skull size={28} className="text-red-400" />
              <h1 className="text-2xl font-bold text-white">Killer Darts</h1>
            </div>
          </div>

          {/* Rules Overview */}
          <div className="mb-6 p-4 bg-white/5 rounded-lg border border-white/10">
            <p className="text-gray-400 text-sm mb-2">Game Rules:</p>
            <ul className="text-white text-sm space-y-2">
              <li>🎯 <strong>Each player gets a random number</strong> (1-20)</li>
              <li>💪 <strong>Hit your number 3x</strong> to become a KILLER</li>
              <li>💀 <strong>As KILLER:</strong> Hit opponents' numbers to reduce their hits</li>
              <li>❌ <strong>At 0 hits</strong> = eliminated</li>
              <li>👑 <strong>Last player standing</strong> wins!</li>
            </ul>
          </div>

          {/* Start Button */}
          <button
            onClick={onStart}
            className="w-full py-4 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 rounded-xl font-black text-xl text-white transition shadow-lg flex items-center justify-center gap-2"
          >
            <Skull size={24} /> Start Killer!
          </button>
        </div>
      </div>
    </div>
  );
}

export default KillerSetup;
