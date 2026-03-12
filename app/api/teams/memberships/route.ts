import { getServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceRoleClient();
  const EVERYONE_TEAM_NAME = "Everyone";
  const EVERYONE_JOIN_CODE = "EVERYONE";

  const { data: existingTeam, error: teamLookupError } = await admin
    .from("teams")
    .select("id, name, join_code")
    .eq("name", EVERYONE_TEAM_NAME)
    .maybeSingle();

  if (teamLookupError) {
    return NextResponse.json({ error: teamLookupError.message }, { status: 400 });
  }

  let everyoneTeam = existingTeam;

  if (!everyoneTeam) {
    const { data: createdTeam, error: createError } = await admin
      .from("teams")
      .insert({ name: EVERYONE_TEAM_NAME, join_code: EVERYONE_JOIN_CODE })
      .select("id, name, join_code")
      .single();

    if (createError) {
      return NextResponse.json({ error: createError.message }, { status: 400 });
    }

    everyoneTeam = createdTeam;
  }

  if (everyoneTeam?.id) {
    const { error: membershipError } = await admin
      .from("team_members")
      .upsert({ team_id: everyoneTeam.id, user_id: user.id }, { onConflict: "team_id,user_id" });

    if (membershipError) {
      return NextResponse.json({ error: membershipError.message }, { status: 400 });
    }
  }

  const { data, error } = await admin
    .from("team_members")
    .select("team_id, teams(id, name, join_code)")
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ teams: data ?? [] });
}
