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
    backgroundClass: "bg-[#E4572E]",
    backgroundColor: "#E4572E",
    accent: "text-white",
    description: "For athletes who thrive on heat, hustle, and bold momentum.",
  },
  {
    id: "bolt",
    label: "Lightning",
    glyph: "⚡️",
    backgroundClass: "bg-[#F6C445]",
    backgroundColor: "#F6C445",
    accent: "text-slate-900",
    description: "Fast movers who strike goals with electric precision.",
  },
  {
    id: "mountain",
    label: "Summit",
    glyph: "⛰️",
    backgroundClass: "bg-[#8C5E58]",
    backgroundColor: "#8C5E58",
    accent: "text-white",
    description: "Steady climbers pushing through every incline.",
  },
  {
    id: "pulse",
    label: "Pulse",
    glyph: "💪",
    backgroundClass: "bg-[#7B5CD6]",
    backgroundColor: "#7B5CD6",
    accent: "text-white",
    description: "Power lifters who bring the energy every set.",
  },
  {
    id: "sunrise",
    label: "Dawn",
    glyph: "🌅",
    backgroundClass: "bg-[#F2A65A]",
    backgroundColor: "#F2A65A",
    accent: "text-slate-900",
    description: "Early risers stacking wins before sunrise.",
  },
  {
    id: "trophy",
    label: "Finish Line",
    glyph: "🏆",
    backgroundClass: "bg-[#2F855A]",
    backgroundColor: "#2F855A",
    accent: "text-white",
    description: "Goal chasers who love the taste of gold.",
  },
  {
    id: "wave",
    label: "Flow",
    glyph: "🌊",
    backgroundClass: "bg-[#3182CE]",
    backgroundColor: "#3182CE",
    accent: "text-white",
    description: "Smooth operators keeping momentum flowing.",
  },
  {
    id: "focus",
    label: "Focus",
    glyph: "🎯",
    backgroundClass: "bg-[#0EA5A4]",
    backgroundColor: "#0EA5A4",
    accent: "text-white",
    description: "Precision-driven teammates who never miss.",
  },
];

export function getProfileIcon(id?: string | null) {
  return profileIconOptions.find((option) => option.id === id) ?? profileIconOptions[0];
}
