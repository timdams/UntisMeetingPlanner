import { Teacher, ClassGroup, RosterEntry } from '../types';

// Temporarily pointing to local development proxy or final Cloudflare worker
// In a real scenario, this would be an environment variable
const BASE_URL = 'https://untis-proxy.untisproxydams.workers.dev'; // Removed /WebUntis as it's appended in the fetch calls
const TENANT_ID = '3257400';
const SCHOOL = 'ap';

const SESSION_CRED_KEY = 'untis_session_creds';

// School year the Traject Planner defaults to. Class/teacher resource IDs differ
// per school year, so the picker in the settings must resolve against the same
// year the rosters are fetched for. Set to the academic year we are planning.
const PREFERRED_SCHOOL_YEAR_NAME = '2026/2027';

// Hard override for the preferred school year ID. Leave null to auto-discover by
// name. Only set this if discovery fails to find PREFERRED_SCHOOL_YEAR_NAME — read
// the id from the network tab: the `x-webuntis-api-school-year-id` header that the
// WebUntis site sends after toggling to 2026/2027.
const PREFERRED_SCHOOL_YEAR_ID: number | null = null;

interface SchoolYear {
    id: number;
    name: string;
    start: string; // YYYY-MM-DD
    end: string;   // YYYY-MM-DD
}

class UntisService {
    private bearerToken: string | null = null;
    // Raw WebUntis session cookie string, captured server-side at login and
    // replayed on every request via the x-untis-session header. This bypasses
    // the browser cookie jar entirely (Safari ITP / Chrome 3rd-party-cookie
    // blocking / managed-Chrome policy would otherwise drop the proxy's
    // third-party JSESSIONID, leaving every call unauthenticated).
    private sessionId: string | null = null;
    private isAuthenticated = false;
    private lastUsername: string | null = null;
    private lastPassword: string | null = null;
    private reAuthPromise: Promise<boolean> | null = null;
    private schoolYears: SchoolYear[] = [];
    private activeSchoolYearId: number | null = null;

    // Helper to build headers, optionally scoped to a specific school year
    private getHeaders(schoolYearId?: number | null) {
        const headers: Record<string, string> = {
            'tenant-id': TENANT_ID,
        };
        if (this.bearerToken) {
            headers['Authorization'] = `Bearer ${String(this.bearerToken).trim()}`;
        }
        if (this.sessionId) {
            headers['x-untis-session'] = this.sessionId;
        }
        const syId = schoolYearId ?? this.activeSchoolYearId;
        if (syId !== null) {
            headers['x-webuntis-api-school-year-id'] = String(syId);
        }
        return headers;
    }

    // Returns the school year ID that contains the given date, or null if unknown
    private schoolYearIdForDate(date: Date): number | null {
        const iso = date.toISOString().split('T')[0];
        const match = this.schoolYears.find(sy => iso >= sy.start && iso <= sy.end);
        return match ? match.id : (this.activeSchoolYearId ?? null);
    }

    // The currently active school year object, if known.
    private activeSchoolYear(): SchoolYear | null {
        return this.schoolYears.find(y => y.id === this.activeSchoolYearId) ?? null;
    }

    // Public: the name of the resolved active school year (e.g. "2026/2027"),
    // or null if discovery has not run / found nothing. Used by the UI to show
    // which academic year the resource IDs belong to.
    getActiveSchoolYearName(): string | null {
        return this.activeSchoolYear()?.name ?? null;
    }

    // A short start/end date window that falls *inside* the active school year,
    // for the resource filter (teachers/classes). Using a date in the wrong year
    // returns the wrong year's resource IDs, so we anchor on the active year's
    // start date. Falls back to today when no school year is known.
    private resourceFilterWindow(): { start: string; end: string } {
        const active = this.activeSchoolYear();
        if (active) {
            const start = new Date(active.start);
            const end = new Date(start.getTime() + 7 * 86400000);
            // Clamp the end to the school year end so we never straddle the boundary.
            const yearEnd = new Date(active.end);
            const endClamped = end.getTime() > yearEnd.getTime() ? yearEnd : end;
            return { start: active.start, end: endClamped.toISOString().split('T')[0] };
        }
        const today = new Date().toISOString().split('T')[0];
        const week = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
        return { start: today, end: week };
    }

    // Returns the school year ID appropriate for a date range (uses start date)
    private schoolYearIdForRange(start: Date, _end: Date): number | null {
        return this.schoolYearIdForDate(start);
    }

