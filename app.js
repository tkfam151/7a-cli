// SISB 7A Classroom: runs on GitHub Pages, stores everything in Supabase.
// All reads/writes go through the database functions in setup.sql, which
// check the login on the server, so nobody can skip the rules from the browser.

const CFG = window.CLASS_CONFIG || {};
const SB_URL = (CFG.supabaseUrl || "").trim().replace(/\/+$/, "");
const SB_KEY = (CFG.supabaseKey || "").trim();
const CLASS_NAME = CFG.className || "Classroom";
const $app = document.getElementById("app");
const $ = (sel, root = document) => root.querySelector(sel);

// ---------- storage of the login on this device ----------
const store = {
  get() { try { return JSON.parse(localStorage.getItem("class-session") || "null"); } catch { return null; } },
  set(v) { try { v ? localStorage.setItem("class-session", JSON.stringify(v)) : localStorage.removeItem("class-session"); } catch {} },
};
let session = store.get();

// ---------- talking to Supabase ----------
async function rpc(fn, args = {}) {
  const headers = { "Content-Type": "application/json", apikey: SB_KEY };
  if (SB_KEY.startsWith("eyJ")) headers.Authorization = "Bearer " + SB_KEY;
  let res;
  try {
    res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(args) });
  } catch {
    throw new Error("Can't connect. Check your internet and try again.");
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const msg = (data && data.message) || "Something went wrong.";
    if (msg === "Please log in again.") { signOutLocal(); render(); }
    if (res.status === 404 || /Could not find the function/i.test(msg))
      throw new Error("The database isn't set up yet. Run setup.sql in Supabase (see README).");
    if (res.status === 401) throw new Error("The Supabase key in config.js isn't right.");
    throw new Error(msg);
  }
  return data;
}

// ---------- small helpers ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const linkify = (s) => esc(s).replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
const initial = (name) => (String(name || "?").trim()[0] || "?").toUpperCase();
const COLORS = ["#1e8e3e", "#1a73e8", "#d93025", "#e37400", "#9334e6", "#007b83", "#c5221f", "#3949ab", "#b06000", "#0b8043"];
const colorFor = (name) => COLORS[[...String(name)].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
const avatar = (name, cls = "") => `<span class="avatar ${cls}" style="background:${colorFor(name)}">${esc(initial(name))}</span>`;
function when(ts) {
  const d = new Date(ts), now = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return time;
  const opts = { month: "short", day: "numeric" };
  if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString([], opts) + ", " + time;
}
function say(el, text, ok) { el.textContent = text; el.className = "msg " + (ok ? "ok" : "err"); }
async function withBusy(btn, label, fn) {
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = label;
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = old; }
}
function signOutLocal() { session = null; store.set(null); }

// ---------- routing ----------
let view = "stream";
let pollTimer = null;

function render() {
  clearInterval(pollTimer);
  document.title = CLASS_NAME + " Classroom";
  $("#brandName").textContent = CLASS_NAME;
  if (!SB_URL || !SB_KEY) return renderNotConfigured();
  if (!session) return renderLogin();
  if (session.role === "creator") return renderCreator();
  return view === "people" && session.role === "admin" ? renderPeople() : renderStream();
}

function showTopbar(tabs) {
  const bar = $("#topbar");
  bar.hidden = false;
  $("#meName").textContent = session.display_name;
  $("#meAvatar").outerHTML = avatar(session.display_name).replace('class="avatar ', 'id="meAvatar" class="avatar ');
  $("#tabs").innerHTML = tabs.map((t) => `<button data-view="${t.id}" class="${t.id === view ? "on" : ""}">${t.label}</button>`).join("");
  $("#tabs").onclick = (e) => { const v = e.target.dataset.view; if (v) { view = v; render(); } };
}
function hideTopbar() { $("#topbar").hidden = true; }

$("#logout").onclick = async () => {
  const t = session && session.token;
  signOutLocal(); view = "stream"; render();
  if (t) rpc("logout", { p_token: t }).catch(() => {});
};

// ---------- not configured ----------
function renderNotConfigured() {
  hideTopbar();
  $app.innerHTML = `<div class="setup card pad">
    <h2>Almost ready</h2>
    <p>This site isn't connected to its database yet.</p>
    <p>Open <code>config.js</code> and paste in your Supabase <b>Project URL</b> and <b>key</b>. The steps are in <code>README.md</code>.</p>
  </div>`;
}

