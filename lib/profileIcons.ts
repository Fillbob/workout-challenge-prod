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
  backgroundClass: string;
  backgroundColor: string;
  accent: string;
  description: string;
}

export const profileIconOptions: ProfileIconOption[] = [
  {
    id: "flame",
    label: "Ignite",
    glyph: "🔥",
    backgroundClass: "bg-orange-500",
    backgroundColor: "#f97316",
    accent: "text-white",
    description: "For athletes who thrive on heat, hustle, and bold momentum.",
  },
  {
    id: "bolt",
    label: "Lightning",
    glyph: "⚡️",
    backgroundClass: "bg-yellow-400",
    backgroundColor: "#facc15",
    accent: "text-slate-900",
    description: "Fast movers who strike goals with electric precision.",
  },
  {
    id: "mountain",
    label: "Summit",
    glyph: "⛰️",
    backgroundClass: "bg-emerald-500",
    backgroundColor: "#10b981",
    accent: "text-white",
    description: "Steady climbers pushing through every incline.",
  },
  {
    id: "pulse",
    label: "Pulse",
    glyph: "💪",
    backgroundClass: "bg-fuchsia-600",
    backgroundColor: "#d946ef",
    accent: "text-white",
    description: "Power lifters who bring the energy every set.",
  },
  {
    id: "sunrise",
    label: "Dawn",
    glyph: "🌅",
    backgroundClass: "bg-orange-300",
    backgroundColor: "#fdba74",
    accent: "text-slate-900",
    description: "Early risers stacking wins before sunrise.",
  },
  {
    id: "trophy",
    label: "Finish Line",
    glyph: "🏆",
    backgroundClass: "bg-amber-500",
    backgroundColor: "#f59e0b",
    accent: "text-slate-900",
    description: "Goal chasers who love the taste of gold.",
  },
  {
    id: "wave",
    label: "Flow",
    glyph: "🌊",
    backgroundClass: "bg-blue-500",
    backgroundColor: "#3b82f6",
    accent: "text-white",
    description: "Smooth operators keeping momentum flowing.",
  },
  {
    id: "focus",
    label: "Focus",
    glyph: "🎯",
    backgroundClass: "bg-purple-600",
    backgroundColor: "#9333ea",
    accent: "text-white",
    description: "Precision-driven teammates who never miss.",
  },
];

export function getProfileIcon(id?: string | null) {
  return profileIconOptions.find((option) => option.id === id) ?? profileIconOptions[0];
}
