# Static hosting

Kurt runs entirely in the browser. Cloudflare Pages serves `frontend/dist`; no backend, VM or database server is deployed. The public site is https://kurt-34y.pages.dev (Pages project `kurt`).

Follow the data preparation steps in [README](../README.md), then run `cd frontend && npm ci && npm run build`. Odds are exported from `data/odds.sqlite`; history Parquet files and `meta.json` are copied from the committed `data/static/history/`. `scripts/fetch_duckdb_ext.sh` downloads and verifies the self-hosted DuckDB Parquet extension. After the frontend build, run `npm --prefix extension ci` and `bash scripts/build_extension_zip.sh` from the repository root. This builds the extension bundle and packages its manifest, icons, source, bundle and locales into `frontend/dist/kurt-extension.zip`; unzip it and load the extracted directory in Chrome. The script uses `zip` when available, otherwise Python’s zipfile. Every deployed file must be at most 25 MiB.

Set `VITE_OPERATOR_NAME`, `VITE_OPERATOR_ADDRESS` (lines separated by `;`), `VITE_OPERATOR_EMAIL` and `VITE_OPERATOR_LINKEDIN` at build time; see `frontend/.env.example`. Keep real operator details out of git.

## Pages deployment

CI tests the backend, frontend and extension. A push to `main` builds and deploys the static site with Wrangler. Configure repository secrets `CLOUDFLARE_API_TOKEN` (Pages deployment access) and `CLOUDFLARE_ACCOUNT_ID`, and repository variables `OPERATOR_NAME`, `OPERATOR_ADDRESS`, `OPERATOR_EMAIL`, `OPERATOR_LINKEDIN`; CI maps them to `VITE_OPERATOR_*` for the build.

To redeploy, run the CI workflow manually. Its optional `ref` accepts a branch, tag or commit; `main` deploys production and any other ref deploys the `preview` branch. For a production rollback, deploy the old ref as a preview first, then promote it in Pages. The job checks the published odds URL for HTTP 200 and JSON, retrying for propagation.

Pages copies `frontend/public/_headers` to the build: ETag revalidation for data (including the history Parquet files), stale-while-revalidate service-worker caching for all odds JSON, immutable hashed assets, a CSP with hashes for the inline bootstrap scripts, and raw gzip bytes for DuckDB (the app decompresses them itself). `vite preview` does not reproduce these headers. After deploying, check history queries in a fresh browser, alongside search, PWA installation and the extension. Pages returns the app shell for unknown paths, so a 200 response alone does not prove a data file exists.

Saved trips live in IndexedDB in each browser; clearing site data removes them. The retained `backend/` and `deploy/` are legacy code and are not part of this deployment.
