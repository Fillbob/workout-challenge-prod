import { getServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { PostgrestError } from "@supabase/supabase-js";
import { randomBytes } from "crypto";
import { NextResponse } from "next/server";

function generateJoinCode() {
  return randomBytes(4)
    .toString("hex")
    .slice(0, 8)
    .toUpperCase();
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const teamName: string | undefined = body.teamName;

  if (!teamName) {
    return NextResponse.json({ error: "Team name is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceRoleClient();

  type TeamRecord = { id: string; name: string; join_code: string };

  let teamResult: TeamRecord | null = null;
  let attempt = 0;
  let lastError: PostgrestError | null = null;

  while (attempt < 5 && !teamResult) {
    const joinCode = generateJoinCode();
    const { data, error } = await admin
      .from("teams")
      .insert({ name: teamName, join_code: joinCode })
      .select("id, name, join_code")
      .single();

    if (error) {
      lastError = error;
      if (error.code === "23505") {
        attempt += 1;
        continue;
      }
      break;
    }

    teamResult = data;
  }

  if (!teamResult) {
    return NextResponse.json(
      { error: "Unable to create team" },
      { status: lastError?.code === "23505" ? 409 : 500 },
    );
  }

  const { error: memberError } = await admin
    .from("team_members")
    .insert({ team_id: teamResult.id, user_id: user.id });

  if (memberError && memberError.code !== "23505") {
    return NextResponse.json({ error: memberError.message }, { status: 400 });
  }

  return NextResponse.json({ team: teamResult });
}
