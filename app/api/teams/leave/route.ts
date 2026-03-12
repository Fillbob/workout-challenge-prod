import { getServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const teamId: string | undefined = body.teamId;
  const EVERYONE_TEAM_NAME = "Everyone";

  if (!teamId) {
    return NextResponse.json({ error: "Team ID is required" }, { status: 400 });
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
    .select("id, name")
    .eq("id", teamId)
    .maybeSingle();

  if (teamError) {
    return NextResponse.json({ error: teamError.message }, { status: 400 });
  }

  if (team?.name === EVERYONE_TEAM_NAME) {
    return NextResponse.json({ error: "Everyone group membership is required" }, { status: 403 });
  }

  const { error } = await admin
    .from("team_members")
    .delete()
    .eq("team_id", teamId)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ teamId });
}
