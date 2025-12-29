import { DEFAULT_AUTH_MESSAGE } from "@/lib/auth-page-message";
import { getServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function isAdmin(role: string | null | undefined) {
  return role === "admin";
}

export async function GET() {
  const admin = getServiceRoleClient();

  const { data, error } = await admin
    .from("auth_page_messages")
    .select("message, updated_at")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    message: data?.message ?? DEFAULT_AUTH_MESSAGE,
    updated_at: data?.updated_at ?? null,
  });
}

export async function POST(request: Request) {
  const { message } = await request.json().catch(() => ({}));
  const trimmed = typeof message === "string" ? message.trim() : "";

  if (!trimmed) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
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

  if (profileError || !isAdmin(profile?.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = getServiceRoleClient();
  const { data, error } = await admin
    .from("auth_page_messages")
    .insert({ message: trimmed, updated_by: user.id })
    .select("message, updated_at")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message || "Unable to save message" }, { status: 500 });
  }

  return NextResponse.json({ message: data.message, updated_at: data.updated_at });
}
