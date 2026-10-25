# Changelog

## v2.1.0 (2026-10-25) - Experimental no-scroll Fast API Scan

- Explicit consent required every panel session, no dialog scrolling.
- Read-only same-origin undocumented REST endpoints with browser-managed session.
- Pacing, per-profile cooldown, hard page/size limits and no retries.
- Strict fail-closed behavior on rate limits, auth errors, checkpoint, malformed pages and count mismatch.
- DOM Scan, DOM-only Auto Watch, official JSON/ZIP import preserved.
- Unit and mocked browser tests, no live Instagram session tested.


## v2.0.3 (2026-10-24) - Adaptive DOM scan pacing

- Fix visible-window versus cumulative-total comparison, which forced nearly every scroll to wait through a timeout.
- Use a guarded 340 ms minimum interval when new rows render, with a longer adaptive wait when Instagram stalls.
- Cache active scroll container, retain overlapping viewports, verify exact counts, and refuse incomplete snapshots.
- Add large virtualized-list and incomplete-data smoke scenarios.

## v2.0.2 (2026-10-24)

- Recognize Instagram profile statistics rendered as clickable list items, spans, buttons, or links.
- Retry up to three DOM click targets if the first target does not open a dialog, without private API requests.
- Avoid mixing the posts count with follower counts, and continue to reject incomplete snapshots.
- Add screenshot-style Chromium smoke fixtures for text-only statistics, nested click handlers, and formatted counts.

## v2.0.1 (2026-10-24)

- Remove profile from optional Auto Watch eligibility when its history is deleted.

## v2.0.0 (2026-10-24)

- First open-source release.
