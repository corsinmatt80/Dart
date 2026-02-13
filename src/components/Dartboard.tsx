import React, { useRef, useState } from 'react';
import { DARTBOARD_SECTIONS } from '../games/types';
import { HitData } from '../games/types';

interface DartboardProps {
  onHit: (hitData: HitData) => void;
  disabled?: boolean;
}

function Dartboard({ onHit, disabled = false }: DartboardProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [imageLoaded, setImageLoaded] = useState(false);

  const handleSectionClick = (section: typeof DARTBOARD_SECTIONS[0]) => {
    if (disabled) return;

    const hitData: HitData = {
      value: section.value,
      multiplier: section.multiplier,
      points: section.value * section.multiplier,
    };

    onHit(hitData);
  };

  const handleImageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled || !imageRef.current) return;

    const rect = imageRef.current.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    // Berechne relative Position zum Dartboard-Zentrum
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const deltaX = clickX - centerX;
    const deltaY = clickY - centerY;

    // Berechne Winkel und Distanz
    const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const radius = Math.min(centerX, centerY);

    // Normalisiere Distanz (0-1)
    const normalizedDistance = distance / radius;

    // Dartscheibe Zahlen (oben anfangen, clockwise)
    const dartNumbers = [
      20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5,
    ];

    // Normalisiere Winkel (0-360)
    let normalizedAngle = (angle + 90 + 360) % 360;
    const sectionIndex = Math.floor(normalizedAngle / 18) % 20;
    const dartValue = dartNumbers[sectionIndex];

    // Bestimme Multiplier basierend auf Distanz vom Zentrum
    let multiplier = 1;
    if (normalizedDistance > 0.3 && normalizedDistance < 0.45) {
      multiplier = 3; // Triple Ring
    } else if (normalizedDistance > 0.85 && normalizedDistance < 1.0) {
      multiplier = 2; // Double Ring
    } else if (normalizedDistance < 0.13) {
      // Bull (50)
      handleSectionClick(
        DARTBOARD_SECTIONS.find((s) => s.id === 'bullseye')!
      );
      return;
    } else if (normalizedDistance < 0.22) {
      // Single Bull (25)
      handleSectionClick(
        DARTBOARD_SECTIONS.find((s) => s.id === 'single_bull')!
      );
      return;
    }

    // Finde den entsprechenden Section
    const section = DARTBOARD_SECTIONS.find(
      (s) => s.value === dartValue && s.multiplier === multiplier
    );

    if (section) {
      handleSectionClick(section);
    }
  };

  return (
    <div className="w-full mx-auto" style={{ maxWidth: '600px' }}>
      <div
        className="rounded-full aspect-square relative overflow-hidden shadow-2xl cursor-pointer"
        onClick={handleImageClick}
      >
        {/* Dartboard Image */}
        <img
          ref={imageRef}
          src={`${(import.meta as any).env.BASE_URL}dartboard.png`}
          alt="Dartboard"
          className="w-full h-full object-cover absolute inset-0"
          onLoad={() => setImageLoaded(true)}
        />

        {/* Hover Overlay */}
        {!disabled && (
          <div className="absolute inset-0 opacity-0 hover:opacity-20 bg-blue-500 transition rounded-full" />
        )}

        {/* Disabled Overlay */}
        {disabled && (
          <div className="absolute inset-0 opacity-30 bg-black rounded-full flex items-center justify-center">
            <span className="text-white font-bold">Game Over</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default Dartboard;
