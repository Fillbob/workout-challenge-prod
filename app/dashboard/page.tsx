"use client";

import { useRequireUser } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { useCallback, useEffect, useMemo, useState } from "react";

interface Challenge {
  id: string;
  week_index: number;
  challenge_index: number;
  title: string;
  description: string;
  start_date: string | null;
  end_date: string | null;
  base_points: number;
  team_ids: string[] | null;
}

interface Submission {
  id?: string;
  challenge_id: string;
  user_id: string;
  completed: boolean;
  completed_at: string | null;
}

interface RecentSubmission {
  id: string;
  user_id: string;
  challenge_id: string;
  challenge_title: string;
  completed_at: string | null;
  name: string;
}

interface TeamRow {
  team_id: string;
  team: {
    id: string;
    name: string;
    join_code: string;
  } | null;
}

interface LocalTeam {
  id: string;
  name: string;
  join_code: string;
  owner_id: string;
  members: string[];
}

interface WeeklyPoints {
  week: number;
  points: number;
}

interface ChallengeClosingInfo {
  isEditable: boolean;
  closingLabel: string;
  lockDateLabel: string | null;
  daysUntilClose: number | null;
}

const MILLISECONDS_IN_DAY = 1000 * 60 * 60 * 24;
const EDIT_GRACE_PERIOD_DAYS = 2;
const FALLBACK_CLOSING_INFO: ChallengeClosingInfo = {
  isEditable: true,
  closingLabel: "Loading challenge timing...",
  lockDateLabel: null,
  daysUntilClose: null,
};

function parseDateSafe(value: string | null): Date | null {
  if (!value) return null;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getChallengeClosingInfo(challenge: Challenge, now: Date): ChallengeClosingInfo {
  const endDate = parseDateSafe(challenge.end_date);

  if (!endDate) {
    return {
      isEditable: true,
      closingLabel: "Closing date not set",
      lockDateLabel: null,
      daysUntilClose: null,
    };
  }

  const lockDate = addDays(endDate, EDIT_GRACE_PERIOD_DAYS);
  const timeRemaining = lockDate.getTime() - now.getTime();
  const daysUntilClose = Math.max(0, Math.ceil(timeRemaining / MILLISECONDS_IN_DAY));

  return {
    isEditable: timeRemaining >= 0,
    closingLabel: timeRemaining >= 0 ? `Closing in ${daysUntilClose} day${daysUntilClose === 1 ? "" : "s"}` : "Closed",
    lockDateLabel: lockDate.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    daysUntilClose,
  };
}

const LOCAL_TEAM_STORAGE_KEY = "localTeams";

function readLocalTeams() {
  if (typeof window === "undefined") return [] as LocalTeam[];
  const raw = window.localStorage.getItem(LOCAL_TEAM_STORAGE_KEY);
  if (!raw) return [] as LocalTeam[];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [] as LocalTeam[];

    return parsed
      .map((team) => ({
        id: String(team.id ?? ""),
        name: String(team.name ?? ""),
        join_code: String(team.join_code ?? ""),
        owner_id: String(team.owner_id ?? ""),
        members: Array.isArray(team.members) ? team.members.map(String) : [],
      }))
      .filter((team) => team.id && team.name && team.join_code && team.owner_id);
  } catch (error) {
    console.error("Unable to read local teams", error);
    return [] as LocalTeam[];
  }
}

function writeLocalTeams(teams: LocalTeam[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCAL_TEAM_STORAGE_KEY, JSON.stringify(teams));
}

function addLocalMembership(team: LocalTeam, userId: string) {
  if (team.members.includes(userId)) return team;
  return { ...team, members: [...team.members, userId] };
}

function removeLocalMembership(teamId: string, userId: string) {
  const teams = readLocalTeams();
  const updated = teams
    .map((team) =>
      team.id === teamId
        ? { ...team, members: team.members.filter((member: string) => member !== userId) }
        : team,
    )
    .filter((team) => team.members.length > 0);

  writeLocalTeams(updated);
  return updated;
}

function localTeamsForUser(userId: string | null) {
  if (!userId) return [] as TeamRow[];
  return readLocalTeams()
    .filter((team) => team.members.includes(userId))
    .map((team) => ({
      team_id: team.id,
      team: { id: team.id, name: team.name, join_code: team.join_code },
    }));
}

function mergeTeams(primary: TeamRow[], extras: TeamRow[]) {
  const seen = new Set(primary.map((team) => team.team?.id ?? team.team_id));
  const merged = [...primary];

  extras.forEach((team) => {
    const identifier = team.team?.id ?? team.team_id;
    if (!identifier || seen.has(identifier)) return;
    merged.push(team);
    seen.add(identifier);
  });

  return merged;
}

