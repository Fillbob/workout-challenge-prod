"use client";

interface RankChangeIndicatorProps {
  /**
   * Difference between the previous rank and the current rank.
   * Positive numbers mean the user moved closer to #1, negatives mean they fell.
   */
  delta?: number | null;
}

// Small SVG chevrons to keep the arrows lightweight and consistent.
const Arrow = ({ direction }: { direction: "up" | "down" }) => {
  const rotation = direction === "up" ? "-45" : "135";
  return (
    <span className="leading-none">
      <svg
        aria-hidden
        viewBox="0 0 12 12"
        className={`h-3 w-3 text-[10px] ${direction === "up" ? "text-green-600" : "text-rose-600"}`}
      >
        <g transform={`rotate(${rotation} 6 6)`}>
          <line x1="2" y1="6" x2="6" y2="2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <line x1="6" y1="2" x2="10" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </g>
      </svg>
    </span>
  );
};

export function RankChangeIndicator({ delta }: RankChangeIndicatorProps) {
  if (!delta) return null;

  const direction: "up" | "down" = delta > 0 ? "up" : "down";
  const absoluteDelta = Math.abs(delta);
  const arrowCount = Math.min(absoluteDelta, 2);

  const ariaLabel = direction === "up" ? `Moved up ${absoluteDelta} position${absoluteDelta === 1 ? "" : "s"}`
    : `Moved down ${absoluteDelta} position${absoluteDelta === 1 ? "" : "s"}`;

  return (
    <span className="flex w-4 flex-col items-center justify-center" aria-label={ariaLabel}>
      {Array.from({ length: arrowCount }).map((_, index) => (
        <Arrow key={`${direction}-${index}`} direction={direction} />
      ))}
    </span>
  );
}
