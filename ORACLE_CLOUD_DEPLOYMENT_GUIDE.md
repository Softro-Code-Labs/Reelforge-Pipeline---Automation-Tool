# Deploying Reelforge to Oracle Cloud Free Tier

This replaces your Render web service with a self-managed Always Free Ampere A1 VM. Same Docker image, no code changes needed beyond what's already in your fixed zip.

---

## 1. Create an Oracle Cloud account

1. Go to https://www.oracle.com/cloud/free/ and sign up.
2. A credit card is required for identity verification — you will **not** be charged as long as you stay within Always Free limits.
3. **Pick your Home Region carefully** — you cannot change it later. If your first choice shows "out of host capacity" for Ampere A1 during instance creation, you may need to try a different region on a new account, or simply retry over the next hours/days (capacity fluctuates).
4. Note: Oracle reduced Always Free Ampere A1 limits in mid-2026 from 4 OCPU/24GB down to **2 OCPU/12GB total** for free-tier accounts (enforcement has been inconsistent, so check the Console under **Governance & Administration → Account Management → Tenancy Details** to see what your account actually shows). Either number is far more than this pipeline needs.

## 2. Create the Compute instance

In the Console: **Compute → Instances → Create Instance**

- **Name:** `reelforge`
- **Image:** Canonical Ubuntu (24.04 or latest LTS)
- **Shape:** click "Change shape" → **Ampere** → `VM.Standard.A1.Flex`
  - Set **1 OCPU / 6 GB RAM** (plenty for this app; leaves the rest of your free allowance for anything else you want to run later)
- **Networking:** let it create a new VCN — this automatically sets up a public subnet + internet gateway + public IP. Confirm "Assign a public IPv4 address" is checked.
- **SSH keys:** generate a new key pair here and **download the private key** (or paste in your own existing public key). You cannot recover this later if you lose it.
- **Boot volume:** default (~50GB) is fine, well within the 200GB free allowance.
- Click **Create**. Provisioning takes a minute or two.

Once running, copy the **public IP address** shown on the instance page — you'll need it for everything below.

## 3. Open the firewall (two layers — both required)

**A. Oracle's Security List** (cloud-level firewall)
Go to your instance's VCN → the public subnet → **Security Lists** → default security list → **Add Ingress Rules**:

| Source CIDR | Protocol | Destination Port |
| ----------- | -------- | ---------------- |
| 0.0.0.0/0   | TCP      | 80               |
| 0.0.0.0/0   | TCP      | 443              |

**B. The OS firewall on the VM itself** — Oracle's Ubuntu images ship with `iptables` rules that block everything except SSH by default, so the Security List rule alone isn't enough. You'll open this once you're SSH'd in (step 5).

## 4. SSH into the instance

```bash
#### **On Linux / macOS (Bash/Zsh)**
chmod 400 /path/to/your-private-key.key
#### **On Windows (PowerShell)**
icacls.exe "C:\path\to\your-private-key.key"

ssh -i /path/to/your-private-key.key ubuntu@<PUBLIC_IP>
```

## 5. Open the OS-level firewall

```bash
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## 6. Install Docker

```bash
sudo apt-get update
sudo apt-get install -y docker.io
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
exit
```

Log back in (`ssh ...` again) so the group change takes effect.

## 7. Get your code onto the VM

Easiest path — push your fixed project to a GitHub repo (private is fine) from your own machine, then on the VM:

```bash
git clone https://github.com/<you>/<your-repo>.git reelforge
cd reelforge
```

If you'd rather not use git, `scp` the zip up directly from your own machine instead:

```bash
scp -i /path/to/your-private-key.key reelforge-pipeline-fixed.zip ubuntu@<PUBLIC_IP>:~
# then on the VM:
sudo apt-get install -y unzip
unzip reelforge-pipeline-fixed.zip && mv reelforge-fixed reelforge && cd reelforge
```

## 8. Add your environment variables

Create the real `.env` file on the VM (this never goes into git or the zip):

```bash
cat > .env << 'EOF'
GEMINI_API_KEY=your_actual_key_here
GEMINI_MODEL=gemini-flash-latest
PEXELS_API_KEY=your_actual_key_here
PORT=80
EOF
```

(`PIPER_*` and `FFMPEG_PATH` don't need to be set — the Dockerfile already bakes in correct defaults for those.)

## 9. Build and run

```bash
docker build -t reelforge .

mkdir -p ~/reelforge-data/workdir ~/reelforge-data/db

docker run -d \
  --name reelforge \
  --restart unless-stopped \
  --env-file .env \
  -p 80:80 \
  -v ~/reelforge-data/workdir:/app/workdir \
  -v ~/reelforge-data/db:/app/data \
  reelforge
```

- `--restart unless-stopped` means the container comes back automatically after a VM reboot or crash.
- The two `-v` mounts persist generated videos and the job history on the VM's disk, so they survive container restarts/rebuilds (this is something Render's ephemeral disk didn't give you either, so it's a nice side upgrade).

## 10. Test it

```bash
curl http://<PUBLIC_IP>/api/health
```

Then open `http://<PUBLIC_IP>` in a browser — same UI you had on Render.

## 11. Useful ongoing commands

```bash
docker logs -f reelforge          # tail logs live
docker restart reelforge          # restart the app
docker stats reelforge            # live CPU/memory usage — confirm you're nowhere near the ceiling now

# after pushing code changes (git pull or re-upload the zip):
docker build -t reelforge . && docker stop reelforge && docker rm reelforge
# then re-run the `docker run` command from step 9
```

## Things to keep in mind

- **Idle reclamation:** Oracle can reclaim Always Free compute if it sits essentially idle (near-zero CPU/network) for an extended period. A tool you use somewhat regularly is unlikely to trigger this, but if you leave it completely untouched for weeks, be aware it's a possibility. A simple daily cron hitting `/api/health` is enough insurance if you're worried.
- **No automatic TLS/HTTPS** — you're on plain HTTP via the IP address in this setup. Fine for a personal tool. If you later want a domain + HTTPS, the simplest add-on is a [Caddy](https://caddyserver.com/) reverse-proxy container, which handles Let's Encrypt certificates automatically — happy to walk through that whenever you want it.
- **This VM is now fully yours to patch** — Render handled OS updates for you; here, an occasional `sudo apt-get update && sudo apt-get upgrade` is on you.
