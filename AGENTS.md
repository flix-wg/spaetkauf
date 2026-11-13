# Spätkauf

Mobile web app that ranks Deutsche Bahn long-distance connections by how often they arrive 20+ minutes late, pairs each with the train you would ride instead, and watches a booked trip live.

Read before working:
- `openspec/changes/mvp-late-train-picks/proposal.md`, `design.md` (API contract in D12), `tasks.md`
- the spec for the capability you touch under `openspec/changes/mvp-late-train-picks/specs/`

Rules:
- Never send a request to bahn.de or any Deutsche Bahn host. Links only.
- Secrets live in `.env` (gitignored). Never print or commit them.
- Work only in the files your task owns. Tick your task in `tasks.md` when its verification passes.
- Few, meaningful tests; few comments.
- Commit messages: short, imperative, no AI or tool attribution, no co-author trailers.
- Do not push. Do not change git remotes.
- Outside HTTP calls use the client name from `SPAETKAUF_CLIENT_NAME`; no personal data in headers or URLs.
- Deadlines are Helsinki time (UTC+2); this machine's clock is Berlin time.

Commands:
- Backend: `cd backend && uv run pytest`, `uv run uvicorn app.main:app --reload --port 8000`
- Frontend: `cd frontend && npm run build`, `npm run dev`
- Spec check: `openspec validate mvp-late-train-picks --strict`
