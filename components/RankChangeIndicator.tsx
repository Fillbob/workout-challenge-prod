import React from "react";

interface RankChangeIndicatorProps {
  /**
   * Difference between a member's previous rank and their current rank.
   * A positive number means they moved up the leaderboard, a negative
   * number means they moved down.
   */
  delta?: number;
}

/**
 * Renders one or two minimal chevrons to show leaderboard movement without shifting layout.
 *
 * - A single arrow is shown for a 1 position move.
 * - Two stacked arrows are shown when the move is greater than 1 position (capped at 2).
 */
export function RankChangeIndicator({ delta }: RankChangeIndicatorProps) {
  if (!delta) return null;

  const isUp = delta > 0;
  const magnitude = Math.min(2, Math.abs(delta));
  const label = `${isUp ? "Moved up" : "Moved down"} ${Math.abs(delta)} position${Math.abs(delta) === 1 ? "" : "s"}`;
  const color = isUp ? "text-green-600" : "text-rose-600";

  return (
    <span className="ml-1 inline-flex h-6 w-6 flex-col items-center justify-center" aria-label={label}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: magnitude }).map((_, idx) => (
        <svg
          key={idx}
          viewBox="0 0 24 24"
          className={`h-3 w-3 ${color} ${idx > 0 ? "-mt-0.5" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          role="img"
          aria-hidden
        >
          {isUp ? <path d="M6 14l6-6 6 6" /> : <path d="M6 10l6 6 6-6" />}
        </svg>
      ))}
    </span>
  );
}
