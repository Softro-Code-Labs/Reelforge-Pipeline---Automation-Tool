# CI/CD: Auto-deploy to Oracle Cloud on every push

`.github/workflows/deploy.yml` does two things on every push to `main` (or when you click
**Run workflow** in the Actions tab):

1. **`build-check`** — installs deps and runs `npm run build` (TypeScript compile) on a
   GitHub-hosted runner. If this fails, deployment never touches your VM.
2. **`deploy`** — SSHes into your Oracle VM and runs `git pull && docker compose up -d --build`,
   then prunes old Docker images to keep disk usage down.

Your app secrets (`GEMINI_API_KEY`, `PEXELS_API_KEY`, `FREESOUND_API_KEY`, etc.) are **not**
part of this pipeline — they stay in the `.env` file you already created directly on the VM
(step 8 of `oracle-cloud-deployment-guide.md`) and are never uploaded to GitHub.

Do these one-time steps before the workflow will work:

## 1. Make sure the VM has a real git clone, not an unzipped folder

The pipeline runs `git pull`, so `~/reelforge` on the VM must be a git repository. If you
originally used the `scp` + `unzip` path from the deployment guide instead of `git clone`,
switch it over once:

```bash
# on the VM
mv reelforge reelforge-old-backup
git clone https://github.com/<you>/<your-repo>.git reelforge
cd reelforge
cp ../reelforge-old-backup/.env .   # carry over your real secrets
```

## 2. Install the Docker Compose plugin on the VM

The original guide's `docker run` command still works fine manually, but the CI pipeline uses
`docker compose` for an idempotent one-line redeploy:

```bash
sudo apt-get update
sudo apt-get install -y docker-compose-plugin
docker compose version   # should print a version, confirming it's installed
```

`docker-compose.yml` (included in the repo) mirrors the exact volumes/port/restart-policy from
the original `docker run` command in the deployment guide, so this is a drop-in swap, not a new
setup.

## 3. Create a dedicated deploy key (don't reuse your personal SSH key)

Generate a new key pair _for GitHub Actions only_ — never put the private key you use to
personally log in into a GitHub Secret:

```bash
# on your own machine, not the VM
ssh-keygen -t ed25519 -f ./oracle-deploy-key -N "" -C "github-actions-deploy"
```

This creates `oracle-deploy-key` (private) and `oracle-deploy-key.pub` (public). Add the
public key to the VM:

```bash
# copy the .pub file's contents, then on the VM:
echo "paste-the-public-key-contents-here" >> ~/.ssh/authorized_keys
```

## 4. Add GitHub repo secrets

In your GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**.
Add all three:

| Secret name      | Value                                                               |
| ---------------- | ------------------------------------------------------------------- |
| `ORACLE_HOST`    | Your VM's public IP address                                         |
| `ORACLE_USER`    | `ubuntu`                                                            |
| `ORACLE_SSH_KEY` | The full contents of `oracle-deploy-key` (the **private** key file) |

## 5. Push to `main` and watch it deploy

```bash
git push origin main
```

Check the **Actions** tab in GitHub to watch `build-check` then `deploy` run. Once green:

```bash
curl http://<PUBLIC_IP>/api/health
```

## Ongoing use

- Every push to `main` auto-deploys. No push needed for scheduled video generation itself —
  that's the app's own cron scheduler (`SCHEDULE_TIMES`), already running inside the container
  regardless of CI/CD.
- To redeploy without a code change (e.g. after editing `.env` on the VM and wanting a clean
  restart), use **Actions → Deploy to Oracle Cloud → Run workflow** instead of an empty commit.
- `docker compose logs -f reelforge` on the VM still works exactly as `docker logs -f reelforge`
  did before.

## Notes / things to weigh

- **No rollback step.** If a bad commit reaches `main`, it deploys. For a personal single-VM
  project this is usually an acceptable tradeoff for simplicity; if you want a safety net,
  GitHub Environments support a manual approval gate before the `deploy` job runs — ask if
  you'd like that added.
- **No downtime-free deploy.** `docker compose up -d --build` briefly stops and restarts the
  container during rebuild (a few seconds to a couple minutes depending on whether the Docker
  layer cache is warm). Fine for a personal tool; not meant for a zero-downtime production
  service.
- **Rotate `oracle-deploy-key`** occasionally, same as any other credential, and remove it from
  `~/.ssh/authorized_keys` immediately if this repo's secrets are ever compromised.
