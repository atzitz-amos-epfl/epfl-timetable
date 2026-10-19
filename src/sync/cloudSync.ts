import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Cloud sync through Supabase: the planner, course corrections and agenda (the localStorage blobs the app already
 * keeps) are mirrored in one row per user, protected by row-level security (see supabase/schema.sql).
 *
 * The app keeps reading and writing localStorage; this module only moves those blobs:
 * - each section is merged on its own: whichever side changed since the last sync wins, and if both did,
 *   the most recent change wins;
 * - writes are conditional on the row's updated_at, so two devices can't overwrite each other blindly;
 * - view-only planner fields (open tab, shown semester, Explore selections) stay on each device.
 */

const SECTIONS = {
  planner: "studies-planner-state-v1",
  courseEdits: "studies-planner-course-edits-v1",
  agenda: "studies-planner-agenda-v1",
} as const;
type Section = keyof typeof SECTIONS;
type Blobs = Record<Section, unknown>;
const SECTION_NAMES = Object.keys(SECTIONS) as Section[];

// Planner fields that describe this device's view rather than the plan itself.
const DEVICE_ONLY_PLANNER_FIELDS = [
  "activeSemester",
  "activeTab",
  "collapsedOptionalSemesters",
  "openedOptionalGroups",
  "timetableTabSelectedPlanKeys",
  "timetableTabSelectedCourseIds",
  "timetableTabSelectedRoomKeys",
];

const META_KEY = "studies-planner-sync-v1";
const TABLE = "user_data";

interface SyncMeta {
  userId: string;
  // updated_at of the row as of the last sync, and the sections as they were then (stable JSON).
  remoteUpdatedAt: string | null;
  snapshot: Record<Section, string> | null;
  // When this device first changed something since the last sync (ms), to settle conflicts.
  localChangedAt: number | null;
}

export type SyncState = "disabled" | "signed-out" | "syncing" | "synced" | "offline" | "error";

export interface SyncStatus {
  state: SyncState;
  email: string;
  lastSyncedAt: number | null;
  message: string;
}

/** Asked once per device when both it and the account already hold different data. */
export type ChooseSource = () => Promise<"cloud" | "device">;

// --- Helpers ---

/** JSON with sorted keys: Postgres jsonb doesn't keep key order, so plain JSON.stringify can't compare. */
const stable = (value: unknown): string => JSON.stringify(value ?? null, (_key, inner) =>
  inner && typeof inner === "object" && !Array.isArray(inner)
    ? Object.fromEntries(Object.keys(inner).sort().map((key) => [key, (inner as Record<string, unknown>)[key]]))
    : inner);

const readJson = (key: string): unknown => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const withoutDeviceFields = (planner: unknown): unknown => {
  if (!planner || typeof planner !== "object") {
    return planner ?? null;
  }
  const copy = { ...(planner as Record<string, unknown>) };
  DEVICE_ONLY_PLANNER_FIELDS.forEach((field) => delete copy[field]);
  return copy;
};

const readLocal = (): Blobs => ({
  planner: withoutDeviceFields(readJson(SECTIONS.planner)),
  courseEdits: readJson(SECTIONS.courseEdits),
  agenda: readJson(SECTIONS.agenda),
});

/** Writes synced sections into localStorage, keeping this device's view fields. */
const writeLocal = (blobs: Blobs): void => {
  SECTION_NAMES.forEach((section) => {
    let value = blobs[section];
    if (section === "planner" && value && typeof value === "object") {
      const current = readJson(SECTIONS.planner);
      const deviceFields = current && typeof current === "object"
        ? Object.fromEntries(DEVICE_ONLY_PLANNER_FIELDS
          .filter((field) => field in (current as Record<string, unknown>))
          .map((field) => [field, (current as Record<string, unknown>)[field]]))
        : {};
      value = { ...(value as Record<string, unknown>), ...deviceFields };
    }
    try {
      if (value === null || value === undefined) {
        window.localStorage.removeItem(SECTIONS[section]);
      } else {
        window.localStorage.setItem(SECTIONS[section], JSON.stringify(value));
      }
    } catch {
      // Storage full or blocked: the next sync tries again.
    }
  });
};

