"use client";

import { AnnouncementMarkdown } from "@/components/announcement-markdown";
import {
  Announcement,
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
  updateAnnouncement,
} from "@/lib/announcements";
import { useRequireAdmin } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { milesToMeters } from "@/lib/units";
import { useCallback, useEffect, useRef, useState } from "react";

type ChallengeMetricType = "manual" | "distance" | "duration" | "elevation" | "steps";

const commonActivityTypes = [
  "Run",
  "Ride",
  "Walk",
  "Hike",
  "Swim",
  "Rowing",
  "Weight Training",
  "Yoga",
  "Elliptical",
  "Virtual Ride",
];

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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
  hidden?: boolean;
  metric_type: ChallengeMetricType;
  target_value: number | null;
  target_unit: string | null;
  progress_unit?: string | null;
  activity_types: string[] | null;
}

interface AdminTeam {
  id: string;
  name: string;
  join_code: string;
  member_count: number;
  members: { user_id: string; display_name: string }[];
}

interface LateCompletionRequest {
  id: string;
  status: "pending" | "approved" | "declined";
  requested_at: string;
  resolved_at: string | null;
  user_id: string;
  challenge_id: string;
  profiles?: { display_name?: string } | { display_name?: string }[] | null;
  challenges?: { title?: string; week_index?: number; challenge_index?: number; end_date?: string | null } | { title?: string; week_index?: number; challenge_index?: number; end_date?: string | null }[] | null;
}

const emptyForm: Omit<Challenge, "id"> = {
  week_index: 1,
  challenge_index: 1,
  title: "",
  description: "",
  start_date: null,
  end_date: null,
  base_points: 10,
  team_ids: [],
  hidden: false,
  metric_type: "manual",
  target_value: null,
  target_unit: null,
  progress_unit: null,
  activity_types: [],
};

const metricTypeOptions: { value: ChallengeMetricType; label: string; helper?: string }[] = [
  { value: "manual", label: "Manual", helper: "Participants self-report their progress" },
  { value: "distance", label: "Distance", helper: "Track miles/kilometers or similar" },
  { value: "duration", label: "Duration", helper: "Track minutes or hours" },
  { value: "elevation", label: "Elevation", helper: "Track total elevation gain" },
  { value: "steps", label: "Steps", helper: "Track total step count" },
];

const DEFAULT_START_TIME = "00:00";
const DEFAULT_END_TIME = "23:59";
const TIMEZONE_PATTERN = /(Z|[+-]\d{2}:?\d{2})$/;

const padTime = (value: number) => value.toString().padStart(2, "0");

