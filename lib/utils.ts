import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const hasEnvVars =
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function getSiteUrl() {
  const url =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_VERCEL_URL ||
    process.env.VERCEL_URL;

  if (url) {
    return url.startsWith("http") ? url : `https://${url}`;
  }

  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return process.env.NODE_ENV === "development"
    ? "http://localhost:3000"
    : "https://workout-challenge-prod.vercel.app";
}

export function getDashboardUrl() {
  return `${getSiteUrl()}/dashboard`;
}

export function getLoginUrl() {
  return `${getSiteUrl()}/auth/login`;
}
