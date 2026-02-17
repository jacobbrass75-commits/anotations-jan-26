# Hetzner Data Backup (2026-02-17T20:08:11Z)

This backup was created before resetting `/opt/app` to `origin/master`.

## Includes
- `sourceannotator.db.gz.part-aa`
- `sourceannotator.db.gz.part-ab`
- `sourceannotator.db.gz.part-ac`
- `sourceannotator.db.gz.parts.sha256`
- `checksums.sha256`
- `git-status-before.txt`
- `git-diff-before.patch`

## Source server
- Host: `89.167.10.34`
- App path: `/opt/app`
- Server backup path: `/root/backups/sourceannotator-20260217T200811Z`
- Deployed code commit after reset: `13eb0a9`

## Verify split archive integrity
```bash
cd backups/hetzner-20260217T200811Z
shasum -a 256 -c sourceannotator.db.gz.parts.sha256
```

## Restore DB from split parts
```bash
cd backups/hetzner-20260217T200811Z
cat sourceannotator.db.gz.part-aa sourceannotator.db.gz.part-ab sourceannotator.db.gz.part-ac > sourceannotator.db.gz
gunzip -c sourceannotator.db.gz > sourceannotator.db
```

## Restore to server
```bash
scp sourceannotator.db root@89.167.10.34:/opt/app/data/sourceannotator.db
ssh root@89.167.10.34 'pm2 restart sourceannotator'
```

## Notes
- Current live DB hash at backup time:
  - `a6ff7def336b17e7bd5352cf3fa3e8cb6267ee5e91fdd7fd21789e287b014c1f`
- This backup contains research/project data. Keep repository access restricted.
