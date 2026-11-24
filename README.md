# SISB 7A Classroom

A simple class website where the teacher posts announcements and students read and comment on them.
The website runs on **GitHub Pages** (free). Accounts and posts are saved in **Supabase** (free).

## Who logs in with what

| Login | Who uses it | What it can do |
|---|---|---|
| `sisb` / `sisb7a` | Shared sign-up login for students | **Only** create new student accounts |
| Each student's own account | Students | Read announcements, write class comments |
| `tonkla` (you pick the password the first time) | Teacher / admin | Post and delete announcements, add/remove accounts, reset passwords, delete comments |

## Setup (one time)

### 1. Create the free database (Supabase)
1. Go to <https://supabase.com>, click **Start your project**, and sign in (signing in with GitHub is easiest).
2. Click **New project**. Pick any name (e.g. `sisb7a`), make up a database password (you won't need it again), choose a region near you, and click **Create new project**. Wait about a minute.
3. In the left menu, open **SQL Editor**. Open [`setup.sql`](setup.sql) from this repo, copy **all** of it, paste it in, and click **Run**. It should say *Success*.

### 2. Connect the website to the database
1. In Supabase, click **Project Settings** (gear icon) in the left menu.
   - Under **Data API**, copy the **Project URL** (looks like `https://abcdxyz.supabase.co`).
   - Under **API Keys**, copy the **anon / public** key (or the **publishable** key, which starts with `sb_publishable_`).
     **Don't** use the *service_role* or *secret* key.
2. In this GitHub repo, open [`config.js`](config.js), click the ✏️ pencil to edit, paste both values between the quotes, and click **Commit changes**:
   ```js
   supabaseUrl: "https://abcdxyz.supabase.co",
   supabaseKey: "paste-the-key-here",
   ```

### 3. Turn on GitHub Pages
1. In this repo, go to **Settings → Pages**.
2. Under **Build and deployment** → **Source**, choose **Deploy from a branch**.
3. Pick the branch with these files and the **/ (root)** folder, then click **Save**.
4. Wait 1-2 minutes. The site will be at `https://<your-github-username>.github.io/<repo-name>/` (the Pages settings page shows the exact link).

### 4. Set your teacher password (do this before sharing the link!)
Open the site and click **Teacher: set up the tonkla account** under the sign-in box. Choose your password.
That link disappears once the password is set.

### 5. Share with the class
Give students the website link and the sign-up login **sisb** / **sisb7a**. Each student:
1. Signs in with `sisb` / `sisb7a`.
2. Fills in their name, a username and a password, then clicks **Create account**.
3. Clicks **Sign in with my new account** to see the announcements.

## Everyday use
- **Post**: sign in as `tonkla` → **Stream** → *Announce something to your class* → **Post**.
- **Add an account yourself / remove a student / reset a forgotten password**: sign in as `tonkla` → **People**.
- Students' pages check for new announcements every 30 seconds.

## Good to know
- Passwords are stored scrambled (hashed), and the database only allows the actions in the table above.
- Anyone who knows `sisb` / `sisb7a` can create a student account. If someone makes a joke account, remove it from **People**.
- Free Supabase projects **pause after about a week with no visits**. If the site says it can't connect, open your Supabase dashboard and click **Restore project**.
- Forgot the `tonkla` password? In Supabase → **SQL Editor**, run
  `update accounts set password_hash = null where username = 'tonkla';`
  and the **Teacher: set up** link will appear on the sign-in page again.
