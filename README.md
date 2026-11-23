# Class Secret Santa

A Secret Santa website for a class that runs on **GitHub Pages**. Names are saved in a free **Firebase** database.

- **Main page**: students add their name and make up a password. After pairing, they come back with the same name and password to see who they're buying for.
- **`/submit`**: the teacher's page. Press **Submit & pair everyone** once the whole class has joined. Nobody ever gets themselves.

Each student's match is stored encrypted, so only the right password unlocks it. Even someone reading the database directly can't see who got whom.

## Setup (about 10 minutes, one time)

### 1. Create the free database
1. Go to <https://console.firebase.google.com> and sign in with a Google account.
2. **Create a project**. Any name works; you can turn Google Analytics off.
3. In the left menu, open **Build → Realtime Database → Create Database**. Pick any location and choose **Start in locked mode**.
4. Open the **Rules** tab, replace everything with the contents of [`database.rules.json`](database.rules.json), and click **Publish**.
5. On the **Data** tab, copy the URL at the top. It looks like `https://your-project-default-rtdb.firebaseio.com`.

### 2. Connect the site
Open [`config.js`](config.js) on GitHub (pencil icon to edit), paste the URL between the quotes, and commit:
```js
databaseURL: "https://your-project-default-rtdb.firebaseio.com",
```

### 3. Turn on GitHub Pages
In the repo, go to **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, pick the branch and **/ (root)**, then **Save**. After a minute or two the site is live at:
- Students: `https://<your-username>.github.io/<repo-name>/`
- Teacher: `https://<your-username>.github.io/<repo-name>/submit/`

### 4. Set your teacher password
Open the `/submit/` page **before sharing the link** and set a teacher password. It's needed to press Submit, and it can only be set once.

## Fixing mistakes / starting over
For safety, the website itself can't delete anything. Do it in the Firebase console on the **Realtime Database → Data** tab (hover an item and click the trash icon):
- **Remove a wrongly typed name** (before pairing): delete that entry under `people`.
- **Undo the pairing** (and reopen sign-ups): delete `pairs`.
- **Forgot a student's password**: delete their entry under `people` and `pairs`, then redo the pairing.
- **Start fresh next year**: delete everything.
