// Shared code for both pages: database access + encryption.
//
// How secrecy works without a server:
//  - When a student joins, their browser makes a key pair. The private key is
//    locked with their password; only the locked version is saved.
//  - When the teacher presses Submit, the teacher's browser writes each
//    student's match encrypted with that student's public key.
//  - Only someone with the student's password can unlock it, so even reading
//    the database directly doesn't reveal who got whom.

const DB = ((window.SANTA_CONFIG || {}).databaseURL || "").trim().replace(/\/+$/, "");
const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------- database (Firebase Realtime Database REST API) ----------
async function dbGet(path) {
  const r = await fetch(`${DB}/${path}.json`, { cache: "no-store" });
  if (!r.ok) throw new Error("Couldn't reach the database.");
  return r.json();
}
async function dbPut(path, value) {
  const r = await fetch(`${DB}/${path}.json`, { method: "PUT", body: JSON.stringify(value) });
  if (r.status === 401 || r.status === 403) throw new Error("DENIED");
  if (!r.ok) throw new Error("Couldn't save to the database.");
  return r.json();
}
async function getState() {
  const s = (await dbGet("")) || {};
  const people = Object.entries(s.people || {})
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => a.at - b.at);
  return { people, pairs: s.pairs || null, admin: s.admin || null };
}

// ---------- helpers ----------
const norm = (s) => String(s || "").trim().replace(/\s+/g, " ");
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function idFor(name) {
  const h = await crypto.subtle.digest("SHA-256", enc.encode(norm(name).toLowerCase()));
  return [...new Uint8Array(h)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function passwordKey(password, salt) {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 200000, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
}
async function passwordHash(password, salt) {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return b64(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 200000, hash: "SHA-256" }, base, 256));
}
const RSA = { name: "RSA-OAEP", hash: "SHA-256" };

// ---------- actions ----------
async function joinSanta(name, password) {
  name = norm(name);
  if (!name) throw new Error("Please type your name.");
  if (name.length > 40) throw new Error("Please use a shorter name (40 letters max).");
  if (password.length < 3) throw new Error("Pick a password with at least 3 characters.");

  const id = await idFor(name);
  const state = await getState();
  if (state.pairs) throw new Error("Names are already paired, so sign-ups are closed.");
  if (state.people.some((p) => p.id === id)) throw new Error(`"${name}" is already on the list.`);

  const pair = await crypto.subtle.generateKey({ ...RSA, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ["encrypt", "decrypt"]);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const lock = await passwordKey(password, salt);
  const priv = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, lock, await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  try {
    await dbPut(`people/${id}`, {
      name, at: Date.now(),
      pub: b64(await crypto.subtle.exportKey("spki", pair.publicKey)),
      priv: b64(priv), salt: b64(salt), iv: b64(iv),
    });
  } catch (e) {
    if (e.message === "DENIED") throw new Error("Couldn't add you. That name may already be taken, or sign-ups are closed.");
    throw e;
  }
  return name;
}

async function revealSanta(name, password) {
  const id = await idFor(name);
  const state = await getState();
  const me = state.people.find((p) => p.id === id);
  if (!me) throw new Error("Name or password is wrong.");
  let privKey;
  try {
    const lock = await passwordKey(password, unb64(me.salt));
    const pkcs8 = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(me.iv) }, lock, unb64(me.priv));
    privKey = await crypto.subtle.importKey("pkcs8", pkcs8, RSA, false, ["decrypt"]);
  } catch {
    throw new Error("Name or password is wrong.");
  }
  if (!state.pairs || !state.pairs[id]) return { name: me.name, giftee: null };
  const giftee = dec.decode(await crypto.subtle.decrypt(RSA, privKey, unb64(state.pairs[id])));
  return { name: me.name, giftee };
}

async function setTeacherPassword(password) {
  if (password.length < 4) throw new Error("Use at least 4 characters for the teacher password.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  try {
    await dbPut("admin", { salt: b64(salt), hash: await passwordHash(password, salt) });
  } catch (e) {
    if (e.message === "DENIED") throw new Error("A teacher password is already set.");
    throw e;
  }
}

async function pairEveryone(teacherPassword) {
  const state = await getState();
  if (state.pairs) throw new Error("Already paired.");
  if (!state.admin) throw new Error("Set a teacher password first.");
  if ((await passwordHash(teacherPassword, unb64(state.admin.salt))) !== state.admin.hash)
    throw new Error("Wrong teacher password.");
  const people = state.people;
  if (people.length < 2) throw new Error("Need at least 2 people to pair up.");

  // Shuffle into one big circle; each person gives to the next. Nobody gets themselves.
  const order = [...people];
  for (let i = order.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const pairs = {};
  for (let i = 0; i < order.length; i++) {
    const giver = order[i];
    const giftee = order[(i + 1) % order.length];
    const pub = await crypto.subtle.importKey("spki", unb64(giver.pub), RSA, false, ["encrypt"]);
    pairs[giver.id] = b64(await crypto.subtle.encrypt(RSA, pub, enc.encode(giftee.name)));
  }
  try {
    await dbPut("pairs", pairs);
  } catch (e) {
    if (e.message === "DENIED") throw new Error("Already paired.");
    throw e;
  }
  return people.length;
}

// ---------- UI bits ----------
function say(el, text, ok) {
  el.textContent = text;
  el.className = "msg " + (ok ? "ok" : "err");
}
function busy(btn, on, label) {
  btn.disabled = on;
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || "Working…"; }
  else if (btn.dataset.label) btn.textContent = btn.dataset.label;
}
function checkConfigured() {
  if (DB) return true;
  document.querySelector("main").innerHTML =
    '<h1>Almost ready 🎁</h1><div class="card"><p>This site isn\'t connected to a database yet.</p>' +
    "<p>Open <code>config.js</code> and paste your Firebase database URL, following the steps in <code>README.md</code>.</p></div>";
  return false;
}
