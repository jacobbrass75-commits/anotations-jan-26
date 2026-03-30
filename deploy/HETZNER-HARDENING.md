# Hetzner Access Hardening

Current goal: move deploy operations off password-based `root` access without risking a lockout.

## Target state

- SSH uses public keys only.
- Daily deploys happen through a non-root `deploy` user.
- The `deploy` user can run the deploy script with `sudo`, but does not get an interactive root shell by default.
- `root` password login is disabled after deploy-user access is verified.

## Recommended rollout

1. Create a `deploy` user with a home directory and shell.
2. Copy the verified deploy key into `/home/deploy/.ssh/authorized_keys`.
3. Grant the user passwordless `sudo` for `/opt/app/deploy/refresh-prod.sh`.
4. Confirm `ssh deploy@server` works and `sudo bash /opt/app/deploy/refresh-prod.sh` succeeds.
5. Only then set `PasswordAuthentication no` and `PermitRootLogin prohibit-password`.

## Example commands

```bash
adduser --disabled-password --gecos "" deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
install -m 600 -o deploy -g deploy /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
printf 'deploy ALL=(root) NOPASSWD: /bin/bash /opt/app/deploy/refresh-prod.sh\n' >/etc/sudoers.d/deploy-scholarmark
chmod 440 /etc/sudoers.d/deploy-scholarmark
```

## Deploy command after cutover

```bash
ssh deploy@89.167.10.34 "sudo bash /opt/app/deploy/refresh-prod.sh"
```

## Do not do this early

- Do not disable password auth until a real deploy works through the `deploy` user.
- Do not remove existing root keys until the new access path is verified.
