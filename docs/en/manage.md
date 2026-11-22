# Manage

[← Documentation](README.md) · [Español](../es/gestionar.md)

Everything is done from the HR-Core folder on the server (`cd hr-core`).

## Your staff

| To | Where |
|---|---|
| Add a person | **Team** → *Invite*. They receive a link valid for 7 days |
| Add many people | **Team** → *Import staff*, from a spreadsheet |
| Change a profile (employee, manager, administration, inspector) | **Team** → the person |
| Deactivate someone who leaves | **Team** → the person → deactivate. Their records are kept, as the law requires |
| Organize by department | **Team** → *Departments*. Each manager sees only their own people |
| Resend the user guide | **Team** → the person → *Send the guide for their profile* |

Profiles:

- **Employee:** clocks in, sees their schedule, requests absences, submits expenses and signs documents.
- **Manager:** also validates working days, organizes the roster and approves their team's absences and expenses.
- **Administration:** also configures the company, invites people, produces reports and handles payroll.
- **Inspector:** read-only access to the working-time record (for the Spanish labour inspectorate, *Inspección de
  Trabajo*, or employee representatives).

## Status and logs

```bash
docker compose ps                         # what is running
docker compose logs -f api                # API log (Ctrl+C to exit)
docker logs hr-core-proxy --tail 50       # proxy log
curl -s http://127.0.0.1:8080/api/v1/health   # with Tailscale or local; with a domain: https://your-domain/api/v1/health
```

## Backups

Every night (02:00 UTC by default) the `backup-db` container saves the following in the backups folder:

- `db/hr-YYYY-MM-DD.dump`: the complete database.
- `storage/storage-YYYY-MM-DD.tar.gz`: photos, receipts and documents.

They are kept for 14 days (`BACKUP_KEEP_DAYS`). **They are on the same server**: take them somewhere else. For
example, every night at 03:30 to another server with `rsync` (in root's `crontab -e`):

```
30 3 * * * rsync -a --delete /var/backups/hr-core/ backups@other-server:/backups/hr-core/
```

Or to S3-compatible storage with [rclone](https://rclone.org/), or by syncing them to an office NAS. The
working-time record is kept for **four years** (as required by Spanish labour law): keep a monthly backup for that
long.

### Check a backup (without touching your data)

```bash
infra/backup/restore.sh /var/backups/hr-core/db/hr-2026-11-20.dump prueba_restauracion
```

It restores into a separate database and shows how many users and clock-ins it contains. Do this from time to
time: a backup that has not been tested is not a backup.

### Restore

```bash
infra/backup/restore.sh /var/backups/hr-core/db/hr-2026-11-20.dump
```

It asks you to type `RESTAURAR` (restore) and **replaces** all current data with the backup's. For the files:

```bash
docker compose stop api
docker run --rm -v hr-core_api_storage:/destino -v /var/backups/hr-core/storage:/copias:ro alpine \
  sh -c 'rm -rf /destino/* && tar -xzf /copias/storage-2026-11-20.tar.gz -C /destino'
docker compose start api
```

(The volume is called `<project>_api_storage`; check with `docker volume ls`.)

## Updating

```bash
./instalar/actualizar.sh            # to the latest version
./instalar/actualizar.sh 1.2.0      # to a specific version
```

It makes a database backup, downloads the new images and restarts; database changes are applied automatically.
Read the [release notes](../../CHANGELOG.md) first. To roll back: run `./instalar/actualizar.sh` with the previous
version and, if the new one changed the database, restore the `antes-de-actualizar-…` (before-updating) backup it
made.

New-version alerts: on GitHub, *Watch* → *Custom* → *Releases*.

## Moving to another server

1. On the new server: prepare the system and clone HR-Core ([VPS](vps.md), steps 1 to 6) **without** running the
   installer yet.
2. Copy from the old one the `.env` (it holds the keys: without them sessions and notification encryption stop
   working) and `instalar/configuracion.env` if you used it.
3. On the old one, stop the API and take a backup right away:

   ```bash
   docker compose stop api
   docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > hr-traslado.dump
   docker run --rm -v hr-core_api_storage:/origen:ro alpine tar -czf - -C /origen . > storage-traslado.tar.gz
   ```

   and take both files to the new server (with `scp`).
4. On the new one: run `./instalar/instalar.sh`, then restore the database and files as in *Restore*.
5. Change the DNS (with a domain) or the machine name in Tailscale, and shut down the old one.

## Uninstalling

```bash
docker compose down -v          # deletes the app and ALL its data (backups in the backups folder stay)
docker rm -f hr-core-proxy
tailscale serve reset           # Tailscale only
```
