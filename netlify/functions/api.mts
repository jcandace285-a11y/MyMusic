// Netlify Function: a thin, server-side proxy to the Suno API (https://docs.sunoapi.org).
// The API key never reaches the browser — it lives in the SUNO_API_KEY environment variable.

const SUNO_BASE = "https://api.sunoapi.org/api/v1";
const MODELS = ["V6", "V6_WILD", "V6_MINI"] as const;

type Json = Record<string, unknown>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function fail(msg: string, status = 400): Response {
  return json({ code: status, msg }, status);
}

async function suno(path: string, init: RequestInit = {}): Promise<Response> {
  const key = process.env.SUNO_API_KEY;
  if (!key) return fail("Server is missing SUNO_API_KEY. Add it in Netlify → Site configuration → Environment variables.", 500);

  try {
    const res = await fetch(`${SUNO_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text();
    let body: Json;
    try {
      body = JSON.parse(text);
    } catch {
      body = { code: res.status, msg: text.slice(0, 300) || res.statusText };
    }
    // Suno returns HTTP 200 with a business `code` field; surface non-200 codes as errors.
    const code = typeof body.code === "number" ? body.code : res.status;
    return json(body, code === 200 ? 200 : code >= 400 && code < 600 ? code : 502);
  } catch (err) {
    return fail(`Could not reach Suno API: ${(err as Error).message}`, 502);
  }
}

function str(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
}

function num(v: unknown, min: number, max: number, step = 0.01): number | undefined {
  if (typeof v !== "number" || Number.isNaN(v)) return undefined;
  const clamped = Math.min(max, Math.max(min, v));
  return Math.round(clamped / step) * step;
}

function callbackUrl(req: Request): string {
  const origin = process.env.URL || new URL(req.url).origin;
  return `${origin}/api/callback`;
}

/** Build a request body for POST /generate that follows the documented mode rules. */
function buildGenerateBody(input: Json, req: Request): Json | string {
  const customMode = input.customMode === true;
  const instrumental = input.instrumental === true;
  const model = MODELS.includes(input.model as (typeof MODELS)[number]) ? (input.model as string) : "V6";
  const style = str(input.style, 1000);
  const lyrics = instrumental ? undefined : str(input.lyrics, 5000);

  const body: Json = { customMode, instrumental, model, callBackUrl: callbackUrl(req) };
  if (style) body.style = style;
  if (lyrics) body.lyrics = lyrics;

  if (!customMode) {
    const prompt = str(input.prompt, 3000);
    if (prompt) body.prompt = prompt;
    if (!prompt && !style && !lyrics) return "Describe your song, or add a style.";
    // Non-custom mode needs at least a style or lyrics attachment; derive a style from the idea if missing.
    if (!style && !lyrics && prompt) body.style = prompt.slice(0, 200);
    return body;
  }

  const title = str(input.title, 80);
  const negativeTags = str(input.negativeTags, 1000);
  if (title) body.title = title;
  if (negativeTags) body.negativeTags = negativeTags;
  if (!style && !lyrics && !negativeTags) return "Custom mode needs at least a style or lyrics.";

  if (input.vocalGender === "m" || input.vocalGender === "f") body.vocalGender = input.vocalGender;
  const duration = num(input.duration, 10, 360, 1);
  if (duration !== undefined) body.duration = duration;
  const styleWeight = num(input.styleWeight, 0, 1);
  if (styleWeight !== undefined) body.styleWeight = Number(styleWeight.toFixed(2));
  const weirdness = num(input.weirdnessConstraint, 0, 1);
  if (weirdness !== undefined) body.weirdnessConstraint = Number(weirdness.toFixed(2));
  const variety = num(input.variety, 0, 4, 1);
  if (variety !== undefined) body.variety = variety;
  return body;
}

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/(api|\.netlify\/functions\/api)\/?/, "");

  // Suno posts results here; we poll for status instead, so just acknowledge.
  if (route === "callback") return json({ code: 200, msg: "received" });

  const password = process.env.APP_PASSWORD;
  if (route === "config" && req.method === "GET") {
    return json({ code: 200, data: { passwordRequired: Boolean(password), keyConfigured: Boolean(process.env.SUNO_API_KEY) } });
  }
  if (password && req.headers.get("x-app-password") !== password) {
    return fail("Wrong or missing access password.", 401);
  }

  if (route === "credits" && req.method === "GET") {
    return suno("/generate/credit");
  }

  if (route === "generate" && req.method === "POST") {
    const input = (await req.json().catch(() => null)) as Json | null;
    if (!input) return fail("Invalid JSON body.");
    const body = buildGenerateBody(input, req);
    if (typeof body === "string") return fail(body);
    return suno("/generate", { method: "POST", body: JSON.stringify(body) });
  }

  if (route === "status" && req.method === "GET") {
    const taskId = url.searchParams.get("taskId");
    if (!taskId || !/^[\w-]{1,128}$/.test(taskId)) return fail("Missing or invalid taskId.");
    return suno(`/generate/record-info?taskId=${encodeURIComponent(taskId)}`);
  }

  if (route === "lyrics" && req.method === "POST") {
    const input = (await req.json().catch(() => null)) as Json | null;
    const prompt = str(input?.prompt, 200);
    if (!prompt) return fail("Tell us what the lyrics should be about.");
    return suno("/lyrics", { method: "POST", body: JSON.stringify({ prompt, callBackUrl: callbackUrl(req) }) });
  }

  if (route === "lyrics-status" && req.method === "GET") {
    const taskId = url.searchParams.get("taskId");
    if (!taskId || !/^[\w-]{1,128}$/.test(taskId)) return fail("Missing or invalid taskId.");
    return suno(`/lyrics/record-info?taskId=${encodeURIComponent(taskId)}`);
  }

  return fail("Not found.", 404);
};

export const config = { path: "/api/*" };
