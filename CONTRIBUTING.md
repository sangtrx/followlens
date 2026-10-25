# Contributing

Small, readable contributions are welcome. Use vanilla JavaScript and Chrome Manifest V3. Prefer explicit failure over silently incomplete snapshots.

Before a pull request:

1. Run `npm run check`.
2. Run `python tests/auto-scan-smoke.py` if you change the collector.
3. Describe which Instagram DOM shape you tested and whether you used a mock or a real profile.
4. Never include your Instagram session, follower exports, private screenshots, browser tokens, or profile-specific datasets.
5. Keep optional permissions optional, data local, and all network calls to Instagram under the user's own UI interactions.

Any private-API change must remain manually opted-in, read-only and bounded. CAPTCHA bypass, proxy evasion, rate-limit retries and automatic follow/unfollow remain outside the security model.
