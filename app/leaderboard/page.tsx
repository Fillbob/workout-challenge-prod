"use client";

import { useRequireUser } from "@/lib/auth";
import { getProfileIcon } from "@/lib/profileIcons";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RankChangeIndicator } from "@/components/rank-change-indicator";

interface PublicTeam {
  id: string;
  name: string;
}

interface LeaderboardRow {
  user_id: string;
  name: string;
  points: number;
  completed_count: number;
  icon?: string | null;
  week_progress_percent: number;
}

interface ContributionRow {
  challenge_id: string;
  challenge_title: string;
  completed_at: string | null;
  points: number;
}

const tierStyles = [
  "from-orange-500 via-amber-400 to-rose-400 text-white shadow-orange-200/60",
  "from-amber-500 via-orange-400 to-amber-300 text-white shadow-amber-200/70",
  "from-amber-200 via-orange-200 to-amber-100 text-amber-900 shadow-orange-100",
];

const laneGradients = [
  "from-orange-500 via-amber-400 to-rose-400",
  "from-amber-400 via-orange-400 to-amber-300",
  "from-amber-200 via-orange-200 to-rose-200",
  "from-rose-400 via-orange-400 to-amber-300",
  "from-amber-300 via-orange-300 to-rose-300",
  "from-yellow-300 via-amber-400 to-orange-500",
  "from-sky-300 via-blue-300 to-emerald-200",
  "from-amber-300 via-orange-400 to-pink-400",
];

const avatarSize = {
  sm: "h-9 w-9 text-base",
  md: "h-12 w-12 text-xl",
  lg: "h-14 w-14 text-2xl",
};

const ProfileCircle = ({ iconId, name, size = "md" }: { iconId?: string | null; name: string; size?: keyof typeof avatarSize }) => {
  const icon = useMemo(() => getProfileIcon(iconId), [iconId]);
  return (
    <div
      className={`flex items-center justify-center rounded-full ${icon.backgroundClass} ${avatarSize[size]} shadow-inner shadow-orange-100`}
      style={{ backgroundColor: icon.backgroundColor }}
      role="img"
      aria-label={`${name}'s icon: ${icon.label}`}
    >
      <span className={icon.accent}>{icon.glyph}</span>
    </div>
  );
};

