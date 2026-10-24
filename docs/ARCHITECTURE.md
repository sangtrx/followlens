# Architecture and engineering choices

## Threat model

**Sensitive data:** follower/following usernames and relationship history, even though many Instagram profiles are public. **Avoided assets:** passwords, session cookies, CSRF tokens, private API routes and persistent access tokens.

The extension only accesses Instagram DOM after the user clicks its icon (`activeTab`) or explicitly enables optional `www.instagram.com` on-visit permission. It never issues its own Instagram fetch/XHR or stores network credentials. It does not send data to external servers.

## State machine

```text
IDLE -> PROFILE_VALIDATED -> FETCH_PREVIOUS -> FOLLOWERS_DIALOG
      -> COLLECT_UNTIL_STABLE_END -> EXACT_COUNT_CHECK
      -> [FULL_SCAN?] FOLLOWING_DIALOG -> COLLECT -> EXACT_COUNT_CHECK
      -> SERVERLESS_EXTENSION_SAVE -> SNAPSHOT_COMMITTED

Any failure -> STOP / OLD_HISTORY_PRESERVED
```

The label `EXACT_COUNT_CHECK` means **UI consistency**, not mathematically proven completeness. An approximate K/M count always fails the live-snapshot gate. A large (> max(5, 15%)) apparent loss also blocks automatic persistence until rechecked against exports.

## Data model

`records` object store keyed by auto-increment ID with secondary `by_owner` index. First scan and every 20th next scan are full checkpoints. Intermediate records store added/removed usernames as sorted arrays. Rehydration plays forward deltas and verifies each recorded list length. `following` object store caches one following snapshot per profile with its source and capture time.

Transactions write records and current Following atomically. History is append-only until users delete profile history. The UI reads all records for the chosen profile and reconstructs snapshots, so long histories cost proportional work; planned retention/compaction optimizations should preserve replayability.

## Security boundaries

- `capture.js` runs in the isolated content-script world. It reads rendered anchors from the currently opened dialog and scrolls the dialog element.
- `background.js` validates sender.tab URL matches the declared profile before accepting `SAVE_SCAN`.
- `core.js` validates the exact count and completion flags again before storing, and normalizes usernames.
- `db.js` persists to extension-origin IndexedDB. The content script does not own storage.
- `dashboard.js` constructs every result row via DOM text nodes. Usernames cannot become injected HTML.
- Optional Auto Watch is restricted to profiles whose manual scans have been saved; visit frequency is limited per profile.

## Failure handling

No backend, auth bridge or retries around Instagram checkpoints. A failed scan does not persist. The extension must never attempt CAPTCHA bypass, private endpoint fallback, or bulk follow/unfollow actions. A UI change should fail safely with a visible error.

## Known technical gaps

- No stable numeric Instagram account IDs from public DOM. Changes to username may appear as missing/new.
- No strong consistency guarantee for highly dynamic follower lists changing during scans.
- No live-account integration suite; browser smoke tests use locally generated virtualized dialogs.
- No signed Chrome Web Store release or claim of Meta authorization.
- Current `watch.js` is initialized on full document navigation; single-page transitions may not trigger it.
