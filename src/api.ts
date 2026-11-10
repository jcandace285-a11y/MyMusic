export type Model = "V6" | "V6_WILD" | "V6_MINI";

export interface GenerateInput {
  customMode: boolean;
  instrumental: boolean;
  model: Model;
  prompt?: string;
  style?: string;
  title?: string;
  lyrics?: string;
  negativeTags?: string;
  vocalGender?: "m" | "f";
  duration?: number;
  styleWeight?: number;
  weirdnessConstraint?: number;
  variety?: number;
}

export interface SunoTrack {
  id: string;
  audio_url?: string;
  stream_audio_url?: string;
  source_stream_audio_url?: string;
  image_url?: string;
  source_image_url?: string;
  prompt?: string;
  model_name?: string;
  title?: string;
  tags?: string;
  createTime?: string;
  duration?: number | null;
}

export type TaskStatus =
  | "PENDING"
  | "TEXT_SUCCESS"
  | "FIRST_SUCCESS"
  | "SUCCESS"
  | "CREATE_TASK_FAILED"
  | "GENERATE_AUDIO_FAILED"
  | "CALLBACK_EXCEPTION"
  | "SENSITIVE_WORD_ERROR";

export interface TaskDetails {
  taskId: string;
  status: TaskStatus;
  response?: { sunoData?: SunoTrack[] | null } | null;
  errorCode?: number | null;
  errorMessage?: string | null;
}

export interface LyricsDetails {
  status: string;
  response?: { data?: { text: string; title: string; status: string; errorMessage?: string }[] | null } | null;
  errorMessage?: string | null;
}

const PW_KEY = "mymusic.password";

export function getPassword(): string {
  try {
    return localStorage.getItem(PW_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setPassword(pw: string) {
  try {
    localStorage.setItem(PW_KEY, pw);
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const FRIENDLY: Record<number, string> = {
  401: "Unauthorized — check the access password or the server's API key.",
  405: "Rate limit exceeded. Please wait a moment and try again.",
  413: "Your prompt or lyrics are too long.",
  429: "The account is out of credits. Top up at sunoapi.org.",
  430: "Too many requests. Please slow down and try again shortly.",
  455: "Suno is under maintenance. Please try again later.",
};

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-app-password": getPassword(), ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({ msg: res.statusText }));
  if (!res.ok || (typeof body.code === "number" && body.code !== 200)) {
    const status = typeof body.code === "number" ? body.code : res.status;
    throw new ApiError(body.msg && body.msg !== "success" ? body.msg : FRIENDLY[status] ?? "Request failed.", status);
  }
  return body.data as T;
}

export const api = {
  config: () => call<{ passwordRequired: boolean; keyConfigured: boolean }>("config"),
  credits: () => call<number>("credits"),
  generate: (input: GenerateInput) =>
    call<{ taskId: string }>("generate", { method: "POST", body: JSON.stringify(input) }),
  status: (taskId: string) => call<TaskDetails>(`status?taskId=${encodeURIComponent(taskId)}`),
  lyrics: (prompt: string) => call<{ taskId: string }>("lyrics", { method: "POST", body: JSON.stringify({ prompt }) }),
  lyricsStatus: (taskId: string) => call<LyricsDetails>(`lyrics-status?taskId=${encodeURIComponent(taskId)}`),
};

export const FAILED_STATUSES: TaskStatus[] = [
  "CREATE_TASK_FAILED",
  "GENERATE_AUDIO_FAILED",
  "CALLBACK_EXCEPTION",
  "SENSITIVE_WORD_ERROR",
];

export function statusLabel(s: TaskStatus | "SUBMITTING"): string {
  switch (s) {
    case "SUBMITTING":
      return "Submitting…";
    case "PENDING":
      return "Queued…";
    case "TEXT_SUCCESS":
      return "Writing lyrics…";
    case "FIRST_SUCCESS":
      return "Finishing up…";
    case "SUCCESS":
      return "Ready";
    case "SENSITIVE_WORD_ERROR":
      return "Blocked: prompt contains restricted words";
    case "CREATE_TASK_FAILED":
      return "Failed to start";
    case "GENERATE_AUDIO_FAILED":
      return "Generation failed";
    case "CALLBACK_EXCEPTION":
      return "Failed";
    default:
      return s;
  }
}