export default function LeaderboardPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [teams, setTeams] = useState<PublicTeam[]>([]);
  const [activeTeam, setActiveTeam] = useState<string | null>(null);
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [contributions, setContributions] = useState<Record<string, ContributionRow[]>>({});
  const [activityOffset, setActivityOffset] = useState(0);
  const [activityHasMore, setActivityHasMore] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [positionChanges, setPositionChanges] = useState<Record<string, number>>({});
  const [focusedUser, setFocusedUser] = useState<string | null>(null);
  const [maxAvailablePoints, setMaxAvailablePoints] = useState(0);
  const [activeWeekIndex, setActiveWeekIndex] = useState<number | null>(null);

  const activityOffsetRef = useRef(0);
  const previousRowsRef = useRef<LeaderboardRow[]>([]);

  const PAGE_SIZE = 15;

  const loadTeams = useCallback(async () => {
    try {
      const response = await fetch("/api/teams/public");
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Unable to load groups");
      }

      const normalizedTeams: PublicTeam[] = (payload.teams ?? []).map(
        (row: { id?: string; name?: string }) => ({
          id: String(row.id ?? ""),
          name: String(row.name ?? "Unnamed team"),
        }),
      );

      setTeams(normalizedTeams.filter((team) => Boolean(team.id)));
      setStatus(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load groups");
    }
  }, []);

  const appendContributions = useCallback(
    (
      current: Record<string, ContributionRow[]>,
      incoming: Record<string, ContributionRow[]>,
      reset: boolean,
    ) => {
      if (reset) return incoming;

      const merged: Record<string, ContributionRow[]> = { ...current };
      Object.entries(incoming).forEach(([userId, items]) => {
        merged[userId] = [...(merged[userId] ?? []), ...items];
      });
      return merged;
    },
    [],
  );

  const loadLeaderboard = useCallback(
    async (teamId: string, reset = true) => {
      setStatus(null);
      setActivityLoading(true);
      if (reset) {
        activityOffsetRef.current = 0;
        setActivityOffset(0);
        setContributions({});
        setExpandedUser(null);
        setFocusedUser(null);
      }

      const offset = reset ? 0 : activityOffsetRef.current;

      try {
        const params = new URLSearchParams({
          teamId,
          limit: `${PAGE_SIZE}`,
          offset: `${offset}`,
        });

        const response = await fetch(`/api/teams/leaderboard?${params.toString()}`);
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "Unable to load leaderboard");
        }

        const returnedContributions: Record<string, ContributionRow[]> = payload.contributions ?? {};
        const availablePoints = Number(payload.maxAvailablePoints ?? 0);
        const currentWeekIndex = payload.activeWeekIndex ?? null;
        const contributionCount = Object.values(returnedContributions).reduce((count, list) => count + list.length, 0);

        const incomingLeaderboard: LeaderboardRow[] = payload.leaderboard ?? [];

        // When the leaderboard loads we compare the new ordering to the previously
        // cached ranks (either from the last render or from localStorage). This
        // gives us a stable delta even after page refreshes.
        const storedRankingsKey = `leaderboard:${teamId}:previousRanks`;
        const storedRankings = (() => {
          if (!reset) return null;
          try {
            const raw = window.localStorage.getItem(storedRankingsKey);
            return raw ? (JSON.parse(raw) as Record<string, number>) : null;
          } catch (error) {
            console.error("Unable to read stored leaderboard ranks", error);
            return null;
          }
        })();

        const previousRankings = reset
          ? new Map<string, number>(storedRankings ? Object.entries(storedRankings) : [])
          : new Map(previousRowsRef.current.map((row, index) => [row.user_id, index]));

        const movement: Record<string, number> = {};
        incomingLeaderboard.forEach((row, index) => {
          const previousIndex = previousRankings.get(row.user_id);
          if (previousIndex === undefined) return;
          const delta = previousIndex - index;
          if (delta !== 0) {
            movement[row.user_id] = delta;
          }
        });

        setPositionChanges(movement);
        setRows(incomingLeaderboard);
        setMaxAvailablePoints(availablePoints);
        setActiveWeekIndex(typeof currentWeekIndex === "number" ? currentWeekIndex : null);
        previousRowsRef.current = incomingLeaderboard;
        // Persist the latest ranking order so the next fetch can calculate
        // deltas even after a full reload.
        try {
          const serialized = JSON.stringify(
            Object.fromEntries(incomingLeaderboard.map((row, index) => [row.user_id, index])),
          );
          window.localStorage.setItem(storedRankingsKey, serialized);
        } catch (error) {
          console.error("Unable to persist leaderboard ranks", error);
        }
        setContributions((prev) => appendContributions(prev, returnedContributions, reset));
        setActivityHasMore(Boolean(payload.hasMore));
        const nextOffset = offset + contributionCount;
        activityOffsetRef.current = nextOffset;
        setActivityOffset(nextOffset);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Unable to load leaderboard");
      } finally {
        setActivityLoading(false);
      }
    },
    [PAGE_SIZE, appendContributions],
  );

  useRequireUser((id) => setUserId(id));

  useEffect(() => {
    if (!userId) return;
    loadTeams();
  }, [userId, loadTeams]);

  useEffect(() => {
    const stored = window.localStorage.getItem("activeTeamId");
    if (stored) {
      setActiveTeam(stored);
      loadLeaderboard(stored);
    }
  }, [loadLeaderboard]);

  useEffect(() => {
    if (activeTeam && teams.length > 0) {
      const knownIds = teams.map((team) => team.id);
      if (!knownIds.includes(activeTeam)) {
        setActiveTeam(null);
      }
    }

    if (activeTeam || teams.length === 0) {
      if (teams.length === 0) {
        setStatus("Join or create a group to see the leaderboard.");
      }
      return;
    }

    const firstTeamId = teams[0]?.id;
    if (firstTeamId) {
      setActiveTeam(firstTeamId);
      window.localStorage.setItem("activeTeamId", firstTeamId);
      loadLeaderboard(firstTeamId);
    }
  }, [activeTeam, loadLeaderboard, teams]);

  const handleTeamChange = (id: string) => {
    setActiveTeam(id);
    window.localStorage.setItem("activeTeamId", id);
    loadLeaderboard(id);
  };

  const loadMoreActivity = () => {
    if (!activeTeam || activityLoading || !activityHasMore) return;
    loadLeaderboard(activeTeam, false);
  };

  const formatTimestamp = (value: string | null) => {
    if (!value) return "";
    return new Date(value).toLocaleString();
  };

  const maxPoints = useMemo(() => (rows.length > 0 ? Math.max(...rows.map((row) => row.points)) : 0), [rows]);
  const axisLimit = useMemo(() => {
    const baseLimit = Math.max(maxPoints, 1);
    return Math.max(50, Math.ceil(baseLimit / 50) * 50);
  }, [maxPoints]);
  const stackDepthByPoints = useMemo(() => {
    const counts: Record<number, number> = {};
    rows.forEach((row) => {
      counts[row.points] = (counts[row.points] ?? 0) + 1;
    });
    return counts;
  }, [rows]);

  const maxStackDepth = useMemo(
    () => (Object.values(stackDepthByPoints).length ? Math.max(...Object.values(stackDepthByPoints)) : 1),
    [stackDepthByPoints],
  );

  const stackGap = 40;
  const iconSize = 36;
  const iconBaseOffset = 40;
  const lineTopBase = 140;
  const lineTop = lineTopBase + (maxStackDepth - 1) * stackGap;
  const trackHeight = lineTop + 80;

  const milestoneValues = useMemo(() => {
    const fractions = [0, 0.25, 0.5, 0.75, 1];
    const scaled = fractions
      .map((fraction) => Math.round(axisLimit * fraction))
      .filter((value, index, arr) => arr.indexOf(value) === index);
    return scaled;
  }, [axisLimit]);

  const topPerformer = rows[0];

  return (
    <main className="min-h-screen bg-orange-50 text-slate-900">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
        <div className="flex flex-col gap-4 rounded-3xl bg-white p-6 shadow-sm shadow-orange-100/60 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">Leaderboard</p>
            <h1 className="text-3xl font-semibold text-slate-900">Group rankings</h1>
            <p className="mt-2 text-sm text-slate-600">
              Celebrate your squad and follow every contribution in a warm, card-first layout.
            </p>
          </div>
          <a
            className="inline-flex items-center justify-center rounded-full bg-orange-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-600"
            href="/dashboard"
          >
            Back to dashboard
          </a>
        </div>

        <div className="mt-8 space-y-4">
          <div className="rounded-3xl bg-white p-4 shadow-sm shadow-orange-100/70">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-amber-700">Choose a group</p>
                <p className="text-xs text-slate-500">Switch tabs to browse each leaderboard.</p>
              </div>
              <div className="flex flex-wrap gap-3">
                {teams.map((team) => {
                  const id = team.id;
                  const name = team.name || "Unnamed team";
                  const isActive = activeTeam === id;
                  return (
                    <button
                      key={id}
                      onClick={() => handleTeamChange(id)}
                      className={`rounded-full border px-4 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-orange-300 ${
                        isActive
                          ? "border-transparent bg-orange-500 text-white shadow-sm"
                          : "border-orange-100 bg-white text-slate-700 hover:border-orange-200 hover:bg-orange-50"
                      }`}
                      disabled={teams.length === 0}
                    >
                      {name}
                    </button>
                  );
                })}
                {teams.length === 0 && <span className="text-sm text-slate-500">No groups yet</span>}
              </div>
            </div>
            {status && <p className="mt-3 text-sm text-rose-500">{status}</p>}
          </div>

          {activeTeam ? (
            <div className="grid gap-6 lg:grid-cols-5">
              <div className="rounded-3xl bg-orange-100 p-6 text-slate-900 shadow-sm shadow-orange-200/70 lg:col-span-2">
                <div className="rounded-2xl bg-white p-4 shadow-sm shadow-amber-200/40">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-900/80">Current leader</p>
                  <div className="mt-3 flex items-center gap-3">
                    <ProfileCircle iconId={topPerformer?.icon} name={topPerformer?.name ?? "Current leader"} size="md" />
                    <div>
                      <p className="text-lg font-semibold">{topPerformer?.name ?? "No scores yet"}</p>
                      <p className="text-sm text-amber-900/80">
                        {topPerformer
                          ? `${topPerformer.points} pts • ${topPerformer.completed_count} completed`
                          : "Complete a challenge to appear here."}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-2xl bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-900/70">Participants</p>
                    <p className="mt-2 text-2xl font-bold text-slate-900">{rows.length}</p>
                    <p className="text-xs text-amber-900/80">Active group members logged.</p>
                  </div>
                  <div className="rounded-2xl bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-900/70">Submissions</p>
                    <p className="mt-2 text-2xl font-bold text-slate-900">{activityOffset}</p>
                    <p className="text-xs text-amber-900/80">Loaded contributions so far.</p>
                  </div>
                </div>
              </div>

                <div className="lg:col-span-3 space-y-4">
                  <div className="rounded-3xl border border-orange-100 bg-white p-5 shadow-sm shadow-orange-100/70">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-orange-600">Race view</p>
                        <h3 className="text-xl font-semibold text-slate-900">Race view</h3>
                        <p className="text-sm text-slate-600">One shared track that scales with available challenges.</p>
                      </div>
                      <p className="text-xs text-slate-500">Click an icon to spotlight their lane.</p>
                    </div>

                    <div className="mt-4 space-y-4">
                      <div className="rounded-2xl border border-orange-100/80 bg-white p-4 shadow-sm shadow-orange-50">
                        <div className="flex flex-col gap-2 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex items-center gap-2 text-[11px] font-semibold text-orange-700">
                            <span className="rounded-full bg-orange-50 px-2 py-0.5">Shared track</span>
                            <span className="text-slate-600">Scaled to active challenges</span>
                          </div>
                          <span className="text-[11px] font-semibold text-slate-700">{maxAvailablePoints} pts available</span>
                        </div>
                        <div
                          className="relative mt-4 rounded-xl bg-white px-6 py-6 shadow-inner shadow-orange-50"
                          style={{ height: `${trackHeight}px` }}
                        >
                          <div
                            className="absolute left-6 right-6 h-3 rounded-full bg-slate-100"
                            style={{ top: `${lineTop}px` }}
                          />
                          <div className="relative h-full">
                            {(() => {
                              const stackOffsets: Record<number, number> = {};
                              return rows.map((row, idx) => {
                                const gradient = laneGradients[idx % laneGradients.length];
                                const fill = Math.min(100, (row.points / axisLimit) * 100);
                                const isFocused = focusedUser === row.user_id;
                                const occurrence = stackOffsets[row.points] ?? 0;
                                stackOffsets[row.points] = occurrence + 1;
                                const stackShift = occurrence * stackGap;
                                const iconTop = lineTop - iconBaseOffset - iconSize - stackShift;
                                const connectorHeight = lineTop - (iconTop + iconSize);

                                const shouldShowConnector = occurrence === 0;

                                return (
                                  <button
                                    key={row.user_id}
                                    type="button"
                                    onClick={() => setFocusedUser(isFocused ? null : row.user_id)}
                                    style={{ left: `${fill}%`, top: `${iconTop}px` }}
                                    className={`group absolute -translate-x-1/2 transition focus:outline-none ${
                                      isFocused ? "scale-105" : "hover:-translate-y-0.5"
                                    }`}
                                  >
                                    <div className="flex flex-col items-center">
                                      <div className={`rounded-full bg-gradient-to-r ${gradient} p-[2px] shadow-inner shadow-orange-100`}>
                                        <ProfileCircle iconId={row.icon} name={row.name} size="sm" />
                                      </div>
                                      {shouldShowConnector && (
                                        <span
                                          className={`mt-1 w-px border-l-2 border-dashed ${
                                            isFocused
                                              ? "border-orange-500"
                                              : "border-orange-200 group-hover:border-orange-400"
                                          }`}
                                          style={{ height: `${connectorHeight}px` }}
                                        />
                                      )}
                                      <span className="sr-only">{`${row.name} at ${row.points} points`}</span>
                                    </div>
                                  </button>
                                );
                              });
                            })()}
                            {rows.length === 0 && (
                              <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
                                No racers yet. Complete a challenge to join the track.
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="mt-3 flex items-center justify-between text-[11px] font-semibold text-slate-600">
                          {milestoneValues.map((value) => (
                            <div key={value} className="flex flex-col items-center gap-1">
                              <span className="h-3 w-px rounded-full bg-orange-200" />
                              <span>{value} pts</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                      {rows.map((row, idx) => {
                        const isFocused = focusedUser === row.user_id;
                        const gradient = laneGradients[idx % laneGradients.length];
                        return (
                          <button
                            key={row.user_id}
                            type="button"
                            onClick={() => setFocusedUser(isFocused ? null : row.user_id)}
                            className={`flex items-center gap-3 rounded-2xl border border-orange-100/70 bg-white p-3 text-left transition focus:outline-none ${
                              isFocused
                                ? "ring-2 ring-orange-300 shadow-lg shadow-orange-100"
                                : "hover:-translate-y-0.5 shadow-sm shadow-orange-50"
                            }`}
                          >
                          <div className={`rounded-full bg-gradient-to-r ${gradient} p-[2px] shadow-inner shadow-orange-100`}>
                              <ProfileCircle iconId={row.icon} name={row.name} size="sm" />
                            </div>
                            <div className="flex-1 space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-semibold text-slate-900">{row.name}</p>
                                <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-semibold text-orange-700">
                                  {row.points} pts
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                                <span>{row.completed_count} completed challenges</span>
                                <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
                                  {activeWeekIndex ? `Week ${activeWeekIndex}` : "Week"}
                                  {": "}
                                  {row.week_progress_percent}%
                                </span>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                      {rows.length === 0 && (
                        <div className="rounded-2xl border border-dashed border-orange-200 bg-white p-6 text-center text-sm text-slate-500">
                          No racers yet. Complete a challenge to join the track.
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  {rows.map((row, idx) => {
                    const isExpanded = expandedUser === row.user_id;
                    const memberContributions = contributions[row.user_id] ?? [];
                    const rankStyle = tierStyles[idx] ?? "from-white via-amber-50 to-orange-50 text-slate-900";
                    const change = positionChanges[row.user_id];

                    return (
                      <Fragment key={row.user_id}>
                        <div
                          className={`relative overflow-hidden rounded-2xl border border-orange-100 bg-white p-4 shadow-sm shadow-orange-100 transition hover:-translate-y-0.5 hover:shadow-lg ${
                            isExpanded ? "ring-2 ring-orange-200" : ""
                          }`}
                        >
                          <div className="flex items-center gap-4">
                            <div className={`flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br ${rankStyle} text-base font-bold shadow`}
                            >
                              #{idx + 1}
                            </div>
                            <ProfileCircle iconId={row.icon} name={row.name} size="md" />
                            <div className="flex-1">
                              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                  <p className="flex items-center gap-2 text-base font-semibold text-slate-900">
                                    {row.name}
                                    <RankChangeIndicator delta={change} />
                                  </p>
                                  <p className="text-xs text-slate-500">{row.completed_count} completions</p>
                                </div>
                                <div className="text-right">
                                  <p className="flex items-center justify-end gap-2 text-lg font-bold text-amber-700">
                                    {row.points} pts
                                  </p>
                                  <button
                                    onClick={() => setExpandedUser(isExpanded ? null : row.user_id)}
                                    className="text-xs font-semibold text-orange-600 underline underline-offset-4 transition hover:text-orange-700"
                                  >
                                    {isExpanded ? "Hide" : "View"} contributions
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="-mt-2 mb-3 overflow-hidden rounded-2xl border border-orange-100 bg-white px-4 py-3 text-sm shadow-inner shadow-orange-100">
                            <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Recent contributions</p>
                            {memberContributions.length === 0 && (
                              <p className="mt-2 text-xs text-slate-500">No submissions loaded yet.</p>
                            )}
                            <ul className="mt-2 space-y-2">
                              {memberContributions.map((entry) => (
                                <li
                                  key={`${row.user_id}-${entry.challenge_id}-${entry.completed_at}`}
                                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-orange-100 bg-white px-3 py-2 text-xs"
                                >
                                  <div className="flex flex-col">
                                    <span className="font-semibold text-slate-800">{entry.challenge_title}</span>
                                    <span className="text-amber-700">{entry.points} pts</span>
                                  </div>
                                  <span className="text-[11px] text-slate-500">{formatTimestamp(entry.completed_at)}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </Fragment>
                    );
                  })}
                  {rows.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-orange-200 bg-white p-6 text-center text-sm text-slate-500">
                      No data yet for this group.
                    </div>
                  )}
                </div>

                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    disabled={!activityHasMore || activityLoading}
                    onClick={loadMoreActivity}
                    className={`inline-flex items-center justify-center rounded-full px-5 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-orange-300 ${
                      activityHasMore
                        ? "bg-orange-500 text-white shadow-sm hover:bg-orange-600"
                        : "cursor-not-allowed border border-orange-100 bg-white text-slate-400"
                    }`}
                  >
                    {activityLoading ? "Loading..." : activityHasMore ? "Load more activity" : "No more activity"}
                  </button>
                  <p className="text-xs text-slate-500">Loaded {activityOffset} submissions</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-3xl border border-dashed border-orange-200 bg-white p-8 text-center text-sm text-slate-600 shadow-inner shadow-orange-100">
              Join or create a group to see the leaderboard.
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
