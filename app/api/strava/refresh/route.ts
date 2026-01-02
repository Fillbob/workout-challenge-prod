import { mapStravaScope, refreshStravaToken } from "@/lib/strava";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const REFRESH_THRESHOLD_MS = 10 * 60 * 1000;

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: tokenRow, error: tokenError } = await supabase
    .from("strava_tokens")
    .select("access_token, refresh_token, expires_at, athlete_id, last_error")
    .eq("user_id", user.id)
    .maybeSingle();

  if (tokenError) {
    return NextResponse.json({ error: tokenError.message }, { status: 500 });
  }

  if (!tokenRow) {
    return NextResponse.json({ status: "disconnected" });
  }

  const expiresAt = new Date(tokenRow.expires_at).getTime();
  const now = Date.now();
  const shouldRefresh = Number.isNaN(expiresAt) || expiresAt - now < REFRESH_THRESHOLD_MS;

  if (!shouldRefresh) {
    return NextResponse.json({
      status: "connected",
      athlete_id: tokenRow.athlete_id,
      expires_at: tokenRow.expires_at,
      last_error: tokenRow.last_error,
    });
  }

  try {
    const refreshed = await refreshStravaToken(tokenRow.refresh_token);
    const expiresAtIso = new Date(refreshed.expires_at * 1000).toISOString();

    const { error: updateError } = await supabase
      .from("strava_tokens")
      .update({
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        expires_at: expiresAtIso,
        athlete_id: refreshed.athlete?.id ?? tokenRow.athlete_id ?? null,
        scope: mapStravaScope(refreshed.scope),
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      status: "connected",
      athlete_id: refreshed.athlete?.id ?? tokenRow.athlete_id ?? null,
      expires_at: expiresAtIso,
      last_error: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to refresh Strava tokens";

    await supabase
      .from("strava_tokens")
      .update({ last_error: message, updated_at: new Date().toISOString() })
      .eq("user_id", user.id);

    return NextResponse.json({ error: message, last_error: message }, { status: 500 });
  }
}
