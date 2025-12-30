export type ProfileIconId =
  | "flame"
  | "bolt"
  | "mountain"
  | "pulse"
  | "sunrise"
  | "trophy"
  | "wave"
  | "focus";

export interface ProfileIconOption {
  id: ProfileIconId;
  label: string;
  glyph: string;
  gradient: string;
  accent: string;
  description: string;
}

export const profileIconOptions: ProfileIconOption[] = [
  {
    id: "flame",
    label: "Ignite",
    glyph: "🔥",
    gradient: "from-orange-500 via-amber-500 to-rose-500",
    accent: "text-orange-50",
    description: "For athletes who thrive on heat, hustle, and bold momentum.",
  },
  {
    id: "bolt",
    label: "Lightning",
    glyph: "⚡️",
    gradient: "from-amber-400 via-orange-500 to-amber-600",
    accent: "text-white",
    description: "Fast movers who strike goals with electric precision.",
  },
  {
    id: "mountain",
    label: "Summit",
    glyph: "⛰️",
    gradient: "from-amber-200 via-orange-200 to-rose-200",
    accent: "text-slate-900",
    description: "Steady climbers pushing through every incline.",
  },
  {
    id: "pulse",
    label: "Pulse",
    glyph: "💪",
    gradient: "from-rose-400 via-orange-400 to-amber-300",
    accent: "text-white",
    description: "Power lifters who bring the energy every set.",
  },
  {
    id: "sunrise",
    label: "Dawn",
    glyph: "🌅",
    gradient: "from-amber-300 via-orange-300 to-rose-300",
    accent: "text-slate-900",
    description: "Early risers stacking wins before sunrise.",
  },
  {
    id: "trophy",
    label: "Finish Line",
    glyph: "🏆",
    gradient: "from-yellow-300 via-amber-400 to-orange-500",
    accent: "text-slate-900",
    description: "Goal chasers who love the taste of gold.",
  },
  {
    id: "wave",
    label: "Flow",
    glyph: "🌊",
    gradient: "from-sky-300 via-blue-300 to-emerald-200",
    accent: "text-slate-900",
    description: "Smooth operators keeping momentum flowing.",
  },
  {
    id: "focus",
    label: "Focus",
    glyph: "🎯",
    gradient: "from-amber-300 via-orange-400 to-pink-400",
    accent: "text-white",
    description: "Precision-driven teammates who never miss.",
  },
];

export function getProfileIcon(id?: string | null) {
  return profileIconOptions.find((option) => option.id === id) ?? profileIconOptions[0];
}
