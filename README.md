# Class Secret Santa

A tiny website for running Secret Santa with a class. No installs needed, just Node.js 18+.

```bash
ADMIN_PASSWORD=choose-one node server.js
```

- **`/`**: students type their name and make up a password. Everyone can see who has joined. After pairing, they come back, type the same name and password, and see who they're buying for.
- **`/submit`**: the teacher's page. Once everyone has joined, press **Submit & pair everyone**. Each person gets a random match, and nobody ever gets themselves. From here you can also remove a name typed by mistake, undo the pairing, or start over.

If `ADMIN_PASSWORD` is set, `/submit` asks for it before it pairs, removes or resets. Without it, anyone who opens `/submit` could press the button.

Names and pairings are saved in `data.json` (passwords are stored hashed), so they survive a restart.
