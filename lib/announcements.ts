export interface AnnouncementPayload {
  title: string;
  body_md: string;
}

export interface Announcement {
  id: string;
  title: string;
  body_md: string;
  created_at: string;
  updated_at?: string | null;
  author_name: string;
}

async function handleResponse<T>(response: Response): Promise<T> {
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }
  return payload as T;
}

export async function listAnnouncements() {
  const response = await fetch("/api/announcements");
  return handleResponse<{ announcements: Announcement[] }>(response);
}

export async function createAnnouncement(body: AnnouncementPayload) {
  const response = await fetch("/api/announcements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return handleResponse<{ announcement: Announcement }>(response);
}

export async function updateAnnouncement(id: string, body: AnnouncementPayload) {
  const response = await fetch("/api/announcements", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, ...body }),
  });
  return handleResponse<{ announcement: Announcement }>(response);
}

export async function deleteAnnouncement(id: string) {
  const response = await fetch(`/api/announcements?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return handleResponse<{ success: boolean }>(response);
}
