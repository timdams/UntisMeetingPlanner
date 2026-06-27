// CORS headers reused by every response. We must echo the exact Origin back
// (not '*') because the frontend uses credentialed/custom-header requests.
function corsHeaders(reqOrigin) {
    return {
        'Access-Control-Allow-Origin': reqOrigin || '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, tenant-id, x-untis-session, x-webuntis-api-school-year-id',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400',
    };
}

// Read individual Set-Cookie values from a response. getSetCookie() returns
// them un-merged; fall back to a comma-split that ignores commas inside
// Expires=... dates for older runtimes.
function getSetCookies(resp) {
    if (typeof resp.headers.getSetCookie === 'function') {
        return resp.headers.getSetCookie();
    }
    const raw = resp.headers.get('set-cookie');
    return raw ? raw.split(/,(?=\s*[a-zA-Z0-9_-]+\s*=)/) : [];
}

// Merge Set-Cookie values into a name->value jar (last write wins).
function mergeCookies(jar, setCookieArray) {
    for (const sc of setCookieArray) {
        const pair = sc.split(';')[0].trim();
        const eq = pair.indexOf('=');
        if (eq <= 0) continue;
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        if (name) jar.set(name, value);
    }
}

function jarToHeader(jar) {
    return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

// Server-side login that bypasses the browser cookie jar entirely.
// The browser refuses to store the proxy's third-party JSESSIONID cookie
// (Safari ITP, Chrome 3rd-party-cookie blocking, managed-Chrome policy, or a
// timing race between the two fetches), which left /api/token/new
// unauthenticated and returning the HTML app shell instead of a JWT.
//
// Here the worker performs warmup -> j_spring_security_check -> token/new
// itself, keeping the session cookies in a server-side jar, and hands the
// frontend back the token plus the raw cookie string. The frontend then
// replays that string on every request via the x-untis-session header.
async function handleSafariLogin(request, reqOrigin) {
    const tenantId = request.headers.get('tenant-id') || '';
    const userAgent = request.headers.get('User-Agent') || 'Mozilla/5.0';
    const jar = new Map();
    const debug = {};

    try {
        const bodyText = await request.text(); // school, j_username, j_password, token
        const school = new URLSearchParams(bodyText).get('school') || 'ap';

        // 1. Warmup: establish the initial session cookie.
        const warm = await fetch(`https://ap.webuntis.com/WebUntis/?school=${encodeURIComponent(school)}`, {
            method: 'GET',
            headers: { 'tenant-id': tenantId, 'User-Agent': userAgent },
            redirect: 'manual',
        });
        mergeCookies(jar, getSetCookies(warm));
        debug.warmupStatus = warm.status;

        // 2. Login: posts credentials, rotates the session id (session fixation
        //    protection) -> capture the post-auth cookies from the 302.
        const loginResp = await fetch('https://ap.webuntis.com/WebUntis/j_spring_security_check', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'tenant-id': tenantId,
                'User-Agent': userAgent,
                'Cookie': jarToHeader(jar),
            },
            body: bodyText,
            redirect: 'manual',
        });
        mergeCookies(jar, getSetCookies(loginResp));
        debug.loginStatus = loginResp.status;
        debug.loginLocation = loginResp.headers.get('location') || '';

        // 3. Token: now authenticated, fetch the JWT.
        const tokenResp = await fetch('https://ap.webuntis.com/WebUntis/api/token/new', {
            method: 'GET',
            headers: {
                'tenant-id': tenantId,
                'User-Agent': userAgent,
                'Cookie': jarToHeader(jar),
            },
            redirect: 'manual',
        });
        const tokenBody = await tokenResp.text();
        debug.tokenStatus = tokenResp.status;

        return new Response(JSON.stringify({
            tokenBody,
            sessionId: jarToHeader(jar),
            debug,
        }), {
            status: 200,
            headers: { ...corsHeaders(reqOrigin), 'Content-Type': 'application/json' },
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: String((e && e.message) || e), debug }), {
            status: 500,
            headers: { ...corsHeaders(reqOrigin), 'Content-Type': 'application/json' },
        });
    }
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // We only proxy requests starting with /WebUntis
        if (!url.pathname.startsWith('/WebUntis')) {
            return new Response('Not Found', { status: 404 });
        }

        const reqOrigin = request.headers.get('Origin');

        // Handle CORS preflight requests
        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: corsHeaders(reqOrigin) });
        }

        // Cookie-jar-free login route (see handleSafariLogin).
        if (url.pathname === '/WebUntis/safari_login' && request.method === 'POST') {
            return handleSafariLogin(request, reqOrigin);
        }

        // Forward to the real untis server
        const targetUrl = new URL(request.url);
        targetUrl.hostname = 'ap.webuntis.com';
        targetUrl.port = '443';
        targetUrl.protocol = 'https:';

        // Build upstream headers. If the frontend supplied a session via the
        // x-untis-session header, translate it into the Cookie the upstream
        // expects (this is what replaces the blocked browser cookie).
        const upstreamHeaders = new Headers(request.headers);
        const session = upstreamHeaders.get('x-untis-session');
        if (session) {
            upstreamHeaders.set('Cookie', session);
        }
        upstreamHeaders.delete('x-untis-session');
        upstreamHeaders.delete('host'); // let fetch derive Host from the target URL

        const isBodyless = request.method === 'GET' || request.method === 'HEAD';
        const newRequest = new Request(targetUrl.toString(), {
            method: request.method,
            headers: upstreamHeaders,
            body: isBodyless ? undefined : request.body,
            redirect: 'follow',
        });

        // Fetch from Untis
        let response = await fetch(newRequest);

        // Create new headers from the response
        const newHeaders = new Headers(response.headers);

        // Ensure we allow CORS for the browser to read the response
        newHeaders.set('Access-Control-Allow-Origin', reqOrigin || '*');
        newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, tenant-id, x-untis-session');
        newHeaders.set('Access-Control-Allow-Credentials', 'true'); // Required for cookies

        // Cloudflare Workers merge multiple Set-Cookie headers.
        // We have to split them and rewrite them individually.
        const setCookies = getSetCookies(response);
        if (setCookies.length > 0) {
            newHeaders.delete('Set-Cookie'); // Remove the merged one

            for (let cookie of setCookies) {
                // Strip existing Domain, Secure, SameSite if present
                cookie = cookie.replace(/domain=[^;]+;?/gi, '');
                cookie = cookie.replace(/secure;?/gi, '');
                cookie = cookie.replace(/samesite=[^;]+;?/gi, '');

                // Add SameSite=None; Secure
                cookie = cookie.trim();
                if (cookie.length > 0) {
                    if (!cookie.endsWith(';')) cookie += ';';
                    cookie += ' SameSite=None; Secure;';
                    newHeaders.append('Set-Cookie', cookie);
                }
            }
        }

        // Deal with Redirects (302) mapping back to proxy instead of untis directly
        if (response.status >= 300 && response.status < 400) {
            const location = newHeaders.get('location');
            if (location && location.includes('ap.webuntis.com')) {
                newHeaders.set('location', location.replace('https://ap.webuntis.com', url.origin));
            }
        }

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders
        });
    },
};
