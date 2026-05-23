// AniList GraphQL client + rate-limit gate.
// Module-level state (`rateLimitedUntil`) is intentionally process-global so a
// 429 hit in any one fetch site (polling loop, /track, /stats, /serverstats)
// short-circuits all other sites until the reset window passes.

let rateLimitedUntil = 0;

/**
 * Marker error so callers can distinguish "AniList told us to wait" from
 * generic network failures and respond with a friendly retry hint.
 */
class RateLimitError extends Error {
    constructor(retryAfterMs) {
        super(`AniList rate-limited for another ~${Math.ceil(retryAfterMs / 1000)}s`);
        this.name = "RateLimitError";
        this.retryAfterMs = retryAfterMs;
    }
}

/**
 * Returns the remaining rate-limit window in ms, or 0 if not currently limited.
 * Useful for code paths that don't catch RateLimitError directly (e.g. a
 * Promise.all that swallows per-promise rejections) and need to ask out-of-band
 * whether the gate is active.
 */
function getRateLimitRemainingMs() {
    return Math.max(0, rateLimitedUntil - Date.now());
}

/**
 * POST a GraphQL query to AniList with rate-limit awareness.
 * Throws RateLimitError when we know we'd be denied (gate is active, or
 * the response itself returns 429). On success returns the parsed JSON.
 *
 * AniList's per-IP limit is 90 requests/minute and is communicated via
 * `X-RateLimit-Remaining` / `X-RateLimit-Reset` headers.
 */
async function aniListFetch(query, variables) {
    const remainingMs = getRateLimitRemainingMs();
    if (remainingMs > 0) {
        throw new RateLimitError(remainingMs);
    }

    const response = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify({ query, variables }),
    });

    const remainingHeader = response.headers.get("x-ratelimit-remaining");
    const remaining = remainingHeader != null ? parseInt(remainingHeader, 10) : NaN;
    if (Number.isFinite(remaining) && remaining < 10) {
        console.warn(`⚠️ AniList rate limit low: ${remaining} requests remaining.`);
    }

    if (response.status === 429) {
        const resetSec = parseInt(response.headers.get("x-ratelimit-reset") ?? "0", 10);
        rateLimitedUntil = Number.isFinite(resetSec) && resetSec > 0
            ? resetSec * 1000
            : Date.now() + 60_000;
        const waitMs = rateLimitedUntil - Date.now();
        console.warn(`⚠️ AniList returned 429. Backing off for ~${Math.ceil(waitMs / 1000)}s.`);
        throw new RateLimitError(waitMs);
    }

    return response.json();
}

module.exports = { aniListFetch, RateLimitError, getRateLimitRemainingMs };
