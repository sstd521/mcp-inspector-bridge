# Remaining Inspector diagnostics implementation plan

Goal: complete the four user-approved diagnostic gaps in the installed bridge and installed Game Agent without editing game assets.
Architecture: reuse picker geometry and render debugger hooks. Add bounded one-shot node-event observation (50–1500 ms) and render capture (50–1000 ms), cleanup on completion/cancel/navigation/scene changes; return explicit limitations, never claim geometric hits are actual input recipients. White-listed environment and targeted read-only storage queries. Game Agent retains authentication, project identity, argument validation and sensitive-output limits.
Stack: existing TS/JS, Cocos 2.4 APIs, Node assert; no added dependency.

- [x] Probe node trace: failing listener cleanup/stack/bounds/scene-change tests, then implement src/probe/node-trace.ts; no persistent debugger breakpoints.
- [x] Picker: refactor shared traversal for multiple candidates, keep existing first-hit users compatible; test overlap/camera/bounds.
- [x] Render/environment: reuse existing render hooks, fix necessary restoration, add bounded summaries and safe environment/storage reads; test lifecycle/redaction/unavailable paths.
- [x] Bridge integration: init modules, typed schemas, fixed-method panel IPC, observation owner cancellation in router and panel lifecycle; actual handler tests.
- [x] Installed Game Agent: schemas/routes/exact args/response validation and owner cancellation; executor tests.
- [x] Run bridge full build/tests, GA focused tests, inspect all changes, copy only changed files after baseline checks, run full installed suites.
- [ ] Authenticated editor validation for exact project/version/PID. Reload installed packages if available, exercise read diagnostics without game edits. Report exact missing runtime evidence if UI unavailable.
- [x] Update audit and durable Obsidian progress; preserve unrelated dirty files/index, no Git commit.

User approved continuing all four gaps. Short observation windows intentionally replace persistent start/read/stop sessions: bounded lifetime, no stale tracing owned by another conversation. Concurrent callers have separate request IDs; render capture may return busy rather than steal a running capture.


## Verification evidence

Both installed npm test suites passed (bridge16 scripts, GA full suite; focused diagnostics31/31). Independent review issues were fixed and regressed. git diff --check passed; untouched files/index preserved. No game asset edits or Git commit.

Runtime acceptance pending: bdmor / Creator2.4.7 / PID30736 still reports runtime_environment unavailable. Exact-version UI binding timed out; authenticated CLI offers no plugin reload tool. User was asked to reload both installed packages and reopen the bridge panel. This is a loaded-code/Preview boundary, not a source/build failure.
