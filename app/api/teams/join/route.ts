import { getServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isValidJoinCode, normalizeJoinCode } from "@/lib/joinCodes";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const joinCode = normalizeJoinCode(body.joinCode);

  if (!joinCode) {
    return NextResponse.json({ error: "Join code is required" }, { status: 400 });
  }

  if (!isValidJoinCode(joinCode)) {
    return NextResponse.json(
      { error: "Join code must be 6-8 lowercase letters or numbers" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceRoleClient();

  const { data: team, error: teamError } = await admin
    .from("teams")
    .select("id, name, join_code")
    .eq("join_code", joinCode)
    .maybeSingle();

  if (teamError) {
    return NextResponse.json({ error: "Unable to look up join code" }, { status: 500 });
  }

  if (!team) {
    return NextResponse.json({ error: "Join code not found or expired" }, { status: 404 });
  }

  const { error: memberError } = await admin
    .from("team_members")
    .insert({ team_id: team.id, user_id: user.id });

  if (memberError && memberError.code !== "23505") {
    return NextResponse.json({ error: memberError.message }, { status: 400 });
  }

  return NextResponse.json({ team });
}
