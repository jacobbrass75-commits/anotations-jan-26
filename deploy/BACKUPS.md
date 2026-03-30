# ScholarMark Backups

## What gets backed up

- SQLite database: `/opt/app/data/sourceannotator.db`
- Uploaded source files: `/opt/app/data/uploads`

Both are required for a usable restore.

## Backup command

```bash
ssh deploy@89.167.10.34 "sudo /bin/bash /opt/app/deploy/backup-data.sh"
```

The backup script creates a timestamped directory under `/opt/backups/scholarmark/` with:

- `sourceannotator.db`
- `uploads.tar.gz`
- `metadata.json`

It also updates `/opt/backups/scholarmark/latest` and prunes old snapshots by count.

## Install nightly timer

```bash
sudo cp /opt/app/deploy/sourceannotator-backup.service /etc/systemd/system/sourceannotator-backup.service
sudo cp /opt/app/deploy/sourceannotator-backup.timer /etc/systemd/system/sourceannotator-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now sourceannotator-backup.timer
```

## Smoke test the backup

```bash
sudo systemctl start sourceannotator-backup.service
sudo systemctl status sourceannotator-backup.service --no-pager
ls -lah /opt/backups/scholarmark/latest
```

## Restore drill

1. Copy the backup snapshot to a temp directory.
2. Extract `uploads.tar.gz` into a fresh `data/uploads`.
3. Place `sourceannotator.db` into the matching `data/` directory.
4. Run:

```bash
npx tsx scripts/bootstrap-db.ts
```

5. Boot the app against that restored `data/` tree and verify:

- `/api/system/status` returns `200`
- document source metadata resolves
- a few real documents open correctly