// ---------- login ----------
async function renderLogin() {
  hideTopbar();
  $app.innerHTML = `<div class="auth">
    <div class="card">
      <div class="logo"></div>
      <h1>Sign in</h1>
      <p class="sub">to ${esc(CLASS_NAME)} Classroom</p>
      <form id="loginForm">
        <div class="field"><label for="lu">Username</label><input id="lu" autocomplete="username" autocapitalize="none" required></div>
        <div class="field"><label for="lp">Password</label><input id="lp" type="password" autocomplete="current-password" required></div>
        <button class="btn full">Sign in</button>
        <p class="msg" id="lm"></p>
      </form>
    </div>
    <p class="below">No account yet? Sign in with the class sign-up login your teacher gave you.</p>
    <div id="adminSetup"></div>
  </div>`;

  $("#loginForm").onsubmit = (e) => {
    e.preventDefault();
    withBusy($("#loginForm .btn"), "Signing in…", async () => {
      try {
        session = await rpc("login", { p_username: $("#lu").value, p_password: $("#lp").value });
        store.set(session); view = "stream"; render();
      } catch (err) { say($("#lm"), err.message); }
    });
  };

  try {
    if (await rpc("admin_needs_setup")) {
      $("#adminSetup").innerHTML = `<p class="below"><button class="text-btn" id="openSetup">Teacher: set up the <b>tonkla</b> account</button></p>`;
      $("#openSetup").onclick = renderAdminSetup;
    }
  } catch (err) { say($("#lm"), err.message); }
}

function renderAdminSetup() {
  hideTopbar();
  $app.innerHTML = `<div class="auth">
    <div class="card">
      <div class="logo"></div>
      <h1>Teacher setup</h1>
      <p class="sub">Choose the password for your admin account</p>
      <form id="setupForm">
        <div class="field"><label>Username</label><input value="tonkla" disabled></div>
        <div class="field"><label for="sp1">New password</label><input id="sp1" type="password" autocomplete="new-password" required></div>
        <div class="field"><label for="sp2">Type it again</label><input id="sp2" type="password" autocomplete="new-password" required></div>
        <button class="btn full">Save and sign in</button>
        <p class="msg" id="sm"></p>
      </form>
    </div>
    <p class="below"><button class="text-btn" id="back">Back to sign in</button></p>
  </div>`;
  $("#back").onclick = render;
  $("#setupForm").onsubmit = (e) => {
    e.preventDefault();
    if ($("#sp1").value !== $("#sp2").value) return say($("#sm"), "The two passwords don't match.");
    withBusy($("#setupForm .btn"), "Saving…", async () => {
      try {
        session = await rpc("admin_setup", { p_password: $("#sp1").value });
        store.set(session); view = "stream"; render();
      } catch (err) { say($("#sm"), err.message); }
    });
  };
}

// ---------- sign-up login (sisb): create accounts only ----------
function accountFields(prefix, withRole) {
  return `
    <div class="field"><label for="${prefix}n">Full name</label><input id="${prefix}n" maxlength="60" required autocomplete="off"></div>
    <div class="field"><label for="${prefix}u">Username</label><input id="${prefix}u" maxlength="30" required autocapitalize="none" autocomplete="off">
      <div class="hint">No spaces. Letters, numbers, dot, dash or underscore.</div></div>
    <div class="field"><label for="${prefix}p1">Password</label><input id="${prefix}p1" type="password" required autocomplete="new-password"></div>
    <div class="field"><label for="${prefix}p2">Type the password again</label><input id="${prefix}p2" type="password" required autocomplete="new-password"></div>
    ${withRole ? `<div class="field"><label for="${prefix}r">Account type</label><select id="${prefix}r"><option value="student">Student</option><option value="admin">Teacher (admin)</option></select></div>` : ""}`;
}
async function submitAccount(prefix, msgEl, btn) {
  const p1 = $(`#${prefix}p1`).value, p2 = $(`#${prefix}p2`).value;
  if (p1 !== p2) { say(msgEl, "The two passwords don't match."); return false; }
  return withBusy(btn, "Creating…", async () => {
    try {
      const username = $(`#${prefix}u`).value.trim().toLowerCase();
      await rpc("create_account", {
        p_token: session.token, p_username: username, p_display_name: $(`#${prefix}n`).value,
        p_password: p1, p_role: $(`#${prefix}r`) ? $(`#${prefix}r`).value : "student",
      });
      return username;
    } catch (err) { say(msgEl, err.message); return false; }
  });
}

