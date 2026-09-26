# Local Setup on Arch Linux with Fish

Step-by-step installation of LingkodHR on an Arch Linux or CachyOS workstation
using the fish shell. Run each step in order. Every command works in fish.

For the reasoning behind each tool and version, see
[`tech-stack-prerequisites.md`](tech-stack-prerequisites.md).

## 1. Update the system

```fish
sudo pacman -Syu
```

Reboot if the kernel or systemd was updated.

## 2. Install the basic build tools

```fish
sudo pacman -S --needed base-devel git curl wget unzip jq openssl ca-certificates python
```

## 3. Install Node.js 24 with fnm

LingkodHR requires Node.js 24, pinned in `.node-version`. `fnm` switches to
Node.js 24 inside the repository without replacing your default Node.js.

```fish
sudo pacman -S --needed fnm
fnm install 24
echo 'fnm env --use-on-cd --shell fish | source' >> ~/.config/fish/config.fish
source ~/.config/fish/config.fish
```

Close and reopen existing terminals, including VS Code integrated terminals.

## 4. Install Corepack for pnpm

```fish
sudo pacman -S --needed corepack
cd ~/Desktop/lingkod-hr
corepack enable
corepack prepare pnpm@11.17.0 --activate
```

Do not install pnpm globally with npm. The `packageManager` field in
`package.json` pins the exact version.

## 5. Install Docker

```fish
sudo pacman -S --needed docker docker-compose docker-buildx
sudo systemctl enable --now docker.service
```

Optional: run Docker without `sudo`:

```fish
sudo usermod -aG docker $USER
```

Log out and back in afterward. Membership in the `docker` group is
root-equivalent, so only add trusted users.

Do not install PostgreSQL, Redis, SeaweedFS, or Mailpit on the host. Docker
Compose runs them.

## 6. Verify the tools

```fish
cd ~/Desktop/lingkod-hr
node --version            # v24.x.x
pnpm --version            # 11.17.0
git --version
docker --version
docker compose version
docker run --rm hello-world
```

If `node --version` does not report v24:

```fish
fnm use
```

If `fnm use` reports missing environment variables:

```fish
fnm env --use-on-cd --shell fish | source
fnm use
```

## 7. Set up the project

Run from the repository root:

```fish
cd ~/Desktop/lingkod-hr
pnpm install --frozen-lockfile
cp -n .env.example .env
docker compose -f infrastructure/compose.yaml up -d --wait
pnpm db:migrate
pnpm --filter @lingkod-hr/database e2e:seed:shell
```

- `cp -n` does not overwrite an existing `.env`.
- Do not run `source .env`. Fish cannot read that format, and project commands
  load `.env` themselves.
- The seed creates a local test Agency and the login user
  `marisol.santos@example.test` with an active Agency Membership. Without it,
  login fails with "No active Agency Membership is available."

## 8. Start the app

```fish
pnpm run dev
```

In a second terminal, check the services:

```fish
curl -fsS http://localhost:3001/api/v1/health
curl -fsS http://localhost:3002/health
curl -fsS http://127.0.0.1:4100/health
```

Open <http://localhost:3000/dashboard>. The local OIDC provider signs you in as
Marisol Santos with no password prompt. If an earlier login failed, use a
private window or clear the `localhost` cookies.

| Service              | Address                               |
| -------------------- | ------------------------------------- |
| Web                  | `http://localhost:3000`               |
| API health           | `http://localhost:3001/api/v1/health` |
| Worker health        | `http://localhost:3002/health`        |
| Local OIDC           | `http://127.0.0.1:4100`               |
| PostgreSQL           | `localhost:55432`                     |
| Redis                | `localhost:6379`                      |
| SeaweedFS S3 API     | `http://localhost:8333`               |
| Mailpit (test email) | `http://localhost:8025`               |

## 9. Optional: browser tests

To run Playwright tests (`pnpm test:e2e`), install Chromium once:

```fish
pnpm --filter @lingkod-hr/web exec playwright install chromium
```

## 10. After pulling changes or switching machines

```fish
cd ~/Desktop/lingkod-hr
fnm use
node --version
pnpm install --frozen-lockfile
docker compose -f infrastructure/compose.yaml up -d --wait
pnpm db:migrate
```

If `.env.example` has new keys, copy only those into `.env` and keep your
existing values.

## Troubleshooting

**Port already in use.** Check ports 3000, 3001, 3002, and 4100:

```fish
ss -ltnp | grep -E ':(3000|3001|3002|4100)([^0-9]|$)'; or true
```

Stop only old LingkodHR processes. Leave unrelated services alone.

**Docker permission denied.** Log out and back in after adding yourself to the
`docker` group, or use `sudo docker ...`.

**Migration fails.** Do not delete the Docker volumes or the database. Confirm
that `.env` has every key from `.env.example` and that the containers are
healthy:

```fish
docker compose -f infrastructure/compose.yaml ps
```

**Login fails with "No active Agency Membership is available."** Run the seed
from step 7, then confirm the login user is active:

```fish
docker compose -f infrastructure/compose.yaml exec -T postgres psql -U hris_local -d hris -c "select u.email_normalized, m.status from users u left join agency_memberships m on m.user_id = u.id;"
```

`marisol.santos@example.test` should show `ACTIVE`.
