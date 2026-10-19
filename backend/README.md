# Fifty Tracker — Backend (Phase 1)

Internal project tracker for Fifty Studios. Phase 1: auth, users, JWT, permissions.

## Stack

- Node.js 20+
- Express 4
- PostgreSQL 16 (via `pg`)
- JWT (jsonwebtoken) + bcrypt
- helmet, cors, morgan, dotenv
- PM2 for process management

## Quick start

```bash
cd /root/fifty-tracker/backend
npm install
npm run migrate
npm run seed
pm2 start ecosystem.config.cjs
pm2 save
curl http://127.0.0.1:3081/api/health
```

## First admin (created by seed)

- **email**: `admin@5ostudios.local`
- **password**: `changeme`  →  **change on first login**
- **role**: `admin`

## Endpoints

See [API.md](./API.md) for full reference. Quick list:

- `GET  /api/health` — health check, no auth
- `POST /api/auth/login` — body `{email, password}` → `{token, user}`
- `POST /api/auth/logout` — no body, 204
- `GET  /api/auth/me` — Bearer token, returns current user
- `GET  /api/users` — admin only, list users
- `POST /api/users` — admin only, create user
- `PATCH /api/users/:id` — admin only, update user
- `DELETE /api/users/:id` — admin only, soft-delete (set active=false)
- `POST /api/users/:id/reactivate` — admin only, reactivate

## File tree

```
backend/
├── src/
│   ├── config/db.js
│   ├── middleware/
│   │   ├── auth.js
│   │   └── error.js
│   ├── routes/
│   │   ├── auth.js
│   │   └── users.js
│   ├── db/
│   │   ├── migrate.js
│   │   ├── seed.js
│   │   └── migrations/001_users.sql
│   ├── utils/
│   │   ├── jwt.js
│   │   └── password.js
│   └── server.js
├── .env
├── .env.example
├── .gitignore
├── package.json
├── ecosystem.config.cjs
├── README.md
└── API.md
```

## Roles

- **admin** — full access, manages users + projects (when phases are added)
- **worker** — only sees projects they're assigned to, only updates edits assigned to them (enforced in later phases)

For Phase 1 the only enforcement is the `admin` role gate on `/api/users`. The Worker role exists and is enforced at user creation / role change.
