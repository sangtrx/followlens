# FollowLens

**A privacy-first, open-source Instagram follow tracker for Chrome.**

FollowLens helps you answer three practical questions:

- Who do I follow who does not follow me back?
- Which accounts disappeared from my follower list between two snapshots?
- How did the list change over time?

It works locally inside your browser. No backend, analytics, proxy, credential collection, or calls to Instagram's private API.

> **Important:** An account missing from a newer list does **not** prove it unfollowed you. Username changes, deactivation, blocks, incomplete results and changes in Instagram's UI can produce apparent losses. FollowLens reports *possible changes*, never definitive unfollow events. Scanning by scrolling Instagram's interface may violate Instagram's terms and can carry account restrictions. It is not guaranteed safe.

## Features

- **One-click Smart Scan:** first scan collects Followers and Following; later scans update Followers only.
- **Full Scan:** refresh both lists on demand to avoid stale Following data.
- **Optional Auto Watch:** with explicit additional site permission, attempts a scan when you visit a previously scanned profile (no more than once per 24 hours per profile). Not 24/7 monitoring.
- **Evidence-aware persistence:** will not save if it cannot reach the end *and* match an **exact** displayed count, or if a large unexpected loss triggers a safety gate. This is a consistency check, not independent proof of completeness.
- **Local history:** IndexedDB checkpoint every 20 scans with compact deltas between them.
- **Multi-profile isolation:** separate histories for each username.
- **Relationship explorer:** nonmutual followers, missing/new accounts, mutuals, search, CSV export.
- **Official data export fallback:** imports Instagram Followers/Following ZIP or JSON, labeled as unverified because exported lists can also be incomplete.
- **No bulk follow/unfollow functionality** and no background hidden requests.

## Installation

1. Download or clone this repository.
2. Open `chrome://extensions`, enable **Developer mode**.
3. Choose **Load unpacked** and select the repository's **`extension/`** directory.
4. Open `https://www.instagram.com/YOUR_USERNAME/` while signed in.
5. Click the FollowLens toolbar icon once to start scanning. The on-page panel shows progress and a **Stop** button.
6. Open **Dashboard** from the panel to inspect relationships and timeline.

The first Smart Scan opens and scrolls both Instagram lists on your behalf. Later Smart Scans scan only Followers; press **Full Scan** when you want the Following list refreshed. The scan works only when Instagram renders the expected dialogs; layout changes can require updates.

To import official archives instead, open the dashboard, enter the correct username, and import exports **oldest first**. ZIP parsing remains local. Do not combine separate accounts or unrelated time ranges.

## Architecture

```text
Chrome action (activeTab)                  Optional on-visit watch (site permission)
               |                                            |
               v                                            v
     capture.js in Instagram tab  <------------------ watch.js
       | scrolls *visible UI*, no fetch/XHR
       | collects usernames + exact displayed counts
       v
     background.js (validates origin + payload)
       |  FollowLensCore.validateScan
       v
     IndexedDB (extension origin)
       |  full checkpoint / delta history / cached Following
       v
     dashboard.html + dashboard.js
       |  diff, filter, CSV, official export import
       v
     Everything remains on the user's machine
```

See [Architecture](docs/ARCHITECTURE.md), [Security & Privacy](SECURITY.md), and [Contributing](CONTRIBUTING.md).

## Quality gates

- Strict exact-count and stable scroll-end check before each live snapshot (not proof of perfect coverage).
- Partial scans, UI breakage, login checkpoints and very large losses cannot replace healthy history.
- No authentication tokens, Instagram cookies, private endpoints, external trackers or dependency downloads at runtime.
- Isolated data stores per username, with user-controlled deletion.
- `npm run check` verifies syntax and 11 pure unit cases. `python tests/auto-scan-smoke.py` covers 3 mocked Chromium auto-scan scenarios.

The tests **do not** demonstrate compatibility with every live Instagram account, UI language or follower size. The project has not been benchmarked against a real account in this environment.

## Development

Requires Node.js 20+ for tests; Chromium and `playwright` Python package for browser integration smoke tests.

```bash
npm run check
python tests/auto-scan-smoke.py
```

No build step or `npm install` is required to load the extension. It uses Chrome Manifest V3 and vanilla JavaScript. No bundled minified dependencies.

## Risk and limitations

1. **No realtime unfollow events.** Instagram does not provide an official public personal-account API for individual follower changes. FollowLens compares point-in-time lists when scans occur.
2. **No guarantee of account safety.** Even visible DOM auto-scrolling can be considered automated data collection by Instagram. Use your judgment and stop if challenged.
3. **Exact counts are not an integrity proof.** A changed or virtualized UI can skip members while showing the same count. Cross-check consequential changes against an official export.
4. **Usernames are not stable IDs.** Username changes can appear as a missing user plus a new user. FollowLens does not claim identity resolution.
5. **Small/private/unavailable profiles.** Scanning may be refused when exact counts are not exposed, a list is empty, or the dialog cannot be recognized.
6. **Following freshness.** Incremental scans compare new Followers with cached Following. The dashboard displays when Following was captured.
7. **Auto Watch is visit-triggered only.** Chrome can suspend extension workers, and the content-script trigger is not guaranteed for all single-page-app navigations.
8. **Local privacy.** Anyone who has access to your Chrome profile could access extension data. Delete its records from dashboard when no longer needed.

## License

MIT © 2026 Sang Truong ([@sangtrx](https://github.com/sangtrx)). Unofficial community project. Not affiliated with Meta or Instagram.
