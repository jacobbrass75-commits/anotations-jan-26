# ScholarMark Rollback

Use this when a production deploy is unhealthy after smoke checks or when a release causes user-facing regressions.

## Fast rollback

```bash
DEPLOY_HOST=deploy@89.167.10.34 APP_REF=<known-good-commit-or-ref> bash deploy/deploy-prod.sh
```

`deploy/refresh-prod.sh` creates a pre-deploy backup unless `SKIP_PREDEPLOY_BACKUP=1`, resets the app checkout to `APP_REF`, bootstraps the schema, rebuilds, reloads PM2, runs health checks, and runs `scripts/smoke-prod.mjs`.

## Data rollback

Only restore data if the bad deploy wrote corrupt or destructive data. Code rollback should be tried first.

1. Stop app writes or put the app behind maintenance.
2. Choose a backup under `/opt/backups/scholarmark/`.
3. Run a restore drill against that snapshot first:

```bash
BACKUP_DIR=/opt/backups/scholarmark/<timestamp> node /opt/app/scripts/restore-drill.mjs
```

4. Confirm the drill boot smoke passed against the restored data tree.
5. Copy `sourceannotator.db` and extracted `uploads/` into `/opt/app/data`.
6. Run `npx tsx scripts/bootstrap-db.ts`.
7. Reload PM2 and run `npm run smoke:prod`.

## Rollback decision points

- Use code rollback for failed deploy, broken UI, broken API route behavior, or provider/config regressions.
- Use data restore only for confirmed database or upload-file corruption.
- Keep the backup created before rollback until the incident is closed.
