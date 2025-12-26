import { getServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const teamId: string | undefined = body.teamId;

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

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profileError || profile?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = getServiceRoleClient();

  const { error: membersError } = await admin
    .from("team_members")
    .delete()
    .eq("team_id", teamId);

  if (membersError) {
    return NextResponse.json({ error: membersError.message }, { status: 400 });
  }

  const { error: teamError } = await admin.from("teams").delete().eq("id", teamId);

  if (teamError) {
    return NextResponse.json({ error: teamError.message }, { status: 400 });
  }

  return NextResponse.json({ teamId });
}