function renderCreator() {
  hideTopbar();
  $app.innerHTML = `<div class="auth">
    <div class="card">
      <div class="logo"></div>
      <h1>Create your account</h1>
      <p class="sub">for ${esc(CLASS_NAME)} Classroom</p>
      <form id="cf">${accountFields("c", false)}
        <button class="btn full">Create account</button>
        <p class="msg" id="cm"></p>
      </form>
    </div>
    <p class="below"><button class="text-btn" id="doneBtn">Log out of the sign-up login</button></p>
  </div>`;
  $("#doneBtn").onclick = () => $("#logout").click();
  $("#cf").onsubmit = async (e) => {
    e.preventDefault();
    const u = await submitAccount("c", $("#cm"), $("#cf .btn"));
    if (!u) return;
    $app.innerHTML = `<div class="auth"><div class="card">
      <div class="logo"></div>
      <h1>Account created 🎉</h1>
      <p class="sub">Your username is <b>${esc(u)}</b>. Remember your password!</p>
      <button class="btn full" id="signInNew">Sign in with my new account</button>
      <p class="below"><button class="text-btn" id="another">Create another account</button></p>
    </div></div>`;
    $("#another").onclick = renderCreator;
    $("#signInNew").onclick = () => { $("#logout").click(); setTimeout(() => { const f = $("#lu"); if (f) { f.value = u; $("#lp").focus(); } }, 50); };
  };
}

// ---------- stream (announcements) ----------
const openComments = new Set();

async function renderStream() {
  const isAdmin = session.role === "admin";
  showTopbar(isAdmin ? [{ id: "stream", label: "Stream" }, { id: "people", label: "People" }] : [{ id: "stream", label: "Stream" }]);
  $app.innerHTML = `
    <section class="banner"><h1>${esc(CLASS_NAME)}</h1><p>${esc(CFG.classSubtitle || "")}</p></section>
    <div class="stream">
      <aside class="side card pad"><h3>Welcome, ${esc(session.display_name.split(" ")[0])}!</h3>
        <p>${isAdmin ? "Post announcements here. Students see them when they sign in." : "Announcements from your teacher show up here. New ones appear automatically."}</p></aside>
      <div class="posts">
        ${isAdmin ? `<div class="composer card" id="composer"></div>` : ""}
        <div id="feed"><p class="loading">Loading announcements…</p></div>
      </div>
    </div>`;
  if (isAdmin) composerClosed();
  await loadFeed();
  pollTimer = setInterval(() => { if (!document.activeElement || !document.activeElement.closest(".posts")) loadFeed(); }, 30000);
}

function composerClosed() {
  const c = $("#composer");
  c.innerHTML = `<div class="composer-closed" id="openComposer">${avatar(session.display_name)}<span>Announce something to your class</span></div>`;
  $("#openComposer").onclick = composerOpen;
}
function composerOpen() {
  const c = $("#composer");
  c.innerHTML = `<div class="composer-open">
    <div class="label">For all students</div>
    <textarea id="newPost" placeholder="Announce something to your class" maxlength="5000"></textarea>
    <p class="msg" id="pm"></p>
    <div class="row-end"><button class="btn ghost" id="cancelPost">Cancel</button><button class="btn" id="doPost" disabled>Post</button></div>
  </div>`;
  const ta = $("#newPost");
  ta.focus();
  ta.oninput = () => ($("#doPost").disabled = !ta.value.trim());
  $("#cancelPost").onclick = composerClosed;
  $("#doPost").onclick = () => withBusy($("#doPost"), "Posting…", async () => {
    try {
      await rpc("post_announcement", { p_token: session.token, p_body: ta.value });
      composerClosed(); await loadFeed();
    } catch (err) { say($("#pm"), err.message); }
  });
}

async function loadFeed() {
  const feed = $("#feed");
  if (!feed) return;
  let posts;
  try { posts = await rpc("get_stream", { p_token: session.token }); }
  catch (err) { if ($("#feed")) $("#feed").innerHTML = `<div class="card empty">${esc(err.message)}</div>`; return; }
  if (!$("#feed")) return;
  const isAdmin = session.role === "admin";
  if (!posts.length) {
    feed.innerHTML = `<div class="card empty">${isAdmin ? "No announcements yet. Post the first one above!" : "No announcements yet. Check back soon!"}</div>`;
    return;
  }
  feed.innerHTML = `<div class="posts">${posts.map((p) => {
    const n = p.comments.length, open = openComments.has(p.id);
    return `<article class="post card" data-id="${p.id}">
      <div class="post-head">${avatar(p.author)}<div><div class="who">${esc(p.author)}</div><div class="when">${when(p.created_at)}</div></div>
        ${isAdmin ? `<button class="text-btn del" data-del-post="${p.id}" title="Delete announcement">Delete</button>` : ""}</div>
      <div class="post-body">${linkify(p.body)}</div>
      <div class="comments">
        ${n ? `<button class="toggle" data-toggle="${p.id}">👥 ${n} class comment${n === 1 ? "" : "s"}</button>` : ""}
        ${n && open ? p.comments.map((c) => `<div class="comment">${avatar(c.author, "sm")}
            <div><div class="c-who">${esc(c.author)}<span class="c-when">${when(c.created_at)}</span></div><div class="c-body">${linkify(c.body)}</div></div>
            ${c.mine || isAdmin ? `<button class="x" data-del-comment="${c.id}" title="Delete comment">×</button>` : ""}</div>`).join("") : ""}
        ${n && !open && n ? (() => { const c = p.comments[n - 1]; return `<div class="comment">${avatar(c.author, "sm")}<div><div class="c-who">${esc(c.author)}<span class="c-when">${when(c.created_at)}</span></div><div class="c-body">${linkify(c.body)}</div></div></div>`; })() : ""}
        <form class="comment-form" data-comment="${p.id}">${avatar(session.display_name, "sm")}<input placeholder="Add class comment…" maxlength="1000"><button class="send">Post</button></form>
      </div>
    </article>`;
  }).join("")}</div>`;
}

