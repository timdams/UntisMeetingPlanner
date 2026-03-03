export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // We only proxy requests starting with /WebUntis
        if (!url.pathname.startsWith('/WebUntis')) {
            return new Response('Not Found', { status: 404 });
        }

        // Handle CORS preflight requests
        if (request.method === "OPTIONS") {
            let response = new Response(null, { status: 204 });

            // Browsers reject '*' for Allow-Origin if credentials are 'include'. 
            // We must echo the exact Origin back.
            const reqOrigin = request.headers.get('Origin');
            response.headers.set('Access-Control-Allow-Origin', reqOrigin ? reqOrigin : '*');
            response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, tenant-id');
            response.headers.set('Access-Control-Allow-Credentials', 'true');
            response.headers.set('Access-Control-Max-Age', '86400');
            return response;
        }

        // Forward to the real untis server
        const targetUrl = new URL(request.url);
        targetUrl.hostname = 'ap.webuntis.com';
        targetUrl.port = '443';
        targetUrl.protocol = 'https:';

        // Create a new request based on the original
        const newRequest = new Request(targetUrl.toString(), request);

        // Fetch from Untis
        let response = await fetch(newRequest);

        // Create new headers from the response
        const newHeaders = new Headers(response.headers);

        // Ensure we allow CORS for the browser to read the response
        newHeaders.set('Access-Control-Allow-Origin', request.headers.get('Origin') || '*');
        newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, tenant-id');
        newHeaders.set('Access-Control-Allow-Credentials', 'true'); // Required for cookies

        // Cloudflare Workers merge multiple Set-Cookie headers. 
        // We have to split them and rewrite them individually.
        const setCookieString = response.headers.get('Set-Cookie');
        if (setCookieString) {
            newHeaders.delete('Set-Cookie'); // Remove the merged one

            // Note: properly splitting Set-Cookie in JS can be tricky because
            // dates in Expires=... contain commas.
            // A common workaround is to split by ', ' but look ahead for a cookie name
            const cookies = setCookieString.split(/,(?=\s*[a-zA-Z0-9_-]+\s*=)/);

            for (let cookie of cookies) {
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
