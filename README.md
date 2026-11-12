# Payload Blank Template

This template comes configured with the bare minimum to get started on anything you need.

## Quick start

This template can be deployed directly from our Cloud hosting and it will setup MongoDB and cloud S3 object storage for media.

## Quick Start - local setup

To spin up this template locally, follow these steps:

### Clone

After you click the `Deploy` button above, you'll want to have standalone copy of this repo on your machine. If you've already cloned this repo, skip to [Development](#development).

### Development

1. First [clone the repo](#clone) if you have not done so already
2. `cp .env.example .env` to copy the example environment variables, then set `DATABASE_URL` to your Postgres connection string.
3. `npm install && npm run dev` to install dependencies and start the dev server
4. open `http://localhost:3000` to open the app in your browser

Changes made in `./src` will be reflected in your app.

#### Email (Mailpit)

Password reset emails are sent over SMTP. Locally, `docker-compose.yml` runs [Mailpit](https://mailpit.axllent.org/), which catches every email instead of delivering it:

```sh
docker compose up -d mailpit
```

- Inbox: http://localhost:8027
- SMTP: `127.0.0.1:1026`, which matches the `SMTP_HOST`/`SMTP_PORT` defaults in `.env.example`

Stop it with `docker compose stop mailpit`. It's set to `restart: unless-stopped`, so until then it comes back whenever Docker restarts.

To reset a password without email at all, run `npx tsx src/scripts/setPassword.ts <email>`.

## How it works

The Payload config is tailored specifically to the needs of most websites. It is pre-configured in the following ways:

### Collections

See the [Collections](https://payloadcms.com/docs/configuration/collections) docs for details on how to extend this functionality.

- #### Users (Authentication)

  Users are auth-enabled collections that have access to the admin panel.

  For additional help, see the official [Auth Example](https://github.com/payloadcms/payload/tree/3.x/examples/auth) or the [Authentication](https://payloadcms.com/docs/authentication/overview#authentication-overview) docs.

- #### Media

  This is the uploads enabled collection. It features pre-configured sizes, focal point and manual resizing to help you manage your pictures.

## Questions

If you have any issues or questions, reach out to us on [Discord](https://discord.com/invite/payload) or start a [GitHub discussion](https://github.com/payloadcms/payload/discussions).
