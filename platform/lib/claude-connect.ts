// "Connect Claude Code" (migration 017): the one-time command that registers the Epsilon MCP server in a client's
// project folder. Pure (unit-tested). The token is shown once; only its sha256 is stored.

export const PROJECT_TOKEN_RE = /^eps_pt_[0-9a-f]{64}$/;
/** Where epsilon-os lives on the founder's Mac. $HOME expands inside double quotes; ~ would not. */
export const DEFAULT_OS_DIR = "$HOME/dev/epsilon-labs/epsilon-os";

/** POSIX single quotes: safe for any folder name (FP&LM, spaces, quotes). */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Double quotes that keep $HOME working but neutralise the other specials. */
function dq(s: string): string {
  return `"${s.replace(/(["\\`])/g, "\\$1")}"`;
}

export function connectCommand(o: { token: string; url: string; anonKey: string; osDir?: string | null; folder?: string | null }): string {
  if (!PROJECT_TOKEN_RE.test(o.token)) throw new Error("not a project token");
  if (!/^https:\/\/[A-Za-z0-9.-]+(:[0-9]+)?\/?$/.test(o.url)) throw new Error("not a Supabase URL");
  if (!/^[A-Za-z0-9._-]+$/.test(o.anonKey) || /^sb_secret_/.test(o.anonKey)) throw new Error("not a publishable key");
  const os = (o.osDir || DEFAULT_OS_DIR).replace(/\/+$/, "");
  const add = [
    "claude mcp add epsilon",
    `  --env EPSILON_PROJECT_TOKEN=${o.token}`,
    `  --env EPSILON_SUPABASE_URL=${o.url.replace(/\/$/, "")}`,
    `  --env EPSILON_SUPABASE_ANON_KEY=${o.anonKey}`,
    `  -- ${dq(`${os}/.venv/bin/python`)} ${dq(`${os}/mcp/run.py`)}`,
  ].join(" \\\n");
  return o.folder ? `cd ${shQuote(o.folder)} && \\\n${add}` : add;
}

/** "used 3 min ago" style for the token list; null = never used. */
export function lastUsed(at: string | null, now: number = Date.now()): string {
  if (!at) return "never used";
  const min = Math.max(0, Math.round((now - new Date(at).getTime()) / 60000));
  if (min < 1) return "used just now";
  if (min < 60) return `used ${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `used ${h} h ago`;
  return `used ${Math.round(h / 24)} days ago`;
}
