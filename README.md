# Botify X v1.1.4

WhatsApp Bot + Web Management Panel  
Runs on Railway. No QR code — pairing code only.

---

## Quick Start

```bash
npm install --force
npm start
```

Open: `http://localhost:3000/panel`

---

## Deploy to Railway

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Botify X v1.0.3"
git remote add origin https://github.com/YOUR_USER/botify-x.git
git push -u origin main
```

> **Note:** The `auth/` folder and `node_modules/` are in `.gitignore` — do NOT commit them.

### 2. Deploy on Railway

1. Go to [railway.app](https://railway.app) → New Project → GitHub repo
2. Select your `botify-x` repo
3. Railway auto-detects Node.js and runs `npm start`
4. Settings → Domains → Generate a public domain

The `auth/` folder is created automatically at runtime — you do not need to create it.

---

## Login

URL: `https://your-app.up.railway.app/panel`

| Field | Value |
|-------|-------|
| Username | `katson` |
| Password | `#jesusfuckingchrist#` |

---

## Connecting the Bot

1. Login → **Connect Bot**
2. Enter your WhatsApp number (country code + digits, no `+` or spaces)  
   Example: `447911123456`
3. Click **Generate Pairing Code**
4. On WhatsApp: Settings → Linked Devices → Link a Device → Link with phone number instead
5. Enter the 8-character code shown
6. Bot sends a confirmation message when connected ✅

---

## Adding Users

1. Login → **Manage Users**
2. Enter phone + days (default: 30)
3. Click **Add User**

Users are blocked after expiry with the message: *"Your access has expired"*

---

## Commands Reference

All commands use `*` prefix.

| Command | Description |
|---------|-------------|
| `*menu` | Show all commands |
| `*ping` | Bot speed check |
| `*antilink on/off` | Link protection in groups |
| `*promote` | Make user admin |
| `*demote` | Remove admin status |
| `*kick` | Remove from group |
| `*resetlink` | New group invite link |
| `*welcome on/off` | Welcome messages |
| `*goodbye on/off` | Leave messages |
| `*tagall` | Mention all members |
| `*hidetag [text]` | Hidden group mention |
| `*warn` | Warn user (5 = kick) |
| `*vv` | Reveal view-once media |
| `*getpp` | Get profile picture |
| `*sticker` | Convert image to sticker |
| `*mode public/private` | Bot access mode |
| `*anticall on/off` | Auto-reject calls |
| `*antidelete on/off` | Show deleted messages |
| `*antiedit on/off` | Show original edits |

**Secret:** Reply to a view-once with only emojis → saved secretly to admin.

---

## File Structure

```
botify-x/
├── index.js           ← Entry point
├── bot.js             ← WhatsApp (Baileys)
├── package.json
├── .npmrc             ← Prevents package-lock.json
├── .gitignore
├── commands/          ← All bot commands
├── events/            ← Message/group/connection handlers
├── utils/             ← Access control, data, bot state
├── data/              ← JSON storage (users, settings, warnings)
│   ├── users.json
│   ├── settings.json
│   └── warnings.json
└── dashboard/         ← Web panel
    ├── app.js
    └── views/
        ├── login.html
        └── dashboard.html
```

> `auth/` is created at runtime and is NOT included in the repo.