const snapshotOf = (blobs: Blobs): Record<Section, string> =>
  Object.fromEntries(SECTION_NAMES.map((section) => [section, stable(blobs[section])])) as Record<Section, string>;

/**
 * Whether there is anything worth keeping: planned courses, corrections or agenda items. A browser that only
 * opened the app once has default settings, which shouldn't count against an account's data.
 */
const hasOwnData = (blobs: Blobs): boolean => {
  const filled = (value: unknown): boolean => Array.isArray(value)
    ? value.length > 0
    : Boolean(value) && typeof value === "object" && Object.keys(value as object).length > 0;
  const planner = (blobs.planner ?? {}) as Record<string, unknown>;
  const edits = (blobs.courseEdits ?? {}) as Record<string, unknown>;
  const agenda = (blobs.agenda ?? {}) as Record<string, unknown>;
  return ["addedCourseIds", "placements", "semesterOverrides", "disabledCourseIds", "variantChoices"].some((field) => filled(planner[field]))
    || Object.entries(edits).some(([field, value]) => field !== "version" && filled(value))
    || filled(agenda.items)
    || filled(agenda.semesterStarts);
};

const loadMeta = (): SyncMeta | null => {
  const meta = readJson(META_KEY) as SyncMeta | null;
  return meta && typeof meta.userId === "string" ? meta : null;
};

const saveMeta = (meta: SyncMeta | null): void => {
  try {
    if (meta) {
      window.localStorage.setItem(META_KEY, JSON.stringify(meta));
    } else {
      window.localStorage.removeItem(META_KEY);
    }
  } catch {
    // Ignore: worst case the next sync compares against an older snapshot.
  }
};

/** Supabase errors as shown to the user; network failures get a plain sentence. */
const describeError = (message: string): string =>
  /failed to fetch|network|load failed/i.test(message) ? "Couldn't reach the sync server. Check your connection and try again." : message;

const PUSH_DELAY_MS = 1500;
const POLL_INTERVAL_MS = 60_000;

export class CloudSync {
  private client: SupabaseClient | null = null;
  private userId: string | null = null;
  private status: SyncStatus = { state: "disabled", email: "", lastSyncedAt: null, message: "" };
  private readonly listeners = new Set<(status: SyncStatus) => void>();
  private running = false;
  private queued = false;
  private pushTimer: number | null = null;
  // Called when synced data replaced what the app has loaded (the app then reloads it).
  public onRemoteApplied: () => void = () => undefined;
  // Called after a password reset link was opened, to let the user pick a new password.
  public onPasswordRecovery: () => void = () => undefined;

  public constructor(private readonly chooseSource: ChooseSource) {}

  public static isConfigured(): boolean {
    return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
  }

  public getStatus(): SyncStatus {
    return this.status;
  }

  public subscribe(listener: (status: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Connects to Supabase and, when a session exists, runs the first sync. Never throws. */
  public async start(): Promise<void> {
    if (!CloudSync.isConfigured()) {
      return;
    }
    try {
      const { createClient } = await import("@supabase/supabase-js");
      this.client = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
    } catch {
      this.setStatus({ state: "error", message: "Couldn't load the sync service." });
      return;
    }

    this.client.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        window.setTimeout(() => this.onPasswordRecovery(), 0);
      }
      const userId = session?.user.id ?? null;
      if (userId !== this.userId) {
        this.userId = userId;
        if (userId) {
          this.setStatus({ state: "syncing", email: session?.user.email ?? "", message: "" });
          // Outside the auth callback: Supabase calls made inside it can deadlock.
          window.setTimeout(() => void this.sync(), 0);
        } else {
          this.setStatus({ state: "signed-out", email: "", lastSyncedAt: null, message: "" });
        }
      }
    });