$app.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-toggle],[data-del-post],[data-del-comment]");
  if (!t) return;
  if (t.dataset.toggle) {
    const id = Number(t.dataset.toggle);
    openComments.has(id) ? openComments.delete(id) : openComments.add(id);
    return loadFeed();
  }
  try {
    if (t.dataset.delPost) {
      if (!confirm("Delete this announcement and its comments?")) return;
      await rpc("delete_announcement", { p_token: session.token, p_id: Number(t.dataset.delPost) });
    } else {
      if (!confirm("Delete this comment?")) return;
      await rpc("delete_comment", { p_token: session.token, p_id: Number(t.dataset.delComment) });
    }
    loadFeed();
  } catch (err) { alert(err.message); }
});
$app.addEventListener("submit", async (e) => {
  const f = e.target.closest("[data-comment]");
  if (!f) return;
  e.preventDefault();
  const input = $("input", f), body = input.value.trim();
  if (!body) return;
  const id = Number(f.dataset.comment);
  try {
    await withBusy($("button", f), "…", () => rpc("add_comment", { p_token: session.token, p_announcement_id: id, p_body: body }));
    openComments.add(id);
    loadFeed();
  } catch (err) { alert(err.message); }
});

// ---------- people (admin) ----------
async function renderPeople() {
  showTopbar([{ id: "stream", label: "Stream" }, { id: "people", label: "People" }]);
  $app.innerHTML = `<div class="people">
    <div class="card pad">
      <h3 style="margin:0 0 14px;font-weight:500">Add an account</h3>
      <form id="af"><div class="add-grid">${accountFields("a", true)}</div>
        <p class="msg" id="am"></p>
        <div class="row-end"><button class="btn">Add account</button></div>
      </form>
    </div>
    <div id="lists"><p class="loading">Loading…</p></div>
  </div>`;
  $("#af").onsubmit = async (e) => {
    e.preventDefault();
    const u = await submitAccount("a", $("#am"), $("#af .btn"));
    if (u) { $("#af").reset(); say($("#am"), `Added "${u}".`, true); loadPeople(); }
  };
  loadPeople();
}

async function loadPeople() {
  let list;
  try { list = await rpc("list_accounts", { p_token: session.token }); }
  catch (err) { $("#lists").innerHTML = `<p class="msg err">${esc(err.message)}</p>`; return; }
  const row = (a) => {
    const fixed = a.username === "tonkla" || a.username === "sisb" || a.username === session.username;
    return `<div class="person">${avatar(a.display_name)}
      <div><div class="p-name">${esc(a.display_name)}</div><div class="p-user">@${esc(a.username)}</div></div>
      <div class="actions">
        ${a.username === "sisb" ? `<span class="p-user">sign-up login</span>` : `<button class="text-btn" data-reset="${esc(a.username)}">Reset password</button>`}
        ${fixed ? "" : `<button class="text-btn danger" data-remove="${esc(a.username)}">Remove</button>`}
      </div></div>`;
  };
  const teachers = list.filter((a) => a.role === "admin");
  const students = list.filter((a) => a.role === "student");
  const signup = list.filter((a) => a.role === "creator");
  $("#lists").innerHTML = `
    <h2>Teachers</h2>${teachers.map(row).join("")}
    <h2>Students <small>${students.length} student${students.length === 1 ? "" : "s"}</small></h2>
    ${students.map(row).join("") || `<p class="empty">No students yet. They can sign in with <b>sisb</b> / <b>sisb7a</b> to make their own account, or you can add them above.</p>`}
    <h2>Sign-up login</h2>${signup.map(row).join("")}`;
}

document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-reset],[data-remove]");
  if (!t) return;
  try {
    if (t.dataset.reset) {
      const pw = prompt(`New password for @${t.dataset.reset} (at least 4 characters):`);
      if (!pw) return;
      await rpc("reset_password", { p_token: session.token, p_username: t.dataset.reset, p_password: pw });
      alert("Password changed.");
    } else {
      if (!confirm(`Remove @${t.dataset.remove}? Their comments will be deleted too.`)) return;
      await rpc("delete_account", { p_token: session.token, p_username: t.dataset.remove });
      loadPeople();
    }
  } catch (err) { alert(err.message); }
});

render();
