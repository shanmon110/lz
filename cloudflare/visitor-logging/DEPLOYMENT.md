# Visitor logging deployment

Run every command in this directory with Node 24. The generated production
configuration contains deployment identifiers, lives under `.private/`, and is
ignored by Git. Do not print the generated file or enable shell tracing.

## Authenticate and prepare

For interactive authentication:

```sh
nvm use 24
npx wrangler login
npx wrangler whoami
```

For CI, set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the CI secret
store instead of running `wrangler login`, then confirm the token before the
deployment:

```sh
npx wrangler whoami
```

Set the three deployment inputs without committing them. Do not use `set -x`:

```sh
export CF_D1_DATABASE_ID='<D1 database UUID>'
export CF_TEAM_DOMAIN='https://<team-name>.cloudflareaccess.com'
export CF_POLICY_AUD='<Access application audience>'
npm run config:production
```

`CF_TEAM_DOMAIN` must use the canonical
`https://<team-name>.cloudflareaccess.com` form with one lowercase DNS label.
A single trailing slash is accepted and normalized away; ports, paths, query
strings, fragments, credentials, extra labels, and alternate URL syntax are
rejected.

The generator validates every input before it creates the parent directory or
writes `.private/wrangler.production.jsonc`. It is silent on success and never
prints supplied values.

## Migrate and deploy

Apply migrations before deploying code that depends on them. Both package
commands always select the private production configuration:

```sh
npm run d1:migrate:remote
npm run deploy
```

Re-run `npm run config:production` whenever any of the three deployment inputs
changes. Wrangler uses the interactive login or CI token established above for
both authenticated commands.

## Roll back traffic

Authenticate with `npx wrangler login` when needed and verify the active account
with `npx wrangler whoami` before changing traffic. Then use this order:

1. **Remove the Worker routes first.** Deleting the Worker removes its public
   routes and custom domain without deleting the separately managed D1 database:

   ```sh
   npx wrangler delete lizhe-visitor-logging --config .private/wrangler.production.jsonc
   ```

2. **Keep DNS proxied initially.** Confirm `lizhe.link` and `www.lizhe.link`
   reach the previous origin through Cloudflare before changing DNS settings.

3. **Restore nameservers only if needed.** Change registrar nameservers only if
   keeping Cloudflare authoritative DNS cannot restore the previous service.

4. **Retain D1.** Do not run `wrangler d1 delete`; preserving the database keeps
   visitor history available for recovery or a later redeployment.
