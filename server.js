// Secret Santa for a class — zero dependencies, just Node.js.
//   node server.js            -> http://localhost:3000
// Optional env vars:
//   PORT=3000                 port to listen on
//   ADMIN_PASSWORD=xyz        if set, /submit asks for it before pairing or resetting
//   DATA_FILE=./data.json     where sign-ups and pairings are saved

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data.json");

// ---------- storage ----------
function load() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return { people: [], paired: false };
  }
}
function save(db) {
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
let db = load();

// ---------- helpers ----------
const norm = (s) => String(s || "").trim().replace(/\s+/g, " ");
const key = (s) => norm(s).toLowerCase();

function hashPassword(pw, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(pw), salt, 32).toString("hex");
  return { salt, hash };
}
function checkPassword(pw, person) {
  const { hash } = hashPassword(pw, person.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(person.hash, "hex"));
}
function sameSecret(a, b) {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

// Shuffle everyone into one big circle; each person gives to the next.
// Nobody can ever draw themselves.
function pairUp(people) {
  const order = people.map((p) => p.name);
  for (let i = order.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const giftee = {};
  order.forEach((name, i) => (giftee[name] = order[(i + 1) % order.length]));
  for (const p of people) p.giftee = giftee[p.name];
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1e5) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}
function json(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}
function html(res, body) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(body);
}

// ---------- API ----------
async function api(req, res, url) {
  if (req.method === "GET" && url === "/api/status") {
    return json(res, 200, {
      paired: db.paired,
      names: db.people.map((p) => p.name),
      adminPasswordRequired: !!ADMIN_PASSWORD,
    });
  }

  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  const body = await readBody(req);

  if (url === "/api/join") {
    const name = norm(body.name);
    const password = String(body.password || "");
    if (db.paired) return json(res, 400, { error: "Names are already paired — sign-ups are closed." });
    if (!name) return json(res, 400, { error: "Please type your name." });
    if (name.length > 60) return json(res, 400, { error: "That name is too long." });
    if (password.length < 3) return json(res, 400, { error: "Pick a password with at least 3 characters." });
    if (db.people.some((p) => key(p.name) === key(name)))
      return json(res, 400, { error: `"${name}" is already on the list.` });
    db.people.push({ name, ...hashPassword(password) });
    save(db);
    return json(res, 200, { ok: true });
  }

  if (url === "/api/reveal") {
    const person = db.people.find((p) => key(p.name) === key(body.name));
    if (!person || !checkPassword(body.password || "", person))
      return json(res, 401, { error: "Name or password is wrong." });
    if (!db.paired) return json(res, 400, { error: "Not paired yet — check back after your teacher presses Submit." });
    return json(res, 200, { name: person.name, giftee: person.giftee });
  }

  if (url === "/api/pair" || url === "/api/reset") {
    if (ADMIN_PASSWORD && !sameSecret(body.admin || "", ADMIN_PASSWORD))
      return json(res, 401, { error: "Wrong teacher password." });

    if (url === "/api/pair") {
      if (db.paired) return json(res, 400, { error: "Already paired." });
      if (db.people.length < 2) return json(res, 400, { error: "Need at least 2 people to pair up." });
      pairUp(db.people);
      db.paired = true;
      save(db);
      return json(res, 200, { ok: true, count: db.people.length });
    }

    // reset
    if (body.mode === "everything") db = { people: [], paired: false };
    else {
      db.paired = false;
      db.people.forEach((p) => delete p.giftee);
    }
    save(db);
    return json(res, 200, { ok: true });
  }

  if (url === "/api/remove") {
    if (ADMIN_PASSWORD && !sameSecret(body.admin || "", ADMIN_PASSWORD))
      return json(res, 401, { error: "Wrong teacher password." });
    if (db.paired) return json(res, 400, { error: "Undo the pairing before removing people." });
    db.people = db.people.filter((p) => key(p.name) !== key(body.name));
    save(db);
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: "Not found" });
}

