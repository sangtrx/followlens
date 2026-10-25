# Security policy

FollowLens is local-only and not affiliated with Instagram or Meta. No third-party servers, analytics or telemetry. Unsupported Instagram GET endpoints are used only after explicit Fast API opt-in, never by Auto Watch.

## Reporting

Please open a GitHub issue for non-sensitive defects. For a security vulnerability, use the repository's private vulnerability reporting feature if it is enabled, or contact the maintainer through GitHub without posting sensitive tokens, cookies, screenshots of private data or raw exports.

## User guidance

- Install from the source repository you trust. Inspect the code before enabling optional site access.
- FollowLens does **not** ask for your Instagram password, 2FA code, or browser session cookies.
- Do not enable automation if Instagram displays a challenge or rate-limit warning. Fast API stops immediately on rate limit, auth/checkpoint or redirects.
- Never upload follower ZIP exports to a public issue.
- Turn off Auto Watch and remove local history in Dashboard when you no longer need it.

No tool can guarantee Instagram account safety against platform abuse detection.

## Experimental API limitations

Fast API uses browser-managed same-origin login cookies implicitly, without reading, exporting or storing them. It is not Meta-approved, can break without notice and may lead to account restrictions. Consent resets each panel session. The result is a point-in-time list, not a realtime unfollow event. Official export remains the safest way to avoid automated collection.
