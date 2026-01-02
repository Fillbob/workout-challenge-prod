import { buildStravaAuthUrl, getScopeString } from "@/lib/strava";
import { createClient } from "@/lib/supabase/server";
import crypto from "crypto";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const state = crypto.randomUUID();
  const redirectUrl = buildStravaAuthUrl(state);
  const response = NextResponse.redirect(redirectUrl);

  response.cookies.set("strava_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/strava",
    maxAge: 60 * 15,
  });

  response.headers.set("X-Strava-Scopes", getScopeString());

  return response;
}
