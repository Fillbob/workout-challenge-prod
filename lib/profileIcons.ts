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
  background: string;
  accent: string;
  description: string;
}

export const profileIconOptions: ProfileIconOption[] = [
  {
    id: "flame",
    label: "Ignite",
    glyph: "🔥",
    background: "bg-orange-500",
    accent: "text-orange-50",
    description: "For athletes who thrive on heat, hustle, and bold momentum.",
  },
  {
    id: "bolt",
    label: "Lightning",
    glyph: "⚡️",
    background: "bg-yellow-400",
    accent: "text-slate-900",
    description: "Fast movers who strike goals with electric precision.",
  },
  {
    id: "mountain",
    label: "Summit",
    glyph: "⛰️",
    background: "bg-emerald-500",
    accent: "text-white",
    description: "Steady climbers pushing through every incline.",
  },
  {
    id: "pulse",
    label: "Pulse",
    glyph: "💪",
    background: "bg-fuchsia-500",
    accent: "text-white",
    description: "Power lifters who bring the energy every set.",
  },
  {
    id: "sunrise",
    label: "Dawn",
    glyph: "🌅",
    background: "bg-orange-200",
    accent: "text-slate-900",
    description: "Early risers stacking wins before sunrise.",
  },
  {
    id: "trophy",
    label: "Finish Line",
    glyph: "🏆",
    background: "bg-amber-500",
    accent: "text-slate-900",
    description: "Goal chasers who love the taste of gold.",
  },
  {
    id: "wave",
    label: "Flow",
    glyph: "🌊",
    background: "bg-blue-500",
    accent: "text-white",
    description: "Smooth operators keeping momentum flowing.",
  },
  {
    id: "focus",
    label: "Focus",
    glyph: "🎯",
    background: "bg-purple-500",
    accent: "text-white",
    description: "Precision-driven teammates who never miss.",
  },
];

export function getProfileIcon(id?: string | null) {
  return profileIconOptions.find((option) => option.id === id) ?? profileIconOptions[0];
}