function LineChart({ data }: { data: WeeklyPoints[] }) {
  if (data.length === 0) return null;

  const width = 260;
  const height = 120;
  const padding = 12;
  const maxPoints = Math.max(...data.map((entry) => entry.points));
  const xStep = data.length > 1 ? (width - padding * 2) / (data.length - 1) : 0;

  const coordinates = data.map((entry, index) => {
    const x = padding + xStep * index;
    const y =
      height - padding - (maxPoints === 0 ? 0 : (entry.points / maxPoints) * (height - padding * 2));

    return { ...entry, x, y };
  });

  const polylinePoints = coordinates.map((point) => `${point.x},${point.y}`).join(" ");
  const areaPoints = `${padding},${height - padding} ${polylinePoints} ${
    coordinates[coordinates.length - 1].x
  },${height - padding}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Points earned by week">
      <defs>
        <linearGradient id="pointsGradient" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#fb923c" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#fdba74" stopOpacity="0.08" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width={width} height={height} fill="transparent" rx="8" />
      <polyline fill="url(#pointsGradient)" stroke="none" points={areaPoints} />
      <polyline
        points={polylinePoints}
        fill="none"
        stroke="#f97316"
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {coordinates.map((point) => (
        <g key={point.week}>
          <circle cx={point.x} cy={point.y} r={4} fill="#fff7ed" stroke="#ea580c" strokeWidth={1.5} />
          <text
            x={point.x}
            y={height - 2}
            textAnchor="middle"
            className="fill-slate-500"
            fontSize={10}
          >
            W{point.week}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default function DashboardPage() {
  const supabase = getSupabaseClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [userIdentifier, setUserIdentifier] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profileRole, setProfileRole] = useState<string | null>(null);
  const [profileStatus, setProfileStatus] = useState<string | null>(null);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [joinCode, setJoinCode] = useState("");
  const [teamStatus, setTeamStatus] = useState<string | null>(null);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [submissions, setSubmissions] = useState<Record<string, Submission>>({});
  const [changedIds, setChangedIds] = useState<Set<string>>(new Set());
  const [saveStatus, setSaveStatus] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [recentSubmissions, setRecentSubmissions] = useState<RecentSubmission[]>([]);
  const [recentStatus, setRecentStatus] = useState<string | null>(null);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentHasMore, setRecentHasMore] = useState(false);
  const [recentOffset, setRecentOffset] = useState(0);
  const [showClosedChallenges, setShowClosedChallenges] = useState(false);
  const [currentTime, setCurrentTime] = useState<Date | null>(null);

  const RECENT_PAGE_SIZE = 8;

  useEffect(() => {
    setCurrentTime(new Date());
  }, []);

  const handleActiveTeamChange = useCallback((teamId: string) => {
    setActiveTeamId(teamId);
    window.localStorage.setItem("activeTeamId", teamId);
  }, []);

  const clearActiveTeam = useCallback(() => {
    setActiveTeamId(null);
    window.localStorage.removeItem("activeTeamId");
  }, []);

  const initializeProfile = useCallback(
    async (id: string) => {
      setProfileStatus(null);
      const { data: authData } = await supabase.auth.getUser();
      const emailIdentifier = authData.user?.email?.split("@")[0] || authData.user?.email || null;
      setUserIdentifier(emailIdentifier);
      const fallbackName = emailIdentifier || "New athlete";

      const { data: existing, error } = await supabase
        .from("profiles")
        .select("display_name, role")
        .eq("id", id)
        .maybeSingle();

      if (error) {
        setProfileStatus(error.message);
        return;
      }

      if (!existing) {
        const { error: insertError } = await supabase
          .from("profiles")
          .insert({ id, display_name: fallbackName, role: "user" });

        if (insertError) {
          setProfileStatus(insertError.message);
          return;
        }

        setProfileName(fallbackName);
        setProfileRole("user");
        return;
      }

      setProfileName(existing.display_name || fallbackName);
      setProfileRole(existing.role || "user");
    },
    [supabase],
  );

  const loadTeams = useCallback(async () => {
    const local = localTeamsForUser(userId);

    try {
      const response = await fetch("/api/teams/memberships");
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Unable to load teams");
      }

      const normalizedTeams: TeamRow[] = (payload.teams ?? []).map((row: { team_id: string; teams?: TeamRow["team"] }) => ({
        team_id: String(row.team_id),
        team: Array.isArray(row.teams) ? row.teams[0] : row.teams ?? null,
      }));

      setTeams(mergeTeams(local, normalizedTeams));
      setTeamStatus(null);
    } catch (error) {
      console.warn("Falling back to local teams", error);
      setTeamStatus(error instanceof Error ? error.message : "Unable to load teams");
      setTeams(local);
    }
  }, [userId]);

  const loadChallenges = useCallback(async () => {
    const { data, error } = await supabase
      .from("challenges")
      .select("*")
      .order("week_index", { ascending: true })
      .order("challenge_index", { ascending: true });
    if (error) {
      setSaveStatus({ message: error.message, tone: "error" });
      return;
    }
    const normalized = (data ?? []).map((challenge) => {
      const parsedIndex = Number(challenge.challenge_index);

      return {
        ...challenge,
        challenge_index: Number.isFinite(parsedIndex) ? parsedIndex : 1,
        team_ids: challenge.team_ids ?? [],
      };
    });
    setChallenges(normalized as Challenge[]);
  }, [supabase]);

  const loadSubmissions = useCallback(
    async (id: string) => {
      const { data, error } = await supabase
        .from("submissions")
        .select("id, challenge_id, completed, completed_at, user_id")
        .eq("user_id", id);
      if (error) {
        setSaveStatus({ message: error.message, tone: "error" });
        return;
      }
      const map: Record<string, Submission> = {};
      (data ?? []).forEach((row) => {
        map[row.challenge_id] = row;
      });
      setSubmissions(map);
    },
    [supabase],
  );

  useRequireUser((id) => {
    setUserId(id);
  });

  useEffect(() => {
    if (!userId) return;
    initializeProfile(userId);
    loadTeams();
    loadChallenges();
    loadSubmissions(userId);
    const stored = window.localStorage.getItem("activeTeamId");
    if (stored) setActiveTeamId(stored);
  }, [userId, initializeProfile, loadTeams, loadChallenges, loadSubmissions]);

  useEffect(() => {
    if (teams.length === 0) {
      clearActiveTeam();
      return;
    }
    if (activeTeamId && teams.some((team) => team.team?.id === activeTeamId)) return;

    const firstTeamId = teams[0]?.team?.id;
    if (firstTeamId) handleActiveTeamChange(firstTeamId);
  }, [teams, activeTeamId, handleActiveTeamChange, clearActiveTeam]);

  useEffect(() => {
    if (!saveStatus) return;

    const timer = window.setTimeout(() => setSaveStatus(null), 4000);
    return () => window.clearTimeout(timer);
  }, [saveStatus]);

  const handleProfileSave = async () => {
    if (!userId) return;
    const trimmedName = profileName.trim();
    if (!trimmedName) {
      setProfileStatus("Name cannot be empty");
      return;
    }
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: trimmedName })
      .eq("id", userId);
    if (error) {
      setProfileStatus(error.message);
    } else {
      setProfileStatus("Name updated");
    }
  };

  const handleJoinTeam = async () => {
    setTeamStatus(null);
    const trimmedCode = joinCode.trim();

    if (!trimmedCode) {
      setTeamStatus("Join code is required");
      return;
    }

    try {
      const response = await fetch("/api/teams/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinCode: trimmedCode }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Unable to join team");
      }

      setTeamStatus("Joined team");
      setJoinCode("");
      if (result.team?.id) handleActiveTeamChange(String(result.team.id));
      loadTeams();
      return;
    } catch (error) {
      console.warn("Falling back to local join", error);
    }

    if (!userId) {
      setTeamStatus("You must be signed in to join a team");
      return;
    }

    const local = readLocalTeams();
    const target = local.find(
      (team) => team.name.toLowerCase() === trimmedCode.toLowerCase() || team.join_code.toLowerCase() === trimmedCode.toLowerCase(),
    );

    if (!target) {
      setTeamStatus("Team not found");
      return;
    }

    const updated = addLocalMembership(target, userId);
    const nextTeams = local.map((team) => (team.id === target.id ? updated : team));
    writeLocalTeams(nextTeams);
    setTeams((prev) => mergeTeams(prev, [{ team_id: updated.id, team: updated }]));
    setTeamStatus("Joined team");
    setJoinCode("");
    handleActiveTeamChange(updated.id);
  };

  const handleLeaveTeam = async (teamId: string) => {
    setTeamStatus(null);

    if (!userId) {
      setTeamStatus("You must be signed in to leave a team");
      return;
    }

    let leftServer = false;

    try {
      const response = await fetch("/api/teams/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId }),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Unable to leave team");
      }

      leftServer = true;
    } catch (error) {
      console.warn("Falling back to local team removal", error);
    }

    removeLocalMembership(teamId, userId);
    const localMemberships = localTeamsForUser(userId);

    setTeams((prev) => {
      const filtered = prev.filter((team) => team.team?.id !== teamId && team.team_id !== teamId);
      const merged = mergeTeams(localMemberships, filtered);

      if (activeTeamId === teamId) {
        const nextTeamId = merged[0]?.team?.id;
        if (nextTeamId) {
          handleActiveTeamChange(nextTeamId);
        } else {
          clearActiveTeam();
        }
      }

      return merged;
    });

    setTeamStatus(leftServer ? "Left team" : "Left team locally");
  };

  const userTeamIds = useMemo(() => {
    return teams
      .map((team) => team.team?.id ?? team.team_id)
      .filter((id): id is string => Boolean(id));
  }, [teams]);

  const visibleChallenges = useMemo(() => {
    return challenges.filter((challenge) => {
      const allowedTeams = challenge.team_ids ?? [];
      if (allowedTeams.length === 0) return true;
      if (activeTeamId) return allowedTeams.includes(activeTeamId);
      return allowedTeams.some((teamId) => userTeamIds.includes(teamId));
    });
  }, [activeTeamId, challenges, userTeamIds]);

  const { openChallenges, closedChallenges } = useMemo(() => {
    const now = new Date();
    const open: Challenge[] = [];
    const closed: Challenge[] = [];

    visibleChallenges.forEach((challenge) => {
      const closingInfo = getChallengeClosingInfo(challenge, now);
      if (closingInfo.isEditable) {
        open.push(challenge);
      } else {
        closed.push(challenge);
      }
    });

    return { openChallenges: open, closedChallenges: closed };
  }, [visibleChallenges]);

  const submissionState = useMemo(() => {
    const map: Record<string, boolean> = {};
    visibleChallenges.forEach((c) => {
      map[c.id] = submissions[c.id]?.completed ?? false;
    });
    return map;
  }, [submissions, visibleChallenges]);

  const totalPoints = useMemo(() => {
    return visibleChallenges.reduce((sum, challenge) => {
      return submissionState[challenge.id] ? sum + (challenge.base_points || 0) : sum;
    }, 0);
  }, [submissionState, visibleChallenges]);

  const weeklyPoints = useMemo(() => {
    const totals: Record<number, number> = {};

    visibleChallenges.forEach((challenge) => {
      if (!submissionState[challenge.id]) return;
      totals[challenge.week_index] = (totals[challenge.week_index] || 0) + (challenge.base_points || 0);
    });

    return Object.entries(totals)
      .map<WeeklyPoints>(([week, points]) => ({ week: Number(week), points }))
      .sort((a, b) => a.week - b.week);
  }, [submissionState, visibleChallenges]);

  const toggleChallenge = (challenge: Challenge, checked: boolean) => {
    const closingInfo = getChallengeClosingInfo(challenge, new Date());

    if (!closingInfo.isEditable) {
      setSaveStatus({ message: "This challenge is locked and can no longer be edited.", tone: "error" });
      return;
    }

    const id = challenge.id;

    setSubmissions((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || { challenge_id: id, user_id: userId!, completed_at: null }),
        challenge_id: id,
        user_id: userId!,
        completed: checked,
        completed_at: checked ? new Date().toISOString() : null,
      },
    }));
    setChangedIds((prev) => new Set([...Array.from(prev), id]));
  };

  const handleSaveSubmissions = async () => {
    if (!userId || changedIds.size === 0 || isSaving) return;
    setSaveStatus(null);
    setIsSaving(true);
    console.log("Saving submissions via", process.env.NEXT_PUBLIC_SUPABASE_URL);
    const now = new Date();
    const editableChallengeIds = new Set(
      challenges.filter((challenge) => getChallengeClosingInfo(challenge, now).isEditable).map((challenge) => challenge.id),
    );
    const skippedIds = Array.from(changedIds).filter((id) => !editableChallengeIds.has(id));

    const payload = Array.from(changedIds)
      .filter((id) => editableChallengeIds.has(id))
      .map((id) => ({
        challenge_id: id,
        user_id: userId,
        completed: submissions[id]?.completed ?? false,
        completed_at: submissions[id]?.completed ? submissions[id]?.completed_at : null,
      }));

    if (payload.length === 0) {
      setSaveStatus({
        message: skippedIds.length > 0 ? "Edits are locked for these challenges." : "No changes to save.",
        tone: "error",
      });
      setIsSaving(false);
      return;
    }

    try {
      const { error } = await supabase
        .from("submissions")
        .upsert(payload, { onConflict: "challenge_id,user_id" });

      if (error) {
        setSaveStatus({ message: error.message, tone: "error" });
      } else {
        const message = skippedIds.length > 0 ? "Progress saved. Locked challenges were not updated." : "Progress saved";
        setSaveStatus({ message, tone: "success" });
        setChangedIds(new Set());
        loadSubmissions(userId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save progress";
      setSaveStatus({ message, tone: "error" });
    } finally {
      setIsSaving(false);
    }
  };

  const activeTeamName = teams.find((t) => t.team?.id === activeTeamId)?.team?.name;
  const hasChanges = changedIds.size > 0;
  const saveDisabled = !hasChanges || isSaving;

  const loadRecentActivity = useCallback(
    async (teamId: string, reset = false) => {
      setRecentStatus(null);
      setRecentLoading(true);

      const nextOffset = reset ? 0 : recentOffset;

      try {
        const response = await fetch(
          `/api/teams/recent-submissions?teamId=${teamId}&limit=${RECENT_PAGE_SIZE}&offset=${nextOffset}`,
        );
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "Unable to load recent submissions");
        }

        const submissions: RecentSubmission[] = payload.submissions ?? [];
        setRecentSubmissions((prev) => (reset ? submissions : [...prev, ...submissions]));
        setRecentHasMore(Boolean(payload.hasMore));
        setRecentOffset(nextOffset + submissions.length);
      } catch (error) {
        setRecentStatus(error instanceof Error ? error.message : "Unable to load recent submissions");
      } finally {
        setRecentLoading(false);
      }
    },
    [RECENT_PAGE_SIZE, recentOffset],
  );

  useEffect(() => {
    if (!activeTeamId) return;
    loadRecentActivity(activeTeamId, true);
  }, [activeTeamId, loadRecentActivity]);

  const formatTimestamp = (value: string | null) => {
    if (!value) return "";
    return new Date(value).toLocaleString();
  };

  const nextClosing = useMemo(() => {
    const now = new Date();
    const candidates = openChallenges
      .map((challenge) => ({ challenge, info: getChallengeClosingInfo(challenge, now) }))
      .filter(({ info }) => info.daysUntilClose !== null);

    if (candidates.length === 0) return null;

    const nearest = candidates.reduce((closest, current) => {
      const currentDays = current.info.daysUntilClose ?? Number.POSITIVE_INFINITY;
      const closestDays = closest.info.daysUntilClose ?? Number.POSITIVE_INFINITY;
      return currentDays < closestDays ? current : closest;
    });

    return {
      title: nearest.challenge.title,
      daysUntilClose: nearest.info.daysUntilClose,
      lockDateLabel: nearest.info.lockDateLabel,
      closingLabel: nearest.info.closingLabel,
    };
  }, [openChallenges]);

  const cardClass =
    "rounded-2xl border border-orange-100 bg-white/90 shadow-lg shadow-orange-100/60 backdrop-blur";

  return (
    <main className="min-h-screen text-slate-900">
      <div className="max-w-6xl mx-auto px-6 py-10 space-y-8">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-orange-600">Dashboard</p>
            <h1 className="text-3xl font-semibold">
              Welcome back{profileName ? `, ${profileName}` : ""}
            </h1>
            <p className="text-slate-600">
              Track your teams, complete weekly challenges, and climb the leaderboard.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <a className="text-sm font-semibold text-orange-700 hover:text-orange-800" href="/leaderboard">
              Leaderboard
            </a>
            <button
              className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-slate-800"
              onClick={async () => {
                await supabase.auth.signOut();
                window.location.href = "/";
              }}
            >
              Sign out
            </button>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className={`${cardClass} space-y-4 bg-gradient-to-br from-orange-100 via-white to-amber-100 p-6`}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold text-orange-600">Points</p>
                <h2 className="text-4xl font-semibold text-slate-900">{totalPoints}</h2>
                <p className="text-slate-600 text-sm">Points earned from completed challenges.</p>
              </div>
              <span className="rounded-full border border-orange-200 bg-white/70 px-3 py-1 text-xs font-semibold text-orange-700">
                {weeklyPoints.length} weeks tracked
              </span>
            </div>
            <div className="rounded-xl border border-orange-100 bg-white/80 p-4">
              {weeklyPoints.length === 0 ? (
                <p className="text-sm text-slate-500">Complete challenges to see your trend.</p>
              ) : (
                <LineChart data={weeklyPoints} />
              )}
            </div>
            {weeklyPoints.length > 0 && (
              <div className="flex flex-wrap gap-2 text-xs text-orange-700">
                {weeklyPoints.map((entry) => (
                  <span key={entry.week} className="rounded-full border border-orange-200 bg-orange-50 px-2 py-1">
                    Week {entry.week}: {entry.points} pts
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className={`${cardClass} lg:col-span-2 space-y-4 p-6`}>
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-orange-600">Weekly challenges</p>
                <h2 className="text-xl font-semibold text-slate-900">Stay on track</h2>
                <p className="text-sm text-slate-600">
                  {nextClosing
                    ? `${nextClosing.closingLabel}${nextClosing.lockDateLabel ? ` · Locks ${nextClosing.lockDateLabel}` : ""}`
                    : "No deadlines set yet."}
                </p>
              </div>
              <div className="flex h-24 w-24 items-center justify-center rounded-full border-8 border-orange-200 bg-orange-50 text-center shadow-inner">
                <div>
                  <p className="text-3xl font-bold text-orange-600">{nextClosing?.daysUntilClose ?? "--"}</p>
                  <p className="text-xs text-slate-500">days left</p>
                </div>
              </div>
            </div>
            <div className="grid gap-2 text-sm text-slate-600">
              <p>
                <span className="font-semibold text-slate-900">{openChallenges.length}</span> active challenges
              </p>
              <p>
                <span className="font-semibold text-slate-900">{closedChallenges.length}</span> closed challenges
              </p>
              <p>
                <span className="font-semibold text-slate-900">{Object.values(submissionState).filter(Boolean).length}</span> completed so far
              </p>
              <p>Active team: {activeTeamName ?? "None selected"}</p>
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className={`${cardClass} lg:col-span-2 space-y-4 p-6`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-orange-600">Challenges</p>
                <h2 className="text-2xl font-semibold text-slate-900">Weekly goals</h2>
              </div>
              <button
                onClick={handleSaveSubmissions}
                disabled={saveDisabled}
                title={!hasChanges ? "No changes to save." : undefined}
                className={`rounded-xl px-4 py-2 text-sm font-semibold text-white transition focus:outline-none focus:ring-2 focus:ring-orange-300 focus:ring-offset-2 focus:ring-offset-orange-50 ${
                  saveDisabled
                    ? "cursor-not-allowed bg-slate-200 text-slate-500"
                    : "bg-orange-500 hover:bg-orange-600"
                }`}
              >
                {isSaving ? "Saving..." : "Save progress"}
              </button>
            </div>
            {!hasChanges && <p className="text-xs text-slate-500">No changes to save.</p>}
            {saveStatus && (
              <div
                className={`w-fit rounded-lg border px-3 py-2 text-sm ${
                  saveStatus.tone === "success"
                    ? "border-green-200 bg-green-50 text-green-800"
                    : "border-rose-200 bg-rose-50 text-rose-700"
                }`}
              >
                {saveStatus.message}
              </div>
            )}
            <div className="space-y-3">
              {openChallenges.length === 0 && (
                <p className="text-sm text-slate-500">No active challenges available for your selected team yet.</p>
              )}
              {openChallenges.map((challenge) => {
                const checked = submissionState[challenge.id] || false;
                const closingInfo = currentTime
                  ? getChallengeClosingInfo(challenge, currentTime)
                  : FALLBACK_CLOSING_INFO;
                const toggleDisabled = !closingInfo.isEditable;

                return (
                  <div
                    key={challenge.id}
                    className="flex items-start gap-3 rounded-xl border border-orange-100 bg-orange-50/60 p-4"
                  >
                    <button
                      type="button"
                      role="switch"
                      aria-checked={checked}
                      aria-label={`Mark ${challenge.title} as completed`}
                      disabled={toggleDisabled}
                      aria-disabled={toggleDisabled}
                      onClick={() => {
                        if (toggleDisabled) return;
                        toggleChallenge(challenge, !checked);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === " " || event.key === "Enter") {
                          event.preventDefault();
                          if (toggleDisabled) return;
                          toggleChallenge(challenge, !checked);
                        }
                      }}
                      className={`mt-1 inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2 focus:ring-offset-orange-50 ${
                        checked ? "bg-orange-500" : "bg-slate-200"
                      } ${toggleDisabled ? "cursor-not-allowed opacity-60" : ""}`}
                    >
                      <span
                        aria-hidden="true"
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                          checked ? "translate-x-5" : "translate-x-1"
                        }`}
                      />
                    </button>
                    <div className="space-y-1">
                      <p className="text-sm text-slate-600">
                        Week {challenge.week_index} · Challenge {challenge.challenge_index}
                      </p>
                      <h3 className="text-lg font-semibold text-slate-900">{challenge.title}</h3>
                      <p className="text-sm text-slate-700">{challenge.description}</p>
                      <p className="text-xs text-slate-500">
                        {challenge.start_date && `Starts ${challenge.start_date}`} · {" "}
                        {challenge.end_date && `Ends ${challenge.end_date}`} · {challenge.base_points} pts
                      </p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                        <span
                          className={`rounded-full border px-2 py-1 ${
                            closingInfo.isEditable
                              ? "border-orange-200 bg-orange-100 text-orange-700"
                              : "border-slate-200 bg-slate-100 text-slate-600"
                          }`}
                        >
                          {closingInfo.closingLabel}
                        </span>
                        <span className="text-slate-500">
                          {closingInfo.isEditable
                            ? closingInfo.lockDateLabel
                              ? `Edits lock ${closingInfo.lockDateLabel} (${EDIT_GRACE_PERIOD_DAYS} days after end date).`
                              : `Edits lock ${EDIT_GRACE_PERIOD_DAYS} days after the end date.`
                            : "Edits are locked for this challenge."}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="rounded-2xl border border-orange-100 bg-white/80">
              <button
                type="button"
                onClick={() => setShowClosedChallenges((open) => !open)}
                className="flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold text-slate-900 hover:bg-orange-50"
              >
                <div className="space-y-1">
                  <p>Closed challenges</p>
                  <p className="text-xs font-normal text-slate-600">
                    {closedChallenges.length === 0
                      ? "No closed challenges yet."
                      : "Completed or locked challenges are tucked away here."}
                  </p>
                </div>
                <span
                  aria-hidden
                  className={`text-lg text-orange-600 transition-transform ${showClosedChallenges ? "rotate-180" : ""}`}
                >
                  ▼
                </span>
              </button>

              {showClosedChallenges && (
                <div className="divide-y divide-orange-100">
                  {closedChallenges.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-slate-500">Nothing to review yet.</p>
                  ) : (
                    closedChallenges.map((challenge) => {
                      const checked = submissionState[challenge.id] || false;
                      const closingInfo = getChallengeClosingInfo(challenge);

                      return (
                        <div
                          key={challenge.id}
                          className="flex items-start gap-3 px-4 py-3"
                        >
                          <button
                            type="button"
                            role="switch"
                            aria-checked={checked}
                            aria-label={`Mark ${challenge.title} as completed`}
                            disabled
                            aria-disabled
                            className="mt-1 inline-flex h-6 w-11 items-center rounded-full bg-slate-200 opacity-60"
                          >
                            <span
                              aria-hidden="true"
                              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ${
                                checked ? "translate-x-5" : "translate-x-1"
                              }`}
                            />
                          </button>
                          <div className="space-y-1">
                            <p className="text-sm text-slate-600">
                              Week {challenge.week_index} · Challenge {challenge.challenge_index}
                            </p>
                            <h3 className="text-base font-semibold text-slate-900">{challenge.title}</h3>
                            <p className="text-sm text-slate-700">{challenge.description}</p>
                            <p className="text-xs text-slate-500">
                              {challenge.start_date && `Starts ${challenge.start_date}`} · {" "}
                              {challenge.end_date && `Ended ${challenge.end_date}`} · {challenge.base_points} pts
                            </p>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                              <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-1 text-slate-600">
                                {closingInfo.closingLabel}
                              </span>
                              <span className="text-slate-500">
                                {closingInfo.lockDateLabel
                                  ? `Edits locked ${closingInfo.lockDateLabel} (${EDIT_GRACE_PERIOD_DAYS} days after end date).`
                                  : "Edits are locked for this challenge."}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>

          <div className={`${cardClass} space-y-4 p-6`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-orange-600">Team activity</p>
                <h2 className="text-xl font-semibold text-slate-900">Recent submissions</h2>
                <p className="text-sm text-slate-600">Last 7 days</p>
              </div>
              {recentStatus && <span className="text-sm font-medium text-rose-600">{recentStatus}</span>}
            </div>

            {!activeTeamId && <p className="text-sm text-slate-500">Set an active team to see recent activity.</p>}

            {activeTeamId && (
              <div className="space-y-3">
                {recentSubmissions.length === 0 && !recentLoading && (
                  <p className="text-sm text-slate-500">No submissions yet.</p>
                )}

                <ul className="space-y-2">
                  {recentSubmissions.map((submission) => (
                    <li
                      key={submission.id}
                      className="flex items-start justify-between rounded-xl border border-orange-100 bg-orange-50/70 p-3"
                    >
                      <div className="space-y-1">
                        <p className="font-semibold text-slate-900">{submission.name}</p>
                        <p className="text-sm text-slate-700">Completed {submission.challenge_title}</p>
                      </div>
                      <p className="text-xs text-slate-500">{formatTimestamp(submission.completed_at)}</p>
                    </li>
                  ))}
                </ul>

                <div className="flex items-center gap-3">
                  <button
                    disabled={!recentHasMore || recentLoading}
                    onClick={() => activeTeamId && loadRecentActivity(activeTeamId)}
                    className={`rounded-xl px-4 py-2 text-sm font-semibold ${
                      recentHasMore
                        ? "bg-orange-500 text-white hover:bg-orange-600"
                        : "cursor-not-allowed bg-slate-200 text-slate-500"
                    }`}
                  >
                    {recentLoading ? "Loading..." : recentHasMore ? "Load more" : "No more results"}
                  </button>
                  <p className="text-xs text-slate-500">Showing {recentSubmissions.length} of {recentOffset} loaded</p>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className={`${cardClass} lg:col-span-2 space-y-4 p-6`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-orange-600">Welcome</p>
                <h2 className="text-2xl font-semibold text-slate-900">Update your display name</h2>
                <div className="flex flex-wrap gap-2 text-xs text-orange-700">
                  {userIdentifier && <span className="rounded-full border border-orange-100 bg-orange-50 px-3 py-1">ID: {userIdentifier}</span>}
                  {profileRole && <span className="rounded-full border border-orange-100 bg-orange-50 px-3 py-1">Access: {profileRole}</span>}
                </div>
              </div>
              {profileStatus && <span className="text-sm font-medium text-orange-700">{profileStatus}</span>}
            </div>
            <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Display name</label>
                <input
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  className="w-full rounded-xl border border-orange-200 bg-white px-3 py-2 text-slate-900 shadow-inner focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-200"
                />
              </div>
              <button
                onClick={handleProfileSave}
                className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-orange-600"
              >
                Save name
              </button>
            </div>
          </div>

          <div className={`${cardClass} space-y-4 p-6`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-orange-600">Teams</p>
                <h2 className="text-2xl font-semibold text-slate-900">Join or switch teams</h2>
              </div>
              {teamStatus && <span className="text-sm font-medium text-orange-700">{teamStatus}</span>}
            </div>
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="Enter join code"
                className="flex-1 rounded-xl border border-orange-200 bg-white px-3 py-3 text-slate-900 shadow-inner focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-200"
              />
              <button
                onClick={handleJoinTeam}
                className="rounded-xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white shadow hover:bg-orange-600"
              >
                Join
              </button>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-slate-600">Your teams</p>
              <div className="space-y-2">
                {teams.length === 0 && <p className="text-sm text-slate-500">No teams yet.</p>}
                {teams.map((row) => {
                  if (!row.team) return null;

                  return (
                    <div
                      key={row.team.id}
                      className={`flex items-center justify-between rounded-xl border p-3 ${
                        activeTeamId === row.team.id
                          ? "border-orange-300 bg-orange-50 shadow"
                          : "border-orange-100 bg-white"
                      }`}
                    >
                      <div>
                        <p className="font-semibold text-slate-900">{row.team.name}</p>
                        <p className="text-xs text-slate-600">Join code: {row.team.join_code}</p>
                      </div>
                      <div className="flex gap-3 text-sm">
                        <button
                          onClick={() => handleActiveTeamChange(row.team!.id)}
                          className="font-semibold text-orange-700 hover:text-orange-800"
                        >
                          {activeTeamId === row.team.id ? "Active" : "Set active"}
                        </button>
                        <button
                          onClick={() => handleLeaveTeam(row.team!.id)}
                          className="font-semibold text-rose-600 hover:text-rose-700"
                        >
                          Leave
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {activeTeamId && (
          <div className={`${cardClass} p-5`}>
            <p className="text-sm font-semibold text-orange-600">Active team</p>
            <h3 className="text-xl font-semibold text-slate-900">{activeTeamName}</h3>
            <p className="text-sm text-slate-600">
              View team stats in the <a className="font-semibold text-orange-700" href="/leaderboard">leaderboard</a>.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
