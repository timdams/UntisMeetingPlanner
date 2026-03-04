# Safari Login Fix (ITP Bypass)

The Safari login issue ("Failed to parse token from response body") occurs because Safari's Intelligent Tracking Prevention (ITP) strongly blocks third-party cookies. The proxy worker (`untis-proxy.untisproxydams.workers.dev`) attempts to set a cookie (`JSESSIONID`) on the client, which Safari blocks. Since the cookie is missing, the subsequent request to `/api/token/new` is unauthenticated and WebUntis returns its HTML login page instead of the JWT token.

## Proposed Changes

We will bypass the browser's cookie mechanism entirely by having the frontend store the session ID in memory and send it via a custom header (`X-Untis-Session`), which the Cloudflare proxy will translate into a `Cookie` header for WebUntis.

### Component 1: Cloudflare Worker ([cloudflare-worker/src/index.js](file:///c:/Users/damst/Koofr/PROGPROJECTS/UntisMeetingPlanner.WEB2026/MEETINGPLANNER2026/cloudflare-worker/src/index.js))
- [MODIFY] [cloudflare-worker/src/index.js](file:///c:/Users/damst/Koofr/PROGPROJECTS/UntisMeetingPlanner.WEB2026/MEETINGPLANNER2026/cloudflare-worker/src/index.js)
  - In `OPTIONS` preflight handling, add `x-untis-session` to `Access-Control-Allow-Headers`.
  - Add a custom route interceptor for `POST /WebUntis/safari_login`:
    - The worker will receive the username, password, and school as URLSearchParams.
    - It will `POST` to `https://ap.webuntis.com/WebUntis/j_spring_security_check`.
    - It will extract the `Set-Cookie` header from the response.
    - It will `GET` `https://ap.webuntis.com/WebUntis/api/token/new` using that `Set-Cookie`.
    - It will return a JSON response containing `tokenBody` (the token string) and `sessionId` (the raw string of the WebUntis cookies).
  - For all other requests, check if the `x-untis-session` header is present. If it is, inject a `Cookie` header with its value for the upstream WebUntis request.

### Component 2: Frontend Service ([MEETINGPLANNER2026/src/services/UntisService.ts](file:///c:/Users/damst/Koofr/PROGPROJECTS/UntisMeetingPlanner/MEETINGPLANNER2026/src/services/UntisService.ts))
- [MODIFY] [MEETINGPLANNER2026/src/services/UntisService.ts](file:///c:/Users/damst/Koofr/PROGPROJECTS/UntisMeetingPlanner/MEETINGPLANNER2026/src/services/UntisService.ts)
  - Add `private sessionId: string | null = null;` to the class.
  - Modify [login()](file:///c:/Users/damst/Koofr/PROGPROJECTS/UntisMeetingPlanner/MEETINGPLANNER2026/src/services/UntisService.ts#25-85) to perform a single `POST` request to `/WebUntis/safari_login` instead of the two separate requests.
  - Parse the JSON response, extract the `tokenBody` and `sessionId`, and save them.
  - In [apiFetch()](file:///c:/Users/damst/Koofr/PROGPROJECTS/UntisMeetingPlanner/MEETINGPLANNER2026/src/services/UntisService.ts#108-139), add `'x-untis-session': this.sessionId || ''` to the request headers.
  - `credentials: 'include'` can remain, but it will no longer be the sole mechanism relying on browser cookies.

## Verification Plan

### Manual Verification
1. Open the application in **Safari** on macOS or iOS (or simulate it through ITP settings on another browser).
2. Attempt to login with valid credentials.
3. Verify that the login succeeds.
4. Verify that data (e.g., classes, teachers) is correctly retrieved on the subsequent API calls, confirming that the Cloudflare Worker correctly forwards the injected `x-untis-session` as a `Cookie`.