// ---------- pages ----------
const STYLE = `
:root{--bg:#fbf6ef;--card:#fff;--ink:#2b2320;--muted:#7a6d66;--red:#c0392b;--red-d:#962d22;--green:#1e7a4c;--line:#eadfd3}
@media (prefers-color-scheme:dark){:root{--bg:#1a1514;--card:#251e1c;--ink:#f3ebe5;--muted:#b3a69e;--red:#e0574a;--red-d:#c0392b;--green:#4cc38a;--line:#3a2f2b}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:640px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:2rem;margin:0 0 4px}
.sub{color:var(--muted);margin:0 0 24px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;margin-bottom:20px}
h2{font-size:1.15rem;margin:0 0 12px}
label{display:block;font-size:.9rem;color:var(--muted);margin:10px 0 4px}
input{width:100%;padding:11px 12px;font:inherit;border:1px solid var(--line);border-radius:9px;background:var(--bg);color:var(--ink)}
input:focus{outline:2px solid var(--red);outline-offset:1px}
button{margin-top:14px;padding:11px 18px;font:inherit;font-weight:600;border:0;border-radius:9px;background:var(--red);color:#fff;cursor:pointer}
button:hover{background:var(--red-d)}
button.ghost{background:transparent;color:var(--muted);border:1px solid var(--line);font-weight:500}
button.big{width:100%;font-size:1.15rem;padding:16px}
button:disabled{opacity:.5;cursor:not-allowed}
.msg{margin-top:12px;min-height:1.5em;font-size:.95rem}
.err{color:var(--red)} .ok{color:var(--green)}
ul.names{list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:8px}
ul.names li{background:var(--bg);border:1px solid var(--line);border-radius:999px;padding:4px 12px;font-size:.95rem;display:flex;align-items:center;gap:6px}
ul.names li button{margin:0;padding:0 4px;background:none;color:var(--muted);font-weight:400}
.reveal{font-size:1.6rem;font-weight:700;color:var(--green);margin:8px 0 0}
.badge{display:inline-block;font-size:.8rem;padding:2px 10px;border-radius:999px;background:var(--line);color:var(--muted)}
a{color:var(--red)}
`;

const SCRIPT_HELPERS = `
async function post(url, data){
  const r = await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
  const j = await r.json().catch(()=>({error:"Something went wrong."}));
  if(!r.ok) throw new Error(j.error||"Something went wrong.");
  return j;
}
function say(el, text, ok){ el.textContent=text; el.className="msg "+(ok?"ok":"err"); }
function esc(s){ return s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
`;

const HOME = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Class Secret Santa</title><style>${STYLE}</style></head><body><main>
<h1>🎁 Class Secret Santa</h1>
<p class="sub">Add your name and pick a password. Once your teacher pairs everyone up, come back and use the same name and password to see who you're buying for.</p>

