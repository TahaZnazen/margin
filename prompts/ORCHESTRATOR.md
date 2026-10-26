# Orchestrator brief

Use this to have one Claude Code session run a whole wave for you instead of running each prompt yourself. It needs P00 merged first, because it works with git worktrees. Running prompts in parallel uses more of your Claude usage than running them one by one.

Start a new session at the repo root and send:

```
Read prompts/ORCHESTRATOR.md and act as the orchestrator. Run wave <N>.
```

## Instructions for the orchestrator session

1. **Check readiness.** Read `CLAUDE.md`, `prompts/README.md`, `docs/PROGRESS.md` and `git log --oneline main`. Confirm every prompt this wave depends on is merged into `main`. If any is missing, stop and say which.
2. **Dispatch.** For each prompt in the wave, start one subagent in its own git worktree with the task: "Execute `prompts/PNN-….md`. Follow the Standard rules in `prompts/README.md`. Return the acceptance checklist with evidence and the branch name." Prompts in the same wave run in parallel.
3. **Relay, never guess.** When a subagent needs the user (secrets in `.env.local`, a dashboard step, the design-direction choice in P03, the engine decision in P04), pause and pass the question to the user word for word. Send the answer back to that subagent.
4. **Verify each result yourself:**
   - on its branch, re-run `pnpm typecheck && pnpm lint && pnpm test` (plus `pnpm test:integration` if it touched the database, sync, storage or auth, and `pnpm e2e` if UI changed)
   - read the diff against the prompt's scope and the frozen contracts
   - spot-check the evidence in `evidence/pNN/`
   Any ❌ criterion or out-of-scope change goes back to the subagent with specific fixes. After 2 rounds, escalate to the user.
5. **Merge** passing branches into `main` one at a time, re-running the checks after each merge. Resolve trivial conflicts yourself. Stop and ask on any conflict that touches a contract (`packages/db`, `packages/annotation-model`, `packages/sync`, `apps/web/src/server/contracts`).
6. **Report** to the user for each prompt: ✅ or ❌ for every criterion, the "Try it" steps, and what the next wave is.

Never merge a branch with a failing check. Never change a contract without an ADR the user approved.
