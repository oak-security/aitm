// GitHub OAuth + in-memory sessions, mirroring Hive's serve-mt AuthManager: the
// session id is an opaque 32-byte random token looked up server-side (no cookie
// signing; a restart signs everyone out). Access is gated on org membership
// (AITM_ALLOWED_ORGS, default oak-security) OR an explicit user allowlist.
// AITM_AUTH_BYPASS=1 skips GitHub entirely for local testing and is refused at
// startup when the base URL is not localhost.
import crypto from "node:crypto";

const SESSION_COOKIE = "aitm_sess";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const STATE_TTL_MS = 10 * 60 * 1000;

export const DEV_USER = { id: "local:dev", login: "local", name: "Local development" };

export function isLocalhostUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

function readCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

function sessionCookie(value, secure, maxAge = SESSION_TTL_MS / 1000) {
  const attrs = [`${SESSION_COOKIE}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

async function githubJson(url, token) {
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "aitm-web"
    }
  });
  if (!res.ok) throw new Error(`GitHub API ${url} failed: ${res.status}`);
  return res.json();
}

export class AuthManager {
  // cfg: { baseUrl, clientId, clientSecret, orgs: [], users: [], bypass: bool }
  constructor(cfg) {
    this.cfg = cfg;
    this.secureCookie = String(cfg.baseUrl || "").startsWith("https://");
    this.githubEnabled = Boolean(cfg.clientId && cfg.clientSecret);
    this.sessions = new Map(); // sid -> { user, createdAt }
    this.states = new Map(); // state -> createdAt
    if (cfg.bypass && cfg.baseUrl && !isLocalhostUrl(cfg.baseUrl)) {
      throw new Error("AITM_AUTH_BYPASS is only allowed with a localhost base URL.");
    }
  }

  currentUser(req) {
    if (this.cfg.bypass) return DEV_USER;
    const sid = readCookie(req, SESSION_COOKIE);
    if (!sid) return null;
    const s = this.sessions.get(sid);
    if (!s) return null;
    if (Date.now() - s.createdAt > SESSION_TTL_MS) {
      this.sessions.delete(sid);
      return null;
    }
    return s.user;
  }

  mintSession(user) {
    const sid = crypto.randomBytes(32).toString("hex");
    this.sessions.set(sid, { user, createdAt: Date.now() });
    return sid;
  }

  restrictsAccess() {
    return this.cfg.orgs.length > 0 || this.cfg.users.length > 0;
  }

  authorizeUrl() {
    const state = crypto.randomBytes(16).toString("hex");
    this.states.set(state, Date.now());
    for (const [s, t] of this.states) if (Date.now() - t > STATE_TTL_MS) this.states.delete(s);
    const scope = this.cfg.orgs.length ? "read:user read:org" : "read:user";
    const q = new URLSearchParams({
      client_id: this.cfg.clientId,
      redirect_uri: `${this.cfg.baseUrl}/auth/github/callback`,
      scope,
      state
    });
    return `https://github.com/login/oauth/authorize?${q}`;
  }

  consumeState(state) {
    if (!state || !this.states.has(state)) return false;
    const t = this.states.get(state);
    this.states.delete(state);
    return Date.now() - t <= STATE_TTL_MS;
  }

  async isOrgMember(token) {
    for (let page = 1; page <= 5; page += 1) {
      const orgs = await githubJson(`https://api.github.com/user/orgs?per_page=100&page=${page}`, token);
      if (!Array.isArray(orgs) || !orgs.length) return false;
      if (orgs.some((o) => this.cfg.orgs.includes(String(o.login).toLowerCase()))) return true;
      if (orgs.length < 100) return false;
    }
    return false;
  }

  async exchangeCode(code) {
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        code,
        redirect_uri: `${this.cfg.baseUrl}/auth/github/callback`
      })
    });
    const data = await res.json().catch(() => ({}));
    const token = data.access_token;
    if (!token) throw new Error(data.error_description || "GitHub token exchange failed.");

    const profile = await githubJson("https://api.github.com/user", token);
    const login = String(profile.login || "").toLowerCase();
    if (this.restrictsAccess()) {
      const allowed = this.cfg.users.includes(login) || (this.cfg.orgs.length && (await this.isOrgMember(token)));
      if (!allowed) {
        throw new Error(`@${profile.login} is not a member of ${this.cfg.orgs.join(", ") || "the allowlist"}.`);
      }
    }
    return {
      id: `gh:${profile.id}`,
      login: profile.login,
      name: profile.name || profile.login,
      avatar: profile.avatar_url || ""
    };
  }

  // Handles /auth/* routes. Returns true if the request was consumed.
  async handle(req, res, pathname, query) {
    const json = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (pathname === "/auth/me") {
      const user = this.currentUser(req);
      if (!user) return json(401, { error: { code: "unauthenticated", message: "Not signed in." } });
      return json(200, { user, bypass: this.cfg.bypass });
    }
    if (pathname === "/auth/config") {
      return json(200, {
        githubEnabled: this.githubEnabled,
        bypass: this.cfg.bypass,
        restricted: this.restrictsAccess(),
        orgs: this.cfg.orgs
      });
    }
    if (pathname === "/auth/logout") {
      const sid = readCookie(req, SESSION_COOKIE);
      if (sid) this.sessions.delete(sid);
      const cookie = sessionCookie("", this.secureCookie, 0);
      if (req.method === "POST") {
        res.writeHead(200, { "set-cookie": cookie, "content-type": "application/json" });
        return res.end("{}");
      }
      res.writeHead(302, { "set-cookie": cookie, location: "/" });
      return res.end();
    }
    if (pathname === "/auth/github") {
      if (!this.githubEnabled) return json(503, { error: { code: "auth_disabled", message: "GitHub OAuth is not configured." } });
      res.writeHead(302, { location: this.authorizeUrl() });
      return res.end();
    }
    if (pathname === "/auth/github/callback") {
      const fail = (message) => {
        res.writeHead(302, { location: `/?auth_error=${encodeURIComponent(message)}` });
        res.end();
      };
      if (!this.githubEnabled) return fail("GitHub OAuth is not configured.");
      const code = query.get("code");
      if (!code || !this.consumeState(query.get("state"))) return fail("Invalid or expired login state.");
      try {
        const user = await this.exchangeCode(code);
        const sid = this.mintSession(user);
        res.writeHead(302, { "set-cookie": sessionCookie(sid, this.secureCookie), location: "/" });
        return res.end();
      } catch (err) {
        return fail(err.message || "Sign-in failed.");
      }
    }
    return false;
  }
}

// Origin/CSRF guard for mutating requests (Hive pattern): the browser always sends
// Origin on POST; a cross-site page sends a foreign one; curl sends none. Reads are
// exempt. Disabled in bypass mode so local curl testing works.
export function sameOrigin(req, expectedOrigin) {
  const origin = req.headers.origin || null;
  if (origin) return origin === expectedOrigin;
  const referer = req.headers.referer;
  if (referer) {
    try {
      return new URL(referer).origin === expectedOrigin;
    } catch {
      return false;
    }
  }
  return false;
}

export function userDirName(uid) {
  return String(uid).replace(/[^a-zA-Z0-9_-]/g, "-");
}
