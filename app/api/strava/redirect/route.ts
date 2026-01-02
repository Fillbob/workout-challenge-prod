import { exchangeAuthorizationCode, mapStravaScope } from "@/lib/strava";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

function buildDashboardRedirect(origin: string, status: "connected" | "error", message?: string) {
  const redirectUrl = new URL("/dashboard", origin);
  redirectUrl.searchParams.set("strava", status);
  if (message) {
    redirectUrl.searchParams.set("message", message);
  }
  return redirectUrl;
}

function redirectWithClearedState(url: URL) {
  const response = NextResponse.redirect(url);
  response.cookies.set("strava_oauth_state", "", { path: "/api/strava", maxAge: 0 });
  return response;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const errorParam = requestUrl.searchParams.get("error");
  const cookieStore = await cookies();
  const storedState = cookieStore.get("strava_oauth_state")?.value;

  if (errorParam) {
    const redirectUrl = buildDashboardRedirect(requestUrl.origin, "error", errorParam);
    return redirectWithClearedState(redirectUrl);
  }

  if (!code || !state || !storedState || state !== storedState) {
    const redirectUrl = buildDashboardRedirect(requestUrl.origin, "error", "Invalid state or missing code");
    return redirectWithClearedState(redirectUrl);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const redirectUrl = buildDashboardRedirect(requestUrl.origin, "error", "Sign in to connect Strava");
    return redirectWithClearedState(redirectUrl);
  }

  try {
    const tokenResponse = await exchangeAuthorizationCode(code);
    const expiresAt = new Date(tokenResponse.expires_at * 1000).toISOString();

    const { error } = await supabase.from("strava_tokens").upsert({
      user_id: user.id,
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token,
      expires_at: expiresAt,
      athlete_id: tokenResponse.athlete?.id ?? null,
      scope: mapStravaScope(tokenResponse.scope),
      last_error: null,
      updated_at: new Date().toISOString(),
    });

    if (error) {
      const redirectUrl = buildDashboardRedirect(requestUrl.origin, "error", error.message);
      return redirectWithClearedState(redirectUrl);
    }

    const redirectUrl = buildDashboardRedirect(requestUrl.origin, "connected");
    return redirectWithClearedState(redirectUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to connect to Strava";
    const redirectUrl = buildDashboardRedirect(requestUrl.origin, "error", message);
    return redirectWithClearedState(redirectUrl);
  }
}