    const { data } = await this.client.auth.getSession();
    const session = data.session;
    this.userId = session?.user.id ?? null;
    if (session) {
      this.setStatus({ state: "syncing", email: session.user.email ?? "", message: "" });
      await this.sync();
    } else {
      this.setStatus({ state: "signed-out" });
    }

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        void this.sync();
      }
    });
    window.addEventListener("online", () => void this.sync());
    window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void this.sync();
      }
    }, POLL_INTERVAL_MS);
  }

  // --- Account ---

  public async signIn(email: string, password: string): Promise<string | null> {
    if (!this.client) {
      return "Sync isn't set up.";
    }
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    return error ? describeError(error.message) : null;
  }

  /** Returns an error, or null; `needsConfirmation` when the project asks to confirm the email first. */
  public async signUp(email: string, password: string): Promise<{ error: string | null; needsConfirmation: boolean }> {
    if (!this.client) {
      return { error: "Sync isn't set up.", needsConfirmation: false };
    }
    const { data, error } = await this.client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin + window.location.pathname },
    });
    return { error: error ? describeError(error.message) : null, needsConfirmation: !error && !data.session };
  }

  public async sendPasswordReset(email: string): Promise<string | null> {
    if (!this.client) {
      return "Sync isn't set up.";
    }
    const { error } = await this.client.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname,
    });
    return error ? describeError(error.message) : null;
  }

  public async updatePassword(password: string): Promise<string | null> {
    if (!this.client) {
      return "Sync isn't set up.";
    }
    const { error } = await this.client.auth.updateUser({ password });
    return error ? describeError(error.message) : null;
  }

  /** Signs out; the data stays in this browser. */
  public async signOut(): Promise<void> {
    if (this.pushTimer !== null) {
      window.clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
    await this.client?.auth.signOut();
    saveMeta(null);
  }

  // --- Syncing ---

  /** To call after the app saved something: pushes it shortly after (changes are batched). */
  public notifyLocalChange(): void {
    if (!this.userId) {
      return;
    }
    const meta = loadMeta();
    if (!meta?.snapshot) {
      return;
    }
    const local = snapshotOf(readLocal());
    if (SECTION_NAMES.every((section) => local[section] === meta.snapshot![section])) {
      return;
    }
    if (meta.localChangedAt === null) {
      saveMeta({ ...meta, localChangedAt: Date.now() });
    }
    if (this.pushTimer !== null) {
      window.clearTimeout(this.pushTimer);
    }
    this.pushTimer = window.setTimeout(() => {
      this.pushTimer = null;
      void this.sync();
    }, PUSH_DELAY_MS);
  }

  /** Pull, merge, push. Runs one at a time; a request made meanwhile runs right after. */
  public async sync(): Promise<void> {
    if (!this.client || !this.userId) {
      return;
    }
    if (this.running) {
      this.queued = true;
      return;
    }
    this.running = true;
    this.setStatus({ state: "syncing", message: "" });
    try {
      // A few rounds at most: a write refused because another device just wrote is retried after merging.
      let applied = false;
      for (let round = 0; round < 3; round += 1) {
        const outcome = await this.syncOnce();
        applied = applied || outcome.applied;
        if (outcome.done) {
          break;
        }
      }
      this.setStatus({ state: "synced", lastSyncedAt: Date.now(), message: "" });
      if (applied) {
        this.onRemoteApplied();
      }
    } catch (problem) {
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      this.setStatus({
        state: offline ? "offline" : "error",
        message: offline ? "Offline: changes will sync when you're back online." : problem instanceof Error ? describeError(problem.message) : "Sync failed.",
      });
    } finally {
      this.running = false;
      if (this.queued) {
        this.queued = false;
        void this.sync();
      }
    }
  }

  private async syncOnce(): Promise<{ done: boolean; applied: boolean }> {
    const client = this.client!;
    const userId = this.userId!;
    let meta = loadMeta();
    if (!meta || meta.userId !== userId) {
      meta = { userId, remoteUpdatedAt: null, snapshot: null, localChangedAt: null };
    }

    const { data: row, error } = await client.from(TABLE).select("data, updated_at").eq("user_id", userId).maybeSingle();
    if (error) {
      throw new Error(error.message);
    }
    const local = readLocal();

    // Nothing in the account yet: it starts with this device's data.
    if (!row) {
      return this.push(meta, local, null);
    }

    const remoteData = (row.data ?? {}) as Partial<Blobs>;
    const remote: Blobs = {
      planner: withoutDeviceFields(remoteData.planner ?? null),
      courseEdits: remoteData.courseEdits ?? null,
      agenda: remoteData.agenda ?? null,
    };
    const localSnapshot = snapshotOf(local);
    const remoteSnapshot = snapshotOf(remote);
    const same = SECTION_NAMES.every((section) => localSnapshot[section] === remoteSnapshot[section]);

    let merged: Blobs;
    if (!meta.snapshot) {
      // First sync on this device for this account.
      if (same || !hasOwnData(local)) {
        merged = remote;
      } else if (!hasOwnData(remote)) {
        merged = local;
      } else {
        merged = (await this.chooseSource()) === "cloud" ? remote : local;
      }
    } else {
      const base = meta.snapshot;
      const remoteTime = Date.parse(row.updated_at);
      const localNewer = meta.localChangedAt !== null && meta.localChangedAt > remoteTime;
      merged = { ...local };
      SECTION_NAMES.forEach((section) => {
        const localChanged = localSnapshot[section] !== base[section];
        const remoteChanged = remoteSnapshot[section] !== base[section];
        if (remoteChanged && (!localChanged || !localNewer)) {
          merged[section] = remote[section];
        }
      });
    }

    const mergedSnapshot = snapshotOf(merged);
    const applied = SECTION_NAMES.some((section) => mergedSnapshot[section] !== localSnapshot[section]);
    if (applied) {
      writeLocal(merged);
    }
    const needsPush = SECTION_NAMES.some((section) => mergedSnapshot[section] !== remoteSnapshot[section]);
    if (!needsPush) {
      saveMeta({ userId, remoteUpdatedAt: row.updated_at, snapshot: mergedSnapshot, localChangedAt: null });
      return { done: true, applied };
    }
    const pushed = await this.push({ ...meta, remoteUpdatedAt: row.updated_at }, merged, row.updated_at);
    return { done: pushed.done, applied };
  }

  /** Writes the sections; refused (done: false) if the row changed since `expectedUpdatedAt`. */
  private async push(meta: SyncMeta, blobs: Blobs, expectedUpdatedAt: string | null): Promise<{ done: boolean; applied: boolean }> {
    const client = this.client!;
    const data = { planner: blobs.planner, courseEdits: blobs.courseEdits, agenda: blobs.agenda };
    let result;
    if (expectedUpdatedAt === null) {
      result = await client.from(TABLE).insert({ user_id: meta.userId, data }).select("updated_at");
      // Another device created the row first: merge with it on the next round.
      if (result.error?.code === "23505") {
        return { done: false, applied: false };
      }
    } else {
      result = await client.from(TABLE).update({ data }).eq("user_id", meta.userId).eq("updated_at", expectedUpdatedAt).select("updated_at");
    }
    if (result.error) {
      throw new Error(result.error.message);
    }
    const written = result.data?.[0];
    if (!written) {
      return { done: false, applied: false };
    }
    saveMeta({ userId: meta.userId, remoteUpdatedAt: written.updated_at, snapshot: snapshotOf(blobs), localChangedAt: null });
    return { done: true, applied: false };
  }

  private setStatus(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    this.listeners.forEach((listener) => listener(this.status));
  }
}
