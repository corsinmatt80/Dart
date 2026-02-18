import React, { useState } from 'react';

interface DartInputProps {
  onHit: (hitData: { x: number; y: number; value: number; multiplier: number; points: number }) => void;
  onUndo?: () => void;
  undoAvailable?: boolean;
  disabled?: boolean;
}

function DartInput({ onHit, onUndo, undoAvailable = false, disabled = false }: DartInputProps) {
  const [selectedMultiplier, setSelectedMultiplier] = useState<1 | 2 | 3>(1);
  const [recentHits, setRecentHits] = useState<Array<{ value: number; multiplier: number; points: number }>>([]);

  // Dartboard numbers chronologically from 1-20
  const dartNumbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

  const handleDartClick = (value: number) => {
    const points = value * selectedMultiplier;
    const hit = {
      x: 0,
      y: 0,
      value,
      multiplier: selectedMultiplier,
      points,
    };

    onHit(hit);
    
    // Save the hit for local display
    setRecentHits([...recentHits, { value, multiplier: selectedMultiplier, points }]);
  };

  const handleBull = (bullValue: number) => {
    // Bull is not combined with multiplier
    const hit = {
      x: 0,
      y: 0,
      value: bullValue,
      multiplier: 1,
      points: bullValue,
    };

    onHit(hit);
    setRecentHits([...recentHits, { value: bullValue, multiplier: 1, points: bullValue }]);
  };

  const handleUndo = () => {
    if (undoAvailable && onUndo) {
      onUndo();
      const newHits = [...recentHits];
      newHits.pop();
      setRecentHits(newHits);
    }
  };

  return (
    <div className="w-full space-y-4 p-4 bg-gradient-to-b from-gray-900 to-black rounded-lg">
      {/* Multiplier Selection */}
      <div className="grid grid-cols-3 gap-3">
        {([1, 2, 3] as const).map((mult) => (
          <button
            key={mult}
            onClick={() => setSelectedMultiplier(mult)}
            disabled={disabled}
            className={`py-3 px-3 rounded text-base font-bold transition ${
              selectedMultiplier === mult
                ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white ring-1 ring-yellow-400'
                : 'bg-gray-700 hover:bg-gray-600 text-gray-200 disabled:opacity-50'
            }`}
          >
            {mult}x
          </button>
        ))}
      </div>

      {/* Dartscheibe Felder Grid - 5 Spalten */}
      <div className="grid grid-cols-5 gap-1.5">
        {dartNumbers.map((num) => (
          <button
            key={num}
            onClick={() => handleDartClick(num)}
            disabled={disabled}
            className="aspect-square bg-gradient-to-br from-gray-700 to-gray-800 hover:from-blue-600 hover:to-purple-600 text-white font-bold text-base rounded transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
          >
            {num}
          </button>
        ))}
      </div>

      {/* Bull Options - kompakt */}
      <div className="grid grid-cols-3 gap-3">
        <button
          onClick={() => handleBull(25)}
          disabled={disabled}
          className="py-3 bg-red-600 hover:bg-red-700 text-white font-bold text-base rounded transition disabled:opacity-50"
        >
          25
        </button>
        <button
          onClick={() => handleBull(50)}
          disabled={disabled}
          className="py-3 bg-red-700 hover:bg-red-800 text-white font-bold text-base rounded transition disabled:opacity-50"
        >
          50
        </button>
        <button
          onClick={handleUndo}
          disabled={!undoAvailable}
          className="py-3 bg-orange-600 hover:bg-orange-700 text-white font-bold text-base rounded transition disabled:opacity-50"
        >
          ↶ Undo
        </button>
      </div>
    </div>
  );
}

export default DartInput;
