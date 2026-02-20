import React from 'react';
import { Undo2, X } from 'lucide-react';

interface CricketInputProps {
  onHit: (hitData: { value: number; multiplier: 1 | 2 | 3; points: number }) => void;
  onUndo?: () => void;
  undoAvailable?: boolean;
  disabled?: boolean;
}

const CRICKET_NUMBERS = [20, 19, 18, 17, 16, 15] as const;

function CricketInput({ onHit, onUndo, undoAvailable = false, disabled = false }: CricketInputProps) {
  
  const handleHit = (value: number, multiplier: 1 | 2 | 3) => {
    if (disabled) return;
    onHit({
      value,
      multiplier,
      points: value * multiplier,
    });
  };

  const handleMiss = () => {
    if (disabled) return;
    onHit({
      value: 0,
      multiplier: 1,
      points: 0,
    });
  };

  return (
    <div className="bg-white/10 backdrop-blur-md rounded-xl p-4 border border-white/20">
      {/* Numbers Grid */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {CRICKET_NUMBERS.map((num) => (
          <div key={num} className="space-y-1">
            <div className="text-center text-white font-black text-lg mb-1">{num}</div>
            <div className="grid grid-cols-3 gap-1">
              <button
                onClick={() => handleHit(num, 1)}
                disabled={disabled}
                className="py-2 bg-white/20 hover:bg-white/30 rounded text-white font-bold text-sm transition disabled:opacity-50"
              >
                1x
              </button>
              <button
                onClick={() => handleHit(num, 2)}
                disabled={disabled}
                className="py-2 bg-green-600/50 hover:bg-green-600/70 rounded text-white font-bold text-sm transition disabled:opacity-50"
              >
                2x
              </button>
              <button
                onClick={() => handleHit(num, 3)}
                disabled={disabled}
                className="py-2 bg-red-600/50 hover:bg-red-600/70 rounded text-white font-bold text-sm transition disabled:opacity-50"
              >
                3x
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Bull Section */}
      <div className="border-t border-white/20 pt-4 mb-4">
        <div className="text-center text-white font-black text-lg mb-2">BULL</div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => handleHit(25, 1)}
            disabled={disabled}
            className="py-3 bg-green-600/50 hover:bg-green-600/70 rounded-lg text-white font-bold transition disabled:opacity-50"
          >
            Single Bull (25)
          </button>
          <button
            onClick={() => handleHit(25, 2)}
            disabled={disabled}
            className="py-3 bg-red-600/50 hover:bg-red-600/70 rounded-lg text-white font-bold transition disabled:opacity-50"
          >
            Bulls Eye (50)
          </button>
        </div>
      </div>

      {/* Miss & Undo Section */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={handleMiss}
          disabled={disabled}
          className="py-3 bg-gray-600/50 hover:bg-gray-600/70 rounded-lg text-white font-bold transition flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <X size={18} /> Miss
        </button>
        <button
          onClick={onUndo}
          disabled={!undoAvailable || disabled}
          className="py-3 bg-orange-600/50 hover:bg-orange-600/70 rounded-lg text-white font-bold transition flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Undo2 size={18} /> Undo
        </button>
      </div>
    </div>
  );
}

export default CricketInput;
