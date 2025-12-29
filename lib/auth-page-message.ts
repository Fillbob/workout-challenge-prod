import { headers } from "next/headers";

export const DEFAULT_AUTH_MESSAGE =
  "This challenge is built on trust. Please be honest with your entries so the results reflect everyone's true effort.";

export async function fetchAuthPageMessage() {
  const headerList = headers();
  const host = headerList.get("host");
  const protocol = headerList.get("x-forwarded-proto") ?? "http";
  const origin = process.env.NEXT_PUBLIC_SITE_URL || (host ? `${protocol}://${host}` : "http://localhost:3000");

  try {
    const response = await fetch(new URL("/api/auth-message", origin).toString(), {
      next: { revalidate: 60 },
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Unable to load message");
    }

    const message = typeof payload.message === "string" ? payload.message.trim() : "";
    return message || DEFAULT_AUTH_MESSAGE;
  } catch (error) {
    console.error("Failed to fetch auth page message", error);
    return DEFAULT_AUTH_MESSAGE;
  }
}
