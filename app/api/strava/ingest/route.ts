import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!baseUrl) {
    return NextResponse.json({ error: "Missing Supabase URL" }, { status: 500 });
  }

  const response = await fetch(`${baseUrl}/functions/v1/strava-ingest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  let payload: Record<string, unknown> = {};
  try {
    payload = await response.json();
  } catch (error) {
    payload = { error: error instanceof Error ? error.message : "Unknown error" };
  }

  if (!response.ok) {
    return NextResponse.json({ error: (payload as { error?: string }).error || "Unable to trigger Strava sync" }, { status: response.status });
  }

  return NextResponse.json({ status: "ok", ...payload });
}