const formatDateTimeInput = (value: string | null, fallbackTime: string) => {
  if (!value) return "";
  if (DATE_ONLY_PATTERN.test(value)) {
    return `${value}T${fallbackTime}`;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return [
    `${parsed.getFullYear()}-${padTime(parsed.getMonth() + 1)}-${padTime(parsed.getDate())}`,
    `${padTime(parsed.getHours())}:${padTime(parsed.getMinutes())}`,
  ].join("T");
};

const normalizeDateTimeForStorage = (value: string | null) => {
  if (!value) return null;
  if (DATE_ONLY_PATTERN.test(value)) return value;
  if (TIMEZONE_PATTERN.test(value)) return value;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString();
};

export default function AdminPage() {
  const supabase = getSupabaseClient();
  const [isAuthed, setIsAuthed] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [teams, setTeams] = useState<AdminTeam[]>([]);
  const [teamName, setTeamName] = useState("");
  const [teamStatus, setTeamStatus] = useState<string | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [announcementForm, setAnnouncementForm] = useState({ title: "", body_md: "" });
  const [editingAnnouncementId, setEditingAnnouncementId] = useState<string | null>(null);
  const [announcementStatus, setAnnouncementStatus] = useState<string | null>(null);
  const [isPostingAnnouncement, setIsPostingAnnouncement] = useState(false);
  const [announcementLoadingIds, setAnnouncementLoadingIds] = useState<Set<string>>(new Set());
  const announcementEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const [lateRequests, setLateRequests] = useState<LateCompletionRequest[]>([]);
  const [lateRequestStatus, setLateRequestStatus] = useState<string | null>(null);
  const [lateRequestLoadingIds, setLateRequestLoadingIds] = useState<Set<string>>(new Set());

  const normalizeTargetForDistance = (form: typeof emptyForm) => {
    const parsedValue = Number.isFinite(form.target_value ?? NaN) ? form.target_value : null;
    const targetUnit = form.target_unit ?? null;
    const progressUnit = "meters";

    if (form.metric_type !== "distance" || parsedValue === null) {
      return { target_value: parsedValue, target_unit: targetUnit, progress_unit: progressUnit };
    }

    const normalizedUnit = targetUnit?.toLowerCase().trim() ?? "";
    const expectsMiles = !normalizedUnit || normalizedUnit.includes("mile");
    const expectsKilometers = normalizedUnit.includes("kilometer") || normalizedUnit.includes("km");

    if (expectsMiles) {
      return { target_value: milesToMeters(parsedValue), target_unit: "meters", progress_unit: progressUnit };
    }

    if (expectsKilometers) {
      return { target_value: parsedValue * 1000, target_unit: "meters", progress_unit: progressUnit };
    }

    return { target_value: parsedValue, target_unit: "meters", progress_unit: progressUnit };
  };

  const loadChallenges = useCallback(async () => {
    const { data, error } = await supabase
      .from("challenges")
      .select("*")
      .order("week_index")
      .order("challenge_index");
    if (error) {
      setStatus(error.message);
      return;
    }
    const normalized = (data ?? []).map((challenge) => ({
      ...challenge,
      challenge_index: Number.isFinite(Number(challenge.challenge_index))
        ? Number(challenge.challenge_index)
        : 1,
      team_ids: challenge.team_ids ?? [],
      hidden: Boolean(challenge.hidden),
      metric_type: (challenge.metric_type as ChallengeMetricType | null) ?? "manual",
      target_value:
        challenge.target_value === null || challenge.target_value === undefined
          ? null
          : Number.isFinite(Number(challenge.target_value))
            ? Number(challenge.target_value)
            : null,
      target_unit: challenge.target_unit ?? null,
      progress_unit: challenge.progress_unit ?? null,
      activity_types: challenge.activity_types ?? [],
    }));
    setChallenges(normalized as Challenge[]);
  }, [setChallenges, setStatus, supabase]);

  const loadAnnouncements = useCallback(async () => {
    try {
      const payload = await listAnnouncements();
      setAnnouncements(payload.announcements ?? []);
      setAnnouncementStatus(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load announcements";
      setAnnouncementStatus(message);
    }
  }, []);

  const loadTeams = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/teams");
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Unable to load groups");
      }

      setTeams(result.teams ?? []);
      setTeamStatus(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load groups";
      setTeamStatus(message);
    }
  }, []);

  const loadLateCompletionRequests = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/late-completions?status=pending");
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Unable to load late completion requests");
      }

      setLateRequests(result.requests ?? []);
      setLateRequestStatus(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load late completion requests";
      setLateRequestStatus(message);
    }
  }, []);

  useRequireAdmin((_, userRole) => {
    setIsAuthed(true);
    setRole(userRole);
  });

  useEffect(() => {
    if (!isAuthed) return;
    loadChallenges();
    loadTeams();
    loadAnnouncements();
    loadLateCompletionRequests();
  }, [isAuthed, loadChallenges, loadTeams, loadAnnouncements, loadLateCompletionRequests]);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const handleSubmit = async () => {
    setStatus(null);
    console.log("Creating/updating challenges via", process.env.NEXT_PUBLIC_SUPABASE_URL);

    const normalizedTarget = normalizeTargetForDistance(form);
    const target_value = normalizedTarget.target_value;
    const target_unit = normalizedTarget.target_unit;
    const progress_unit = normalizedTarget.progress_unit;
    const start_date = normalizeDateTimeForStorage(form.start_date);
    const end_date = normalizeDateTimeForStorage(form.end_date);

    if (editingId) {
      const { error } = await supabase
        .from("challenges")
        .update({
          ...form,
          start_date,
          end_date,
          target_value,
          target_unit,
          progress_unit,
          activity_types: form.activity_types ?? [],
        })
        .eq("id", editingId);
      if (error) {
        setStatus(error.message);
        return;
      }
      setStatus("Challenge updated");
    } else {
      const { error } = await supabase.from("challenges").insert({
        ...form,
        start_date,
        end_date,
        target_value,
        target_unit,
        progress_unit,
        activity_types: form.activity_types ?? [],
      });
      if (error) {
        setStatus(error.message);
        return;
      }
      setStatus("Challenge created");
    }
    resetForm();
    loadChallenges();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("challenges").delete().eq("id", id);
    if (error) {
      setStatus(error.message);
      return;
    }
    setStatus("Challenge deleted");
    loadChallenges();
  };

  const resetAnnouncementForm = () => {
    setAnnouncementForm({ title: "", body_md: "" });
    setEditingAnnouncementId(null);
  };

  const applyBoldFormatting = () => {
    const textarea = announcementEditorRef.current;
    if (!textarea) return;

    const { selectionStart, selectionEnd, value } = textarea;
    const selectedText = value.slice(selectionStart, selectionEnd) || "bold text";
    const wrapped = `**${selectedText}**`;
    const nextValue = value.slice(0, selectionStart) + wrapped + value.slice(selectionEnd);

    setAnnouncementForm((prev) => ({ ...prev, body_md: nextValue }));

    requestAnimationFrame(() => {
      const caretPosition = selectionStart + wrapped.length;
      textarea.selectionStart = caretPosition;
      textarea.selectionEnd = caretPosition;
      textarea.focus();
    });
  };

  const applyBulletFormatting = () => {
    const textarea = announcementEditorRef.current;
    if (!textarea) return;

    const { selectionStart, selectionEnd, value } = textarea;
    const blockStart = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
    const blockEndCandidate = value.indexOf("\n", selectionEnd);
    const blockEnd = blockEndCandidate === -1 ? value.length : blockEndCandidate;

    const selectedBlock = value.slice(blockStart, blockEnd);
    const lines = (selectedBlock || value.slice(blockStart, selectionEnd)).split("\n");
    const bulletLines = lines.map((line) => (line.startsWith("- ") ? line : `- ${line}`));
    const replacement = bulletLines.join("\n");
    const nextValue = value.slice(0, blockStart) + replacement + value.slice(blockEnd);

    setAnnouncementForm((prev) => ({ ...prev, body_md: nextValue }));

    requestAnimationFrame(() => {
      const caretPosition = blockStart + replacement.length;
      textarea.selectionStart = caretPosition;
      textarea.selectionEnd = caretPosition;
      textarea.focus();
    });
  };

  const handleAnnouncementSubmit = async () => {
    const title = announcementForm.title.trim();
    const body_md = announcementForm.body_md.trim();

    if (!title || !body_md) {
      setAnnouncementStatus("Title and message are required");
      return;
    }

    setIsPostingAnnouncement(true);
    setAnnouncementStatus(null);

    try {
      if (editingAnnouncementId) {
        const { announcement } = await updateAnnouncement(editingAnnouncementId, { title, body_md });
        setAnnouncements((prev) =>
          prev.map((item) =>
            item.id === announcement.id
              ? { ...item, ...announcement, author_name: item.author_name || announcement.author_name }
              : item
          )
        );
        setAnnouncementStatus("Announcement updated");
      } else {
        const { announcement } = await createAnnouncement({ title, body_md });
        setAnnouncements((prev) => [announcement, ...prev]);
        setAnnouncementStatus("Announcement published");
      }

      resetAnnouncementForm();
      loadAnnouncements();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save announcement";
      setAnnouncementStatus(message);
    } finally {
      setIsPostingAnnouncement(false);
    }
  };

  const handleLateCompletionDecision = async (requestId: string, action: "approve" | "decline") => {
    if (lateRequestLoadingIds.has(requestId)) return;
    setLateRequestStatus(null);
    setLateRequestLoadingIds((prev) => new Set([...Array.from(prev), requestId]));

    try {
      const response = await fetch("/api/admin/late-completions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, action }),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Unable to update request");
      }

      setLateRequests((prev) => prev.filter((item) => item.id !== requestId));
      setLateRequestStatus(action === "approve" ? "Late completion approved" : "Late completion declined");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update request";
      setLateRequestStatus(message);
    } finally {
      setLateRequestLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(requestId);
        return next;
      });
    }
  };

  const handleDeleteAnnouncement = async (id: string) => {
    if (!confirm("Delete this announcement?")) return;

    setAnnouncementStatus(null);
    setAnnouncementLoadingIds((prev) => new Set(prev).add(id));

    try {
      await deleteAnnouncement(id);
      setAnnouncements((prev) => prev.filter((announcement) => announcement.id !== id));
      setAnnouncementStatus("Announcement deleted");
      if (editingAnnouncementId === id) {
        resetAnnouncementForm();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to delete announcement";
      setAnnouncementStatus(message);
    } finally {
      setAnnouncementLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleEditAnnouncement = (announcement: Announcement) => {
    setEditingAnnouncementId(announcement.id);
    setAnnouncementForm({ title: announcement.title, body_md: announcement.body_md });
    setAnnouncementStatus(null);
  };

  const handleCreateTeam = async () => {
    setTeamStatus(null);
    const trimmed = teamName.trim();

    if (!trimmed) {
      setTeamStatus("Team name is required");
      return;
    }

    try {
      const response = await fetch("/api/teams/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamName: trimmed }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Unable to create group");
      }

      setTeamStatus("Team created");
      setTeamName("");
      loadTeams();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create group";
      setTeamStatus(message);
    }
  };

  const handleDeleteTeam = async (id: string) => {
    setTeamStatus(null);

    try {
      const response = await fetch("/api/teams/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: id }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Unable to delete group");
      }

      setTeamStatus("Team deleted");
      loadTeams();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to delete group";
      setTeamStatus(message);
    }
  };

  const handleRemoveMember = async (teamId: string, userId: string) => {
    setTeamStatus(null);

    try {
      const response = await fetch("/api/admin/teams/remove-member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, userId }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Unable to remove member");
      }

      setTeamStatus("Member removed");
      loadTeams();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to remove member";
      setTeamStatus(message);
    }
  };

  const formFromChallenge = (challenge: Challenge) => ({
      week_index: challenge.week_index,
      challenge_index: challenge.challenge_index ?? 1,
      title: challenge.title,
      description: challenge.description,
      start_date: challenge.start_date,
      end_date: challenge.end_date,
      base_points: challenge.base_points,
      team_ids: challenge.team_ids ?? [],
      hidden: Boolean(challenge.hidden),
      metric_type: challenge.metric_type ?? "manual",
      target_value: challenge.target_value ?? null,
      target_unit: challenge.target_unit ?? null,
      progress_unit: challenge.progress_unit ?? challenge.target_unit ?? null,
      activity_types: challenge.activity_types ?? [],
    });

  const startEditing = (challenge: Challenge) => {
    setEditingId(challenge.id);
    setForm(formFromChallenge(challenge));
  };

  const startCopying = (challenge: Challenge) => {
    setEditingId(null);
    setForm(formFromChallenge(challenge));
    setStatus("Challenge copied. Update details and create a new challenge.");
  };

  const toggleTeamSelection = (teamId: string) => {
    setForm((prev) => {
      const existing = prev.team_ids ?? [];
      const nextTeams = existing.includes(teamId)
        ? existing.filter((id) => id !== teamId)
        : [...existing, teamId];

      return { ...prev, team_ids: nextTeams };
    });
  };

  const toggleActivityType = (activityType: string) => {
    setForm((prev) => {
      const existing = prev.activity_types ?? [];
      const nextActivities = existing.includes(activityType)
        ? existing.filter((type) => type !== activityType)
        : [...existing, activityType];

      return { ...prev, activity_types: nextActivities };
    });
  };

  if (!isAuthed) return null;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-4xl mx-auto p-8 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-indigo-400">Admin</p>
            <h1 className="text-3xl font-semibold">Manage challenges & updates</h1>
          </div>
          {role && (
            <span className="rounded-full border border-indigo-400/30 bg-indigo-500/10 px-3 py-1 text-xs text-indigo-200">
              Signed in as {role}
            </span>
          )}
          <a className="text-sm text-indigo-400 underline" href="/dashboard">
            Back to dashboard
          </a>
        </div>

        {role === "mod" && (
          <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-4 text-sm text-indigo-100">
            You have moderator access. You can publish announcements, but only admins can edit groups and challenges.
          </div>
        )}

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-indigo-400">Announcements</p>
              <h2 className="text-2xl font-semibold">Send a headline to everyone</h2>
              <p className="text-sm text-slate-400">Posts created here show up for all users on their dashboard.</p>
            </div>
            {announcementStatus && <p className="text-sm text-rose-400">{announcementStatus}</p>}
          </div>

          <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
            <div className="space-y-3">
              <input
                value={announcementForm.title}
                onChange={(e) => setAnnouncementForm((prev) => ({ ...prev, title: e.target.value }))}
                placeholder="Headline"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white"
              />
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-300">
                  <span className="font-semibold text-indigo-200">Formatting</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={applyBoldFormatting}
                      className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-indigo-100 hover:border-indigo-500 hover:text-indigo-200"
                    >
                      Bold
                    </button>
                    <button
                      type="button"
                      onClick={applyBulletFormatting}
                      className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-indigo-100 hover:border-indigo-500 hover:text-indigo-200"
                    >
                      Bullet
                    </button>
                  </div>
                </div>
                <textarea
                  ref={announcementEditorRef}
                  value={announcementForm.body_md}
                  onChange={(e) => setAnnouncementForm((prev) => ({ ...prev, body_md: e.target.value }))}
                  placeholder="Add markdown content. Use **bold** and - bullets."
                  rows={6}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white"
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={handleAnnouncementSubmit}
                  disabled={isPostingAnnouncement}
                  className="bg-indigo-500 hover:bg-indigo-600 disabled:opacity-60 text-white px-4 py-2 rounded-lg"
                >
                  {isPostingAnnouncement
                    ? editingAnnouncementId
                      ? "Saving..."
                      : "Publishing..."
                    : editingAnnouncementId
                      ? "Save changes"
                      : "Publish announcement"}
                </button>
                {editingAnnouncementId && (
                  <button onClick={resetAnnouncementForm} className="text-slate-300 underline">
                    Cancel
                  </button>
                )}
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 space-y-2">
                <p className="text-xs font-semibold text-slate-300">Preview</p>
                <div className="prose prose-invert max-w-none text-sm text-slate-100">
                  <AnnouncementMarkdown
                    content={announcementForm.body_md || "*Start typing to see a preview here.*"}
                    className="space-y-2"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950 p-4 space-y-3">
              <p className="text-sm font-semibold text-slate-100">Recent posts</p>
              <div className="space-y-3 max-h-64 overflow-y-auto pr-2">
                {announcements.map((announcement) => (
                  <div key={announcement.id} className="rounded-md border border-slate-800 bg-slate-900 p-3 text-sm space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>{announcement.author_name}</span>
                      <div className="text-right">
                        <p>{new Date(announcement.created_at).toLocaleString()}</p>
                        {announcement.updated_at && announcement.updated_at !== announcement.created_at && (
                          <p className="text-[10px] text-slate-500">Edited {new Date(announcement.updated_at).toLocaleString()}</p>
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="text-slate-100 font-semibold">{announcement.title}</p>
                      <AnnouncementMarkdown content={announcement.body_md} className="prose prose-invert max-w-none text-slate-200" />
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleEditAnnouncement(announcement)}
                        className="text-xs font-semibold text-indigo-300 hover:text-indigo-200"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteAnnouncement(announcement.id)}
                        disabled={announcementLoadingIds.has(announcement.id)}
                        className="text-xs font-semibold text-rose-300 hover:text-rose-200 disabled:opacity-50"
                      >
                        {announcementLoadingIds.has(announcement.id) ? "Removing..." : "Delete"}
                      </button>
                    </div>
                  </div>
                ))}
                {announcements.length === 0 && (
                  <p className="text-sm text-slate-500">No announcements yet.</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-indigo-400">Late completions</p>
              <h2 className="text-2xl font-semibold">Review late completion requests</h2>
              <p className="text-sm text-slate-400">Approve or decline requests from closed challenges.</p>
            </div>
            {lateRequestStatus && <p className="text-sm text-rose-400">{lateRequestStatus}</p>}
          </div>
          <div className="space-y-3">
            {lateRequests.length === 0 && (
              <p className="text-sm text-slate-500">No pending late completion requests.</p>
            )}
            {lateRequests.map((request) => {
              const profile = Array.isArray(request.profiles) ? request.profiles[0] : request.profiles;
              const challenge = Array.isArray(request.challenges) ? request.challenges[0] : request.challenges;
              return (
                <div key={request.id} className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-slate-100">
                        {profile?.display_name ?? "Athlete"} requested a late completion
                      </p>
                      <p className="text-sm text-slate-300">
                        Week {challenge?.week_index ?? "--"} · Challenge {challenge?.challenge_index ?? "--"} ·{" "}
                        {challenge?.title ?? "Challenge"}
                      </p>
                      <p className="text-xs text-slate-500">
                        Requested {new Date(request.requested_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleLateCompletionDecision(request.id, "approve")}
                        disabled={lateRequestLoadingIds.has(request.id)}
                        className="rounded-md bg-emerald-500 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-60"
                      >
                        {lateRequestLoadingIds.has(request.id) ? "Saving..." : "Approve"}
                      </button>
                      <button
                        onClick={() => handleLateCompletionDecision(request.id, "decline")}
                        disabled={lateRequestLoadingIds.has(request.id)}
                        className="rounded-md border border-rose-400/60 px-3 py-1 text-xs font-semibold text-rose-200 hover:border-rose-300 hover:text-rose-100 disabled:opacity-60"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {role === "admin" && (
          <>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-indigo-400">Groups</p>
                  <h2 className="text-2xl font-semibold">Create and manage groups</h2>
                </div>
                {teamStatus && <p className="text-sm text-rose-400">{teamStatus}</p>}
              </div>
              <div className="flex flex-col gap-3 md:flex-row">
                <input
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder="Group name"
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg p-3 text-white"
                />
                <button onClick={handleCreateTeam} className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg">
                  Create group
                </button>
              </div>
              <p className="text-sm text-slate-400">Join codes are shown below and can be shared with users.</p>

              <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-800 text-slate-300">
                    <tr>
                      <th className="p-3 text-left">Name</th>
                      <th className="p-3 text-left">Join code</th>
                      <th className="p-3 text-left">Members</th>
                      <th className="p-3 text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teams.map((team) => (
                      <tr key={team.id} className="border-t border-slate-800">
                        <td className="p-3">{team.name}</td>
                        <td className="p-3 text-slate-300">{team.join_code}</td>
                        <td className="p-3 space-y-2">
                          <p className="text-slate-300">{team.member_count} member(s)</p>
                          <ul className="space-y-1">
                            {team.members.map((member) => (
                              <li key={member.user_id} className="flex items-center justify-between gap-2">
                                <span className="text-slate-200">{member.display_name}</span>
                                <button
                                  onClick={() => handleRemoveMember(team.id, member.user_id)}
                                  className="text-rose-400 text-xs"
                                >
                                  Remove
                                </button>
                              </li>
                            ))}
                            {team.members.length === 0 && (
                              <li className="text-slate-500">No members</li>
                            )}
                          </ul>
                        </td>
                        <td className="p-3">
                          <button onClick={() => handleDeleteTeam(team.id)} className="text-rose-400">
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                    {teams.length === 0 && (
                      <tr>
                        <td className="p-3" colSpan={4}>
                          <p className="text-slate-500">No groups created yet.</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <label className="space-y-2 text-sm">
                  <span className="text-slate-300">Week index</span>
                  <input
                    type="number"
                    value={form.week_index}
                    onChange={(e) => setForm({ ...form, week_index: Number(e.target.value) })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white"
                  />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="text-slate-300">Challenge index</span>
                  <input
                    type="number"
                    value={form.challenge_index}
                    onChange={(e) => setForm({ ...form, challenge_index: Number(e.target.value) })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white"
                  />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="text-slate-300">Base points</span>
                  <input
                    type="number"
                    value={form.base_points}
                    onChange={(e) => setForm({ ...form, base_points: Number(e.target.value) })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white"
                  />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="text-slate-300">Goal metric</span>
                  <select
                    value={form.metric_type}
                    onChange={(e) =>
                      setForm({ ...form, metric_type: e.target.value as ChallengeMetricType })
                    }
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white"
                  >
                    {metricTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-500">
                    {metricTypeOptions.find((option) => option.value === form.metric_type)?.helper}
                  </p>
                </label>
                <label className="space-y-2 text-sm">
                  <span className="text-slate-300">Target value (optional)</span>
                  <input
                    type="number"
                    step="0.01"
                    value={form.target_value ?? ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        target_value: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white"
                  />
                  <p className="text-xs text-slate-500">Leave blank when progress is manual-only.</p>
                </label>
                <label className="space-y-2 text-sm">
                  <span className="text-slate-300">Target unit (optional)</span>
                  <input
                    value={form.target_unit ?? ""}
                    onChange={(e) => setForm({ ...form, target_unit: e.target.value || null })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white"
                    placeholder="e.g. miles, minutes, floors"
                  />
                  <p className="text-xs text-slate-500">Shown for context alongside numeric goals.</p>
                </label>
                <div className="space-y-2 text-sm md:col-span-2">
                  <span className="text-slate-300">Allowed Strava activity types (optional)</span>
                  <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                    {commonActivityTypes.map((activityType) => {
                      const selected = (form.activity_types ?? []).includes(activityType);
                      return (
                        <label
                          key={activityType}
                          className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition ${
                            selected ? "border-indigo-500 bg-indigo-500/10" : "border-slate-700 bg-slate-800"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleActivityType(activityType)}
                            className="h-4 w-4 rounded border-slate-600 bg-slate-700 text-indigo-500"
                          />
                          <span className="text-slate-200">{activityType}</span>
                        </label>
                      );
                    })}
                  </div>
                  {form.activity_types?.some((type) => !commonActivityTypes.includes(type)) && (
                    <div className="rounded-lg border border-amber-600/40 bg-amber-500/10 p-3 text-xs text-amber-100">
                      <p className="font-semibold">Custom activity types already set</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(form.activity_types ?? [])
                          .filter((type) => !commonActivityTypes.includes(type))
                          .map((type) => (
                            <button
                              key={type}
                              type="button"
                              onClick={() => toggleActivityType(type)}
                              className="group flex items-center gap-1 rounded-full border border-amber-400/60 px-2 py-1 text-amber-100 transition hover:bg-amber-500/20"
                            >
                              <span>{type}</span>
                              <span className="text-amber-200 group-hover:text-amber-50">×</span>
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                  <p className="text-xs text-slate-500">
                    Select the Strava activities participants can submit. Leave all unchecked to accept any
                    activity type from Strava or non-Strava submissions.
                  </p>
                </div>
                <label className="space-y-2 text-sm md:col-span-2">
                  <span className="text-slate-300">Title</span>
                  <input
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white"
                  />
                </label>
                <label className="space-y-2 text-sm md:col-span-2">
                  <span className="text-slate-300">Description</span>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white"
                    rows={3}
                  />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="text-slate-300">Start date & time</span>
                  <input
                    type="datetime-local"
                    value={formatDateTimeInput(form.start_date, DEFAULT_START_TIME)}
                    onChange={(e) => setForm({ ...form, start_date: e.target.value || null })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white"
                  />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="text-slate-300">End date & time</span>
                  <input
                    type="datetime-local"
                    value={formatDateTimeInput(form.end_date, DEFAULT_END_TIME)}
                    onChange={(e) => setForm({ ...form, end_date: e.target.value || null })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white"
                  />
                </label>
                <label className="flex items-center gap-3 text-sm md:col-span-2">
                  <input
                    type="checkbox"
                    checked={Boolean(form.hidden)}
                    onChange={(e) => setForm({ ...form, hidden: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-600 bg-slate-700 text-indigo-500"
                  />
                  <span className="text-slate-200">Hide this challenge from participants</span>
                </label>
              </div>
              <div className="space-y-2">
                <p className="text-sm text-slate-300">Limit to groups (optional)</p>
                <p className="text-xs text-slate-500">
                  Leave empty to make the challenge available to every group. Select one or more groups to restrict it.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {teams.map((team) => {
                    const selected = (form.team_ids ?? []).includes(team.id);
                    return (
                      <label
                        key={team.id}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                          selected ? "border-indigo-500 bg-indigo-500/10" : "border-slate-700 bg-slate-800"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleTeamSelection(team.id)}
                          className="h-4 w-4 rounded border-slate-600 bg-slate-700 text-indigo-500"
                        />
                        <span className="text-slate-200">{team.name}</span>
                      </label>
                    );
                  })}
                  {teams.length === 0 && <p className="text-sm text-slate-500">Create a group to restrict challenges.</p>}
                </div>
              </div>
              {status && <p className="text-sm text-rose-400">{status}</p>}
              <div className="flex gap-3">
                <button onClick={handleSubmit} className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg">
                  {editingId ? "Update" : "Create"} challenge
                </button>
                {editingId && (
                  <button onClick={resetForm} className="text-slate-300 underline">
                    Cancel
                  </button>
                )}
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-800 text-slate-300">
                    <tr>
                      <th className="p-3 text-left">Week</th>
                      <th className="p-3 text-left">Challenge #</th>
                      <th className="p-3 text-left">Title</th>
                      <th className="p-3 text-left">Visibility</th>
                      <th className="p-3 text-left">Teams</th>
                      <th className="p-3 text-left">Points</th>
                      <th className="p-3 text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {challenges.map((challenge) => (
                      <tr key={challenge.id} className="border-t border-slate-800">
                        <td className="p-3">{challenge.week_index}</td>
                        <td className="p-3">{challenge.challenge_index}</td>
                        <td className="p-3">{challenge.title}</td>
                        <td className="p-3 text-slate-300">{challenge.hidden ? "Hidden" : "Visible"}</td>
                        <td className="p-3 text-slate-300">
                          {challenge.team_ids?.length
                            ? challenge.team_ids
                                .map((id) => teams.find((team) => team.id === id)?.name ?? id)
                                .join(", ")
                            : "All groups"}
                      </td>
                      <td className="p-3">{challenge.base_points}</td>
                      <td className="p-3 flex gap-3">
                        <button className="text-indigo-400" onClick={() => startEditing(challenge)}>
                          Edit
                        </button>
                        <button className="text-emerald-400" onClick={() => startCopying(challenge)}>
                          Copy
                        </button>
                        <button className="text-rose-400" onClick={() => handleDelete(challenge.id)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {challenges.length === 0 && (
                    <tr>
                      <td className="p-3" colSpan={7}>
                        <p className="text-slate-500">No challenges created yet.</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
