# Architecture and engineering choices

## Threat model

**Sensitive data:** follower/following usernames and relationship history, even though many Instagram profiles are public. **Avoided assets:** passwords, extracted cookies, CSRF tokens, persistent access tokens and third-party servers.

The extension only accesses Instagram DOM after the user clicks its icon (`activeTab`) or explicitly enables optional `www.instagram.com` on-visit permission. DOM mode does not issue fetch/XHR. Experimental Fast mode performs same-origin read-only GET requests with the browser-managed session and no cookie extraction. It does not send data to external servers.

## State machine

```text
IDLE -> PROFILE_VALIDATED -> FETCH_PREVIOUS -> FOLLOWERS_DIALOG
      -> COLLECT_UNTIL_STABLE_END -> EXACT_COUNT_CHECK
      -> [FULL_SCAN?] FOLLOWING_DIALOG -> COLLECT -> EXACT_COUNT_CHECK
      -> SERVERLESS_EXTENSION_SAVE -> SNAPSHOT_COMMITTED

Any failure -> STOP / OLD_HISTORY_PRESERVED

Fast mode: PANEL -> USER_CHECKBOX -> MANUAL_CLICK -> COOLDOWN_RESERVATION
        -> PROFILE_ID -> FOLLOWER_PAGES -> [FOLLOWING_IF_NEEDED]
        -> EXACT_COUNT_CHECK -> SNAPSHOT_COMMIT

Fast mode never runs via Auto Watch and never opens or scrolls a dialog.
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
- Optional Auto Watch is restricted to saved profiles, and always triggers DOM mode, never private API mode.

## Failure handling

No backend, auth bridge or retries around Instagram checkpoints. Fast API requests require a separate opt-in and are never an automatic DOM fallback. No CAPTCHA bypass, proxies, limit evasion, or follow/unfollow actions. A UI change should fail safely with a visible error.

## Known technical gaps

- No stable numeric Instagram account IDs from public DOM. Changes to username may appear as missing/new.
- No strong consistency guarantee for highly dynamic follower lists changing during scans.
- No live-account integration suite; browser smoke tests use locally generated virtualized dialogs.
- No signed Chrome Web Store release or claim of Meta authorization.
- Current `watch.js` is initialized on full document navigation; single-page transitions may not trigger it.
