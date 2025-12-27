import { getServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function normalizeTeamId(request: Request) {
  const url = new URL(request.url);
  const teamId = url.searchParams.get("teamId");
  return teamId ? String(teamId) : null;
}

export async function GET(request: Request) {
  const teamId = normalizeTeamId(request);

  if (!teamId) {
    return NextResponse.json({ error: "Team id is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceRoleClient();

  const { data: membership } = await admin
    .from("team_members")
    .select("team_id")
    .eq("team_id", teamId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await admin
    .from("team_messages")
    .select("id, message, team_id, user_id, created_at")
    .eq("team_id", teamId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const userIds = Array.from(new Set((data ?? []).map((row) => row.user_id).filter(Boolean)));
  let profiles: Record<string, string> = {};

  if (userIds.length > 0) {
    const { data: profileRows } = await admin
      .from("profiles")
      .select("id, display_name")
      .in("id", userIds);

    profiles = (profileRows ?? []).reduce<Record<string, string>>((map, row) => {
      if (row.id) map[row.id] = row.display_name || "Teammate";
      return map;
    }, {});
  }

  const messages = (data ?? []).map((row) => ({
    ...row,
    author_name: row.user_id ? profiles[row.user_id] ?? "Teammate" : "Teammate",
  }));

  return NextResponse.json({ messages });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const message: string | undefined = body.message;
  const teamId: string | undefined = body.teamId;

  if (!teamId || !message) {
    return NextResponse.json({ error: "Team id and message are required" }, { status: 400 });
  }

  const trimmed = message.trim();
  if (!trimmed) {
    return NextResponse.json({ error: "Message cannot be empty" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceRoleClient();

  const { data: membership } = await admin
    .from("team_members")
    .select("team_id")
    .eq("team_id", teamId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await admin
    .from("team_messages")
    .insert({ team_id: teamId, user_id: user.id, message: trimmed })
    .select("id, message, team_id, user_id, created_at")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message || "Unable to post message" }, { status: 500 });
  }

  return NextResponse.json({ message: { ...data, author_name: "You" } });
}
