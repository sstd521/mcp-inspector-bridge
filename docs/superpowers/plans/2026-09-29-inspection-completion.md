# Inspection and completion implementation plan

**Goal:** Repair the approved property/reference omissions and asynchronous method receipts.
**Architecture:** Keep crawler as the shared reader/invoker. Use one bounded panel invocation helper for UI and IPC. Extend the installed Game Agent's existing schemas and receipt validator; retain authorization and partial-write handling.
**Stack:** Existing TypeScript, Vue, Node assert tests; no new dependencies.

- [x] Add and run failing property and completion tests against the existing crawler and Game Agent executor.
- [x] Read property metadata through Class.attr plus $_$/| fallback. Merge metadata keys; if no meaningful registered fields remain, use own instance keys. Expose additional runtime keys only with includeRuntime:true, cap 128 properties per component, and mark truncation.
- [x] Preserve null/undefined values with declared reference type and explicit read_error on failed getters; render these as read-only diagnostics.
- [x] Await returned thenables in the shared crawler method. Verify scene/component identity before confirming completion. Return method-returned or method-promise-resolved evidence; rejected methods are not successful.
- [x] Bound panel waiting to two seconds, below the existing three-second router deadline. Watch navigation, guest replacement and view destruction; report partial/unverified failures, never retry. A timed-out Promise may still run.
- [x] Use the panel helper from UI and IPC. JSON-encode node detail arguments. Extend includeRuntime and exact invocation evidence in installed Game Agent without changing prior CLI/Preview work.
- [x] Run focused tests, full bridge npm test, Game Agent receipt/read-only regressions and full npm test. Inspect generated dist and diffs. Sync only owned changes after verifying unchanged baselines.
- [ ] Verify through the authenticated editor route where possible; report loaded-version and Preview limits separately from Node/build checks. Update durable Obsidian progress.

Approved scope is first-phase repair only. No game assets, editor restart, commit or unrelated inspector feature migration.


## Delivery evidence

Source is installed in the two explicit package directories. Bridge dist was rebuilt with npm test; its full 11-script suite passed. Installed Game Agent npm test also passed. Existing unrelated Game Agent changes and index were preserved. Actual panel IPC and UI binding tests additionally found and fixed stale property type metadata after null-to-reference refresh.

Live CLI read: bdmor, Creator 2.4.7, PID 30736, GameScene; runtime_triage previewReady and inspectorReady true. The running process still advertises the old get_node_detail schema without includeRuntime. Exact-version native UI access timed out twice, so plugin reload and new-behavior Preview acceptance remain pending. No editor restart, game asset changes, Build/device acceptance or Git commit.

Audit and remaining priorities: /Volumes/feng/git/jztw/extensions/game_agent/docs/inspector-gap-audit-2026-09-29.md
