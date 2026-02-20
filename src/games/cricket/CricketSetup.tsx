import React from 'react';
import { ArrowLeft, Skull } from 'lucide-react';

interface CricketSetupProps {
  onStart: () => void;
  onBack: () => void;
}

function CricketSetup({ onStart, onBack }: CricketSetupProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-dark via-green-900 to-dark p-4 flex items-center justify-center">
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
            <h1 className="text-2xl font-bold text-white">🎯 Cricket</h1>
          </div>

          {/* Mode Info */}
          <div className="mb-6 p-4 bg-gradient-to-r from-red-600/30 to-orange-600/30 rounded-xl border border-red-500/30">
            <div className="flex items-center gap-3 mb-2">
              <Skull size={24} className="text-red-400" />
              <span className="font-bold text-white text-lg">Cut Throat Mode</span>
            </div>
            <p className="text-red-200 text-sm">
              Points go to opponents - lowest points wins!
            </p>
          </div>

          {/* Rules Overview */}
          <div className="mb-6 p-4 bg-white/5 rounded-lg border border-white/10">
            <p className="text-gray-400 text-sm mb-2">Game Rules:</p>
            <ul className="text-white text-sm space-y-2">
              <li>🎯 <strong>Targets:</strong> 15, 16, 17, 18, 19, 20, Bull</li>
              <li>✅ <strong>3 hits</strong> = number closed</li>
              <li>💀 <strong>Hit closed number</strong> = points to all opponents!</li>
              <li>🏆 <strong>Win:</strong> Close all 7 + lowest points</li>
            </ul>
          </div>

          {/* Start Button */}
          <button
            onClick={onStart}
            className="w-full py-4 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 rounded-xl font-black text-xl text-white transition shadow-lg"
          >
            🎯 Start Cricket!
          </button>
        </div>
      </div>
    </div>
  );
}

export default CricketSetup;
