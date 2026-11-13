# CI/CD

`.github/workflows/ci.yml` runs on every push and pull request:

- `backend`: uv (cached), `ruff check`, `pytest`.
- `frontend`: Node 22 (npm cached), `npm ci`, `npm run typecheck`, `npm run build`.
- `deploy`: after both are green, on pushes to `main` and manual runs. Calls `deploy-compose.yml`, which copies the commit to the VM (`git archive | ssh tar`), runs `docker compose up -d --build` and waits up to 90 s for the health URL. Runs never overlap (`concurrency: deploy`). It skips itself while `DEPLOY_SSH_KEY` or `DEPLOY_HOST` is unset, so forks and fresh repos stay green. `.env` on the server is never touched.
- Roll back: Actions, CI, Run workflow, enter an old sha as `ref`.

## One-time setup (dev box, then the VM)

```sh
ssh-keygen -t ed25519 -N '' -C spaetkauf-deploy -f ~/.ssh/spaetkauf_deploy
ssh-copy-id -i ~/.ssh/spaetkauf_deploy.pub root@65.108.33.75
ssh-keyscan -t ed25519 65.108.33.75 > ~/.ssh/spaetkauf_known_hosts
ssh-keygen -lf ~/.ssh/spaetkauf_known_hosts   # compare with: ssh root@65.108.33.75 ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
gh secret set DEPLOY_SSH_KEY -R flix-wg/spaetkauf < ~/.ssh/spaetkauf_deploy
gh secret set DEPLOY_KNOWN_HOSTS -R flix-wg/spaetkauf < ~/.ssh/spaetkauf_known_hosts
gh secret set DEPLOY_HOST -R flix-wg/spaetkauf --body 65.108.33.75
```

`DEPLOY_USER` is optional (default `root`). The same script by hand: `deploy/ship.sh root@65.108.33.75 [ref]` (env overrides: `DEPLOY_DIR`, `DEPLOY_COMPOSE`, `DEPLOY_ENV`, `HEALTH_URL`).

## Reuse in another Docker Compose repo

1. Call the workflow (once this repo is public) or copy `deploy-compose.yml` into the other repo (while it is private; it needs no other file):

   ```yaml
   deploy:
     needs: [test]
     if: github.ref == 'refs/heads/main'
     concurrency: { group: deploy, cancel-in-progress: false }
     uses: flix-wg/spaetkauf/.github/workflows/deploy-compose.yml@main
     with:
       target_dir: /opt/myapp
       compose_file: docker-compose.yml
       health_url: https://myapp.example.com/health
     secrets:
       DEPLOY_HOST: ${{ secrets.DEPLOY_HOST }}
       DEPLOY_SSH_KEY: ${{ secrets.DEPLOY_SSH_KEY }}
       DEPLOY_KNOWN_HOSTS: ${{ secrets.DEPLOY_KNOWN_HOSTS }}
   ```

2. Set the three secrets as above, with a key authorised on that server.
3. On the server: Docker with Compose, and a hand-placed env file (`<target_dir>/.env`, or the name set in `env_file`). The compose file comes from the repo.