<section class="card" id="joinCard">
  <h2>1. Add your name</h2>
  <form id="join">
    <label for="jn">Your name</label><input id="jn" autocomplete="off" required maxlength="60">
    <label for="jp">Make up a password (don't forget it!)</label><input id="jp" type="password" required>
    <button>Add me</button>
    <div class="msg" id="jm"></div>
  </form>
</section>

<section class="card">
  <h2>2. See who you got</h2>
  <form id="reveal">
    <label for="rn">Your name</label><input id="rn" autocomplete="off" required>
    <label for="rp">Your password</label><input id="rp" type="password" required>
    <button>Show my Secret Santa</button>
    <div class="msg" id="rm"></div>
  </form>
</section>

<section class="card">
  <h2>Who's in <span class="badge" id="count">0</span> <span class="badge" id="state"></span></h2>
  <ul class="names" id="names"></ul>
</section>
</main>
<script>${SCRIPT_HELPERS}
const $=id=>document.getElementById(id);
async function refresh(){
  const s = await (await fetch("/api/status")).json();
  $("count").textContent = s.names.length;
  $("state").textContent = s.paired ? "Paired ✔" : "Waiting for teacher";
  $("names").innerHTML = s.names.map(n=>"<li>"+esc(n)+"</li>").join("") || "<li>No one yet</li>";
  $("joinCard").style.display = s.paired ? "none" : "";
}
$("join").onsubmit = async e=>{
  e.preventDefault();
  try{ await post("/api/join",{name:$("jn").value,password:$("jp").value});
       say($("jm"),"You're in, "+$("jn").value.trim()+"! Remember your password.",true);
       $("jn").value=""; $("jp").value=""; refresh(); }
  catch(err){ say($("jm"),err.message); }
};
$("reveal").onsubmit = async e=>{
  e.preventDefault();
  try{ const r = await post("/api/reveal",{name:$("rn").value,password:$("rp").value});
       $("rm").className="msg";
       $("rm").innerHTML = "Hi "+esc(r.name)+", you are Secret Santa for:<div class='reveal'>🎅 "+esc(r.giftee)+"</div><small>Shh — keep it a secret!</small>";
       $("rp").value=""; }
  catch(err){ say($("rm"),err.message); }
};
refresh(); setInterval(refresh, 5000);
</script></body></html>`;

const SUBMIT = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pair Everyone</title><style>${STYLE}</style></head><body><main>
<h1>🎄 Pair everyone up</h1>
<p class="sub">When every student has added their name on the <a href="/">main page</a>, press Submit. Each person gets someone random (never themselves). Students then see who they got using their name and password.</p>

<section class="card">
  <h2>Signed up <span class="badge" id="count">0</span> <span class="badge" id="state"></span></h2>
  <ul class="names" id="names"></ul>
</section>

<section class="card">
  <div id="adminWrap" style="display:none">
    <label for="admin">Teacher password</label><input id="admin" type="password">
  </div>
  <button class="big" id="submit">Submit &amp; pair everyone</button>
  <div class="msg" id="m"></div>
  <div id="resetWrap" style="display:none">
    <button class="ghost" id="repair">Undo pairing (keep names, reopen sign-ups)</button>
    <button class="ghost" id="wipe">Start over (delete everything)</button>
  </div>
</section>
</main>
<script>${SCRIPT_HELPERS}
const $=id=>document.getElementById(id);
let paired=false;
async function refresh(){
  const s = await (await fetch("/api/status")).json();
  paired = s.paired;
  $("adminWrap").style.display = s.adminPasswordRequired ? "" : "none";
  $("count").textContent = s.names.length;
  $("state").textContent = s.paired ? "Paired ✔" : "Not paired yet";
  $("names").innerHTML = s.names.map(n=>"<li>"+esc(n)+(s.paired?"":" <button title='Remove' data-n='"+esc(n)+"'>✕</button>")+"</li>").join("") || "<li>No one yet</li>";
  $("submit").disabled = s.paired || s.names.length<2;
  $("submit").textContent = s.paired ? "Everyone is paired ✔" : "Submit & pair everyone ("+s.names.length+")";
  $("resetWrap").style.display = s.paired || s.names.length ? "" : "none";
  $("repair").style.display = s.paired ? "" : "none";
}
$("names").onclick = async e=>{
  const n = e.target.dataset && e.target.dataset.n; if(!n) return;
  if(!confirm("Remove "+n+" from the list?")) return;
  try{ await post("/api/remove",{name:n,admin:$("admin").value}); refresh(); }
  catch(err){ say($("m"),err.message); }
};
$("submit").onclick = async ()=>{
  if(!confirm("Pair everyone now? Sign-ups will close.")) return;
  try{ const r = await post("/api/pair",{admin:$("admin").value});
       say($("m"),"Done! "+r.count+" students paired. Tell them to check the main page.",true); refresh(); }
  catch(err){ say($("m"),err.message); }
};
$("repair").onclick = async ()=>{
  if(!confirm("Undo the pairing? Students' current matches will be erased.")) return;
  try{ await post("/api/reset",{admin:$("admin").value,mode:"pairs"}); say($("m"),"Pairing undone. Sign-ups are open again.",true); refresh(); }
  catch(err){ say($("m"),err.message); }
};
$("wipe").onclick = async ()=>{
  if(!confirm("Delete ALL names and pairings? This can't be undone.")) return;
  try{ await post("/api/reset",{admin:$("admin").value,mode:"everything"}); say($("m"),"Everything cleared.",true); refresh(); }
  catch(err){ say($("m"),err.message); }
};
refresh(); setInterval(refresh, 5000);
</script></body></html>`;

// ---------- server ----------
http
  .createServer(async (req, res) => {
    const url = req.url.split("?")[0].replace(/\/+$/, "") || "/";
    try {
      if (url.startsWith("/api/")) return await api(req, res, url);
      if (url === "/") return html(res, HOME);
      if (url === "/submit") return html(res, SUBMIT);
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    } catch (e) {
      console.error(e);
      json(res, 500, { error: "Server error" });
    }
  })
  .listen(PORT, () => {
    console.log(`Secret Santa running:  http://localhost:${PORT}`);
    console.log(`Teacher pairing page:  http://localhost:${PORT}/submit`);
    if (!ADMIN_PASSWORD) console.log("Tip: set ADMIN_PASSWORD=... so students can't press Submit themselves.");
  });
