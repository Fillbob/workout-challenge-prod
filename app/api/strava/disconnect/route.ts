import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: tokenRow, error: tokenError } = await supabase
    .from("strava_connections")
    .select("access_token")
    .eq("user_id", user.id)
    .maybeSingle();

  if (tokenError) {
    return NextResponse.json({ error: tokenError.message }, { status: 500 });
  }

  if (tokenRow?.access_token) {
    const params = new URLSearchParams({ token: tokenRow.access_token });
    await fetch("https://www.strava.com/oauth/deauthorize", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    }).catch(() => {
      /* best effort revoke */
    });
  }

  const { error: deleteError } = await supabase
    .from("strava_connections")
    .delete()
    .eq("user_id", user.id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ status: "disconnected" });
}
