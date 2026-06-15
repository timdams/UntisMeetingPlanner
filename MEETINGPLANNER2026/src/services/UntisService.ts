import { Teacher, ClassGroup, RosterEntry } from '../types';

// Temporarily pointing to local development proxy or final Cloudflare worker
// In a real scenario, this would be an environment variable
const BASE_URL = 'https://untis-proxy.untisproxydams.workers.dev'; // Removed /WebUntis as it's appended in the fetch calls
const TENANT_ID = '3257400';
const SCHOOL = 'ap';

const SESSION_CRED_KEY = 'untis_session_creds';

class UntisService {
    private bearerToken: string | null = null;
    private isAuthenticated = false;
    private lastUsername: string | null = null;
    private lastPassword: string | null = null;
    private reAuthPromise: Promise<boolean> | null = null;

    // Helper to build headers
    private getHeaders() {
        const headers: Record<string, string> = {
            'tenant-id': TENANT_ID,
            // 'Content-Type': 'application/json', // Not always needed, fetch sets it for JSON
        };
        if (this.bearerToken) {
            headers['Authorization'] = `Bearer ${String(this.bearerToken).trim()}`;
        }
        return headers;
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
                return true;
            }
            // Stored creds no longer valid (password changed etc.) — drop them
            try { sessionStorage.removeItem(SESSION_CRED_KEY); } catch { /* ignore */ }
            return false;
        } catch {
            return false;
        }
    }

    // Clear the authenticated session: in-memory token/credentials and the
    // credentials stashed in sessionStorage. After this the user is back to
    // square one and must log in again.
    logout(): void {
        this.bearerToken = null;
        this.isAuthenticated = false;
        this.lastUsername = null;
        this.lastPassword = null;
        this.reAuthPromise = null;
        try { sessionStorage.removeItem(SESSION_CRED_KEY); } catch { /* ignore */ }
    }

    private async performLogin(username: string, password: string): Promise<{ success: boolean; error?: string; rawResponses?: any; exception?: any }> {
        try {
            const debugData: any = {};

            // 1. Warmup
            try {
                const w = await fetch(`${BASE_URL}/WebUntis/?school=${SCHOOL}`, {
                    method: 'GET',
                    headers: { 'tenant-id': TENANT_ID }
                });
                debugData.warmup = { status: w.status, ok: w.ok };
            } catch (e) {
                console.warn("Warmup failed:", e);
                debugData.warmup = { error: e instanceof Error ? e.message : 'Unknown warmup error' };
            }

            // 2. Login POST (application/x-www-form-urlencoded)
            const params = new URLSearchParams();
            params.append('school', SCHOOL);
            params.append('j_username', username);
            params.append('j_password', password);
            params.append('token', '');

            const loginResp = await fetch(`${BASE_URL}/WebUntis/j_spring_security_check`, {
                method: 'POST',
                headers: {
                    'tenant-id': TENANT_ID,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: params.toString(),
                credentials: 'include' // THIS WAS OMIT! Browser wouldn't save the login cookie!
            });

            debugData.loginResp = { status: loginResp.status, ok: loginResp.ok, redirected: loginResp.redirected, url: loginResp.url };
            if (!loginResp.ok) {
                console.warn("Login POST status:", loginResp.status);
            }

            // 3. Get Token using the established session cookie
            const tokenResp = await fetch(`${BASE_URL}/WebUntis/api/token/new`, {
                method: 'GET',
                headers: { 'tenant-id': TENANT_ID },
                credentials: 'include' // The proxy needs to handle cookie passing if we use omit, or we use 'include' if proxy forwards it
            });

            debugData.tokenResp = { status: tokenResp.status, ok: tokenResp.ok };
            if (!tokenResp.ok) {
                const txt = await tokenResp.text().catch(() => '');
                debugData.tokenResp.body = txt.substring(0, 1000); // Only capture partial if it's huge
                return { success: false, error: `Token fetch failed: ${tokenResp.status}`, rawResponses: debugData };
            }

            const body = await tokenResp.text();
            debugData.tokenResp.bodySample = body.substring(0, 500);
            this.bearerToken = this.extractToken(body);

            if (this.bearerToken) {
                this.isAuthenticated = true;
                return { success: true };
            }

            console.error("Failed to parse token from response body:", body);
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
    private async apiFetch<T>(endpoint: string, retried = false): Promise<T> {
        if (!this.isAuthenticated) {
            const reAuthed = await this.trySilentReAuth();
            if (!reAuthed) throw new Error("Not authenticated");
        }

        const url = `${BASE_URL}${endpoint}`;
        const headers = this.getHeaders();

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
                        if (reAuthed) return this.apiFetch<T>(endpoint, true);
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
        // Corresponds to ResourceRequest(ResourceType.TEACHER)
        // Need to check exact endpoint/response structure from C# DTOs
        // Based on MainAPI.cs, it calls /WebUntis/api/rest/view/v1/timetable/filter
        const start = new Date().toISOString().split('T')[0];
        const end = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

        // resourceType: TEACHER (likely enum value? MainAPI says ResourceType.TEACHER)
        // Checking MainAPI.cs: enum ResourceType { ROOM, TEACHER, CLASS, SUBJECT }
        // Default C# enums start at 0? Need to verify untis expected values. 
        // Usually Untis uses: CLASS=1, TEACHER=2, SUBJECT=3, ROOM=4
        // But MainAPI.cs defines enum ResourceType { ROOM, TEACHER, CLASS, SUBJECT } 
        // If it sends name, it's string. If int, it sends 0,1,2...
        // MainAPI.cs: ResourceRequest(ResourceType.TEACHER).ToQueryString() -> &resourceType=TEACHER (string)

        const q = `/WebUntis/api/rest/view/v1/timetable/filter?start=${start}&end=${end}&resourceType=TEACHER&timetableType=STANDARD`;
        const data = await this.apiFetch<any>(q);

        // Map DTO to domain
        return data.teachers.map((t: any) => ({
            id: t.teacher.id,
            shortName: t.teacher.shortName,
            longName: t.teacher.longName,
            displayName: t.teacher.displayName
        }));
    }

    async getClasses(): Promise<ClassGroup[]> {
        const start = new Date().toISOString().split('T')[0];
        const end = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
        const q = `/WebUntis/api/rest/view/v1/timetable/filter?start=${start}&end=${end}&resourceType=CLASS&timetableType=STANDARD`;
        const data = await this.apiFetch<any>(q);

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

        const data = await this.apiFetch<any>(q);

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