    async login(username: string, password: string): Promise<{ success: boolean; error?: string; rawResponses?: any; exception?: any }> {
        const result = await this.performLogin(username, password);
        if (result.success) {
            this.lastUsername = username;
            this.lastPassword = password;
            try {
                sessionStorage.setItem(SESSION_CRED_KEY, JSON.stringify({ u: username, p: password }));
            } catch {
                // sessionStorage unavailable (private mode etc.) — no-op
            }
            await this.fetchSchoolYears();
        }
        return result;
    }

    // Attempt to restore an authenticated session using credentials previously
    // stashed in sessionStorage on login(). Used on app startup so that a page
    // refresh (F5) does not boot the user back to the login screen.
    async restoreSession(): Promise<boolean> {
        if (this.isAuthenticated) return true;
        let raw: string | null = null;
        try {
            raw = sessionStorage.getItem(SESSION_CRED_KEY);
        } catch {
            return false;
        }
        if (!raw) return false;
        try {
            const { u, p } = JSON.parse(raw);
            if (!u || !p) return false;
            const result = await this.performLogin(u, p);
            if (result.success) {
                this.lastUsername = u;
                this.lastPassword = p;
                await this.fetchSchoolYears();
                return true;
            }
            // Stored creds no longer valid (password changed etc.) — drop them
            try { sessionStorage.removeItem(SESSION_CRED_KEY); } catch { /* ignore */ }
            return false;
        } catch {
            return false;
        }
    }

    // Normalize one raw school-year object (varies per endpoint) into SchoolYear.
    // Handles both { dateRange: { start, end } } and { startDate, endDate } shapes.
    private parseSchoolYear(sy: any): SchoolYear | null {
        if (!sy || !sy.id) return null;
        const start = sy.dateRange?.start ?? sy.startDate ?? sy.start ?? null;
        const end = sy.dateRange?.end ?? sy.endDate ?? sy.end ?? null;
        if (!start || !end) return null;
        return { id: sy.id, name: sy.name ?? '', start, end };
    }

    // Fetch ALL available school years and store them, so every request can pick
    // the correct x-webuntis-api-school-year-id for any date. Called once after a
    // successful login.
    //
    // app/data only returns the *current* year, which is the previous academic
    // year while we plan the next one — that is why the klasgroep IDs were wrong.
    // We therefore query the dedicated /schoolyears endpoint (full list) first and
    // fall back to app/data only if it yields nothing.
    private async fetchSchoolYears(): Promise<void> {
        try {
            const years: SchoolYear[] = [];

            // 1. Dedicated list endpoint — returns every school year with its id.
            try {
                const listResp = await fetch(`${BASE_URL}/WebUntis/api/rest/view/v1/schoolyears`, {
                    method: 'GET',
                    headers: this.getHeaders(null),
                    credentials: 'include',
                });
                if (listResp.ok) {
                    const listData = await listResp.json().catch(() => null);
                    const arr: any[] = Array.isArray(listData)
                        ? listData
                        : (listData?.schoolYears ?? listData?.data ?? []);
                    for (const sy of arr) {
                        const parsed = this.parseSchoolYear(sy);
                        if (parsed && !years.find(y => y.id === parsed.id)) years.push(parsed);
                    }
                }
            } catch (e) {
                console.warn('[UntisService] /schoolyears endpoint failed:', e);
            }

            // 2. app/data — for the current-year marker, and as a fallback source.
            let currentId: number | null = null;
            try {
                const resp = await fetch(`${BASE_URL}/WebUntis/api/rest/view/v1/app/data`, {
                    method: 'GET',
                    headers: this.getHeaders(null),
                    credentials: 'include',
                });
                if (resp.ok) {
                    const data = await resp.json().catch(() => null);
                    if (data) {
                        const fallbackList: any[] = data.schoolYears ?? data.allSchoolYears ?? [];
                        for (const sy of fallbackList) {
                            const parsed = this.parseSchoolYear(sy);
                            if (parsed && !years.find(y => y.id === parsed.id)) years.push(parsed);
                        }
                        const cur = this.parseSchoolYear(data.currentSchoolYear);
                        if (cur) {
                            currentId = cur.id;
                            if (!years.find(y => y.id === cur.id)) years.push(cur);
                        }
                    }
                }
            } catch (e) {
                console.warn('[UntisService] app/data endpoint failed:', e);
            }

            // Manual override wins even if discovery returned nothing usable.
            if (PREFERRED_SCHOOL_YEAR_ID !== null) {
                this.schoolYears = years;
                this.activeSchoolYearId = PREFERRED_SCHOOL_YEAR_ID;
                const ov = years.find(y => y.id === PREFERRED_SCHOOL_YEAR_ID);
                console.log(
                    `[UntisService] Using manual school-year override id=${PREFERRED_SCHOOL_YEAR_ID}` +
                    (ov ? ` (${ov.name})` : ' (not in discovered list)')
                );
                return;
            }

            if (years.length === 0) {
                console.warn('[UntisService] No school years discovered — leaving school-year header unset.');
                return;
            }

            this.schoolYears = years;

            // Pick the default: preferred year by name, else the newest by start
            // date, else the API's current year.
            const preferred = years.find(y => y.name === PREFERRED_SCHOOL_YEAR_NAME);
            const newest = [...years].sort((a, b) => b.start.localeCompare(a.start))[0];
            this.activeSchoolYearId = (preferred ?? newest)?.id ?? currentId ?? null;

            const active = years.find(y => y.id === this.activeSchoolYearId);
            console.log(
                '[UntisService] School years loaded:',
                years.map(y => `${y.name}(id=${y.id}, ${y.start}->${y.end})`).join(', '),
                `— active: ${active ? `${active.name}(id=${active.id})` : this.activeSchoolYearId}`
            );
            if (!preferred) {
                console.warn(
                    `[UntisService] Preferred school year "${PREFERRED_SCHOOL_YEAR_NAME}" not found; ` +
                    `defaulting to ${active ? active.name : this.activeSchoolYearId}.`
                );
            }
        } catch (e) {
            console.warn('[UntisService] Could not fetch school years:', e);
        }
    }

    // Clear the authenticated session: in-memory token/credentials and the
    // credentials stashed in sessionStorage. After this the user is back to
    // square one and must log in again.
    logout(): void {
        this.bearerToken = null;
        this.sessionId = null;
        this.isAuthenticated = false;
        this.lastUsername = null;
        this.lastPassword = null;
        this.reAuthPromise = null;
        try { sessionStorage.removeItem(SESSION_CRED_KEY); } catch { /* ignore */ }
    }

    private async performLogin(username: string, password: string): Promise<{ success: boolean; error?: string; rawResponses?: any; exception?: any }> {
        try {
            const debugData: any = {};

            // Single server-side login round-trip. The worker performs
            // warmup -> j_spring_security_check -> token/new with a server-side
            // cookie jar, then returns the JWT plus the raw session cookie
            // string. This removes the dependency on the browser storing the
            // proxy's third-party cookie (the root cause of the "Ongeldige
            // logingegevens" failures on Safari and cookie-restricted Chrome).
            const params = new URLSearchParams();
            params.append('school', SCHOOL);
            params.append('j_username', username);
            params.append('j_password', password);
            params.append('token', '');

            const resp = await fetch(`${BASE_URL}/WebUntis/safari_login`, {
                method: 'POST',
                headers: {
                    'tenant-id': TENANT_ID,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: params.toString(),
            });

            debugData.loginRoute = { status: resp.status, ok: resp.ok };

            if (!resp.ok) {
                const txt = await resp.text().catch(() => '');
                debugData.loginRoute.body = txt.substring(0, 1000);
                return { success: false, error: `Login route failed: ${resp.status}`, rawResponses: debugData };
            }

            const data = await resp.json().catch(() => null);
            if (!data) {
                return { success: false, error: "Login route gaf geen geldige JSON terug.", rawResponses: debugData };
            }

            debugData.loginRoute.serverDebug = data.debug;
            const tokenBody: string = typeof data.tokenBody === 'string' ? data.tokenBody : '';
            debugData.loginRoute.bodySample = tokenBody.substring(0, 500);

            this.bearerToken = this.extractToken(tokenBody);
            this.sessionId = typeof data.sessionId === 'string' && data.sessionId.length > 0 ? data.sessionId : null;

            if (this.bearerToken && this.sessionId) {
                this.isAuthenticated = true;
                return { success: true };
            }

            console.error("Failed to parse token from response body:", tokenBody);
            return { success: false, error: "Ongeldige logingegevens (of API weigerde toegang).", rawResponses: debugData };
        } catch (e: any) {
            console.error("Login Exception Detail:", e);
            const msg = e instanceof Error ? e.message : JSON.stringify(e);
            return { success: false, error: msg || "Unknown error (empty)", exception: { name: e?.name, message: e?.message, stack: e?.stack } };
        }
    }

    private extractToken(body: string): string | null {
        if (!body) return null;
        try {
            const json = JSON.parse(body);
            // WebUntis typically returns { "access_token": "..." } or similar
            if (json && typeof json.token === 'string') return json.token;
            if (json && typeof json.access_token === 'string') return json.access_token;
            // Sometimes it's nested
            if (json && json.data && typeof json.data.token === 'string') return json.data.token;
        } catch {
            // Failed to parse JSON, probably HTML login page returned
        }

        // Only fallback to raw string if it looks like a clean JWT token (no HTML tags)
        const raw = body.trim();
        if (raw.split('.').length >= 3 && !raw.includes('<') && !raw.includes('\n')) {
            return raw;
        }

        return null; // Return null intentionally so login() fails gracefully
    }

    // Try to silently re-authenticate with the credentials cached in memory
    // from the last successful login(). Deduplicates concurrent attempts so
    // a burst of parallel requests only triggers one re-auth round-trip.
    private trySilentReAuth(): Promise<boolean> {
        if (!this.lastUsername || !this.lastPassword) return Promise.resolve(false);
        if (this.reAuthPromise) return this.reAuthPromise;

        console.log('[UntisService] Session expired — attempting silent re-auth');
        this.reAuthPromise = this.performLogin(this.lastUsername, this.lastPassword)
            .then(r => {
                if (r.success) console.log('[UntisService] Silent re-auth OK');
                else console.warn('[UntisService] Silent re-auth failed:', r.error);
                return r.success;
            })
            .catch(e => {
                console.warn('[UntisService] Silent re-auth threw:', e);
                return false;
            })
            .finally(() => { this.reAuthPromise = null; });
        return this.reAuthPromise;
    }

    // Generic fetch wrapper
    private async apiFetch<T>(endpoint: string, retried = false, schoolYearId?: number | null): Promise<T> {
        if (!this.isAuthenticated) {
            const reAuthed = await this.trySilentReAuth();
            if (!reAuthed) throw new Error("Not authenticated");
        }

        const url = `${BASE_URL}${endpoint}`;
        const headers = this.getHeaders(schoolYearId);

        console.log(`[UntisService] About to fetch URL:`, url);
        console.log(`[UntisService] With Headers:`, headers);

        try {
            const resp = await fetch(url, {
                method: 'GET',
                headers: headers,
                credentials: 'include' // Use token
            });

            if (!resp.ok) {
                if (resp.status === 401 || resp.status === 403) {
                    this.isAuthenticated = false;
                    this.bearerToken = null;
                    if (!retried) {
                        const reAuthed = await this.trySilentReAuth();
                        if (reAuthed) return this.apiFetch<T>(endpoint, true, schoolYearId);
                    }
                    throw new Error("Session expired");
                }
                throw new Error(`API Error: ${resp.status}`);
            }
            return resp.json();
        } catch (err: any) {
            console.error(`[UntisService] Fetch failed for ${url}`, err);
            throw err;
        }
    }

    /**
     * Probe whether the current account may use the Meeting Planner.
     *
     * The planner's first call is getTeachers() → the TEACHER timetable/filter
     * endpoint, which returns 403 FORBIDDEN for accounts without sufficient
     * rights (e.g. student logins). We probe that exact endpoint once and treat
     * a 403 as "no access". Network/other errors fall back to "available" so a
     * transient glitch never hides the planner from a teacher.
     *
     * Uses a raw fetch (not apiFetch) on purpose: apiFetch treats a 403 as a
     * session expiry and wipes the auth token, which would needlessly force a
     * re-auth for the (still perfectly valid) Traject Planner session.
     */
    async checkMeetingPlannerAccess(): Promise<boolean> {
        if (!this.isAuthenticated) {
            const reAuthed = await this.trySilentReAuth();
            if (!reAuthed) return false;
        }

        const start = new Date().toISOString().split('T')[0];
        const end = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
        const url = `${BASE_URL}/WebUntis/api/rest/view/v1/timetable/filter?start=${start}&end=${end}&resourceType=TEACHER&timetableType=STANDARD`;

        try {
            const resp = await fetch(url, {
                method: 'GET',
                headers: this.getHeaders(),
                credentials: 'include',
            });
            // 403 = authenticated but no rights on the teacher filter (student accounts).
            if (resp.status === 403) return false;
            return true;
        } catch {
            return true;
        }
    }

    // Resource Fetchers
    async getTeachers(): Promise<Teacher[]> {
        // The filter window must fall inside the active school year, otherwise
        // Untis returns the resource IDs of whatever year the dates land in.
        const { start, end } = this.resourceFilterWindow();
        const syId = this.activeSchoolYearId;

        const q = `/WebUntis/api/rest/view/v1/timetable/filter?start=${start}&end=${end}&resourceType=TEACHER&timetableType=STANDARD`;
        const data = await this.apiFetch<any>(q, false, syId);

        // Map DTO to domain
        return data.teachers.map((t: any) => ({
            id: t.teacher.id,
            shortName: t.teacher.shortName,
            longName: t.teacher.longName,
            displayName: t.teacher.displayName
        }));
    }

    async getClasses(): Promise<ClassGroup[]> {
        // See getTeachers: anchor the window inside the active school year so the
        // klasgroep IDs belong to the year we are planning, not the previous one.
        const { start, end } = this.resourceFilterWindow();
        const syId = this.activeSchoolYearId;

        const q = `/WebUntis/api/rest/view/v1/timetable/filter?start=${start}&end=${end}&resourceType=CLASS&timetableType=STANDARD`;
        const data = await this.apiFetch<any>(q, false, syId);

        return data.classes.map((c: any) => ({
            id: c.class.id,
            shortName: c.class.shortName,
            longName: c.class.longName,
            displayName: c.class.displayName
        }));
    }

    // Roster Fetcher
    async getRoster(resourceId: number, type: 'TEACHER' | 'CLASS', start: Date, end: Date): Promise<RosterEntry[]> {
        const s = start.toISOString().split('T')[0];
        const e = end.toISOString().split('T')[0];

        // MainAPI.cs: format=2
        const q = `/WebUntis/api/rest/view/v1/timetable/entries?start=${s}&end=${e}&format=2&resourceType=${type}&timetableType=STANDARD&resources=${resourceId}`;

        const syId = this.schoolYearIdForRange(start, end);
        const data = await this.apiFetch<any>(q, false, syId);

        // Map RosterData (data.days[].gridEntries[]) to RosterEntry[]
        if (!data || !data.days) {
            console.warn("Roster data missing days array", data);
            return [];
        }

        const entries: RosterEntry[] = [];

        for (const day of data.days) {
            const dateStr = day.date; // YYYY-MM-DD
            if (!day.gridEntries) continue;

            for (const ge of day.gridEntries) {
                if (!ge.duration || !ge.duration.start || !ge.duration.end) continue;

                // Log raw grid entry to discover available fields
                console.log('[UntisService] Raw gridEntry:', JSON.stringify(ge));

                let startTime = ge.duration.start;
                let endTime = ge.duration.end;

                // Check if start/end already contain date (e.g. 2023-10-27T10:00)
                if (!startTime.includes('T')) {
                    // If dateStr is YYYYMMDD (no dashes), add them
                    let isoDate = dateStr;
                    if (dateStr.length === 8 && !dateStr.includes('-')) {
                        isoDate = `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
                    }
                    startTime = `${isoDate}T${startTime}:00`;
                }

                if (!endTime.includes('T')) {
                    // repeat logic for end time safety, though usually consistent
                    let isoDate = dateStr;
                    if (dateStr.length === 8 && !dateStr.includes('-')) {
                        isoDate = `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
                    }
                    endTime = `${isoDate}T${endTime}:00`;
                }

                // Scan all position fields for SUBJECT, CLASS and INFO entries
                const subjects: string[] = [];
                const classNames: string[] = [];
                const infos: string[] = [];
                for (const posKey of ['position1', 'position2', 'position3', 'position4', 'position5']) {
                    const pos = ge[posKey];
                    if (!pos || !Array.isArray(pos)) continue;
                    for (const p of pos) {
                        if (p.current?.type === 'SUBJECT' && p.current.displayName) {
                            subjects.push(p.current.displayName);
                        }
                        if (p.current?.type === 'CLASS' && p.current.displayName) {
                            classNames.push(p.current.displayName);
                        }
                        if (p.current?.type === 'INFO' && p.current.displayName) {
                            infos.push(p.current.displayName);
                        }
                    }
                }

                const lessonText = subjects.join(', ') || ge.lessonText || undefined;
                const lessonInfo = classNames.length > 0
                    ? classNames.join(', ')
                    : ge.lessonInfo || undefined;
                const info = infos.length > 0 ? infos.join(', ') : undefined;

                entries.push({
                    id: ge.ids ? ge.ids[0] : 0, // Use first ID or 0
                    start: startTime,
                    end: endTime,
                    classes: [], // Detailed mapping omitted for now
                    teachers: [],
                    rooms: [],
                    subjects: [],
                    lessonText,
                    lessonInfo,
                    info,
                });
            }
        }

        return entries;
    }
}

export const untisService = new UntisService();
