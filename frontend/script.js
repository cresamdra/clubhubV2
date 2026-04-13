/* ═══════════════════════════════════════════════════
   ClubHub — script.js
═══════════════════════════════════════════════════ */

// ─────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────
let currentUser  = null;
let selectedRole = "user";
let reqFilter    = "all";
let calYear, calMonth, calSelected;
let reviewingId  = null;
let _calEvents   = [];
let _members     = [];
let _requests    = [];

// Chart instances (kept so we can destroy & re-draw on re-visit)
let _chartStatus  = null;
let _chartMonthly = null;
let _chartVenues  = null;
let _chartMembers = null;

// ── Notification state ──
let _pollTimer     = null;
let _knownRequests = null;
let _isPolling     = false;

// ─────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────
const $ = id => document.getElementById(id);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const pad = n => String(n).padStart(2, "0");

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function fmtDate(s) {
  if (!s) return "—";
  const [y, m, d] = s.split("-");
  const mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${mo[parseInt(m)-1]} ${parseInt(d)}, ${y}`;
}

// ── TOAST ──────────────────────────────
function showToast(msg, isError = false) {
  const container = $("toastContainer");
  if (!container) return;
  const t = document.createElement("div");
  t.className = "toast" + (isError ? " error" : "");
  t.innerHTML = `<i class="fa-solid fa-${isError ? "circle-exclamation" : "circle-check"}"></i> ${msg}`;
  container.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transform = "translateY(8px)"; t.style.transition = ".3s"; }, 2700);
  setTimeout(() => t.remove(), 3100);
}

function showFormError(containerId, msgId, msg) {
  const el = $(containerId); if (el) el.style.display = "flex";
  const m  = $(msgId);      if (m)  m.textContent = msg;
}
function hideFormError(containerId) {
  const el = $(containerId); if (el) el.style.display = "none";
}

// ─────────────────────────────────────────
//  THEME
// ─────────────────────────────────────────
function setTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem("ch-theme", t);
}
(function initTheme() {
  const saved = localStorage.getItem("ch-theme") || "dark";
  document.documentElement.setAttribute("data-theme", saved);
})();

// ─────────────────────────────────────────
//  AUTH
// ─────────────────────────────────────────
function showRegister() {
  $("loginScreen").classList.add("hidden");
  $("registerScreen").classList.remove("hidden");
}
function showLogin() {
  $("registerScreen").classList.add("hidden");
  $("loginScreen").classList.remove("hidden");
  hideFormError("loginError");
}
function selectRole(role, btn) {
  selectedRole = role;
  document.querySelectorAll(".role-tab").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
}
function togglePw(inputId, btn) {
  const inp = $(inputId);
  const isText = inp.type === "text";
  inp.type = isText ? "password" : "text";
  btn.innerHTML = isText
    ? `<i class="fa-regular fa-eye"></i>`
    : `<i class="fa-regular fa-eye-slash"></i>`;
}

// ─────────────────────────────────────────
//  LOGIN / REGISTER
// ─────────────────────────────────────────
function handleLogin() {
  const email = $("loginEmail").value.trim().toLowerCase();
  const pass  = $("loginPassword").value;
  if (!email || !pass) {
    showFormError("loginError", "loginErrMsg", "Please enter your email and password."); return;
  }
  fetch("http://localhost:3000/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: email, password: pass })
  })
  .then(r => r.json())
  .then(data => {
    if (data.error) { showFormError("loginError", "loginErrMsg", data.error); return; }
    currentUser    = data.user;
    currentUser.id = Number(currentUser.id);

    const isAdmin    = currentUser.role === "admin";
    const wantsAdmin = selectedRole === "admin";
    if (isAdmin !== wantsAdmin) {
      showFormError("loginError", "loginErrMsg",
        `This account is not a ${cap(wantsAdmin ? "admin" : "member")}.`); return;
    }
    hideFormError("loginError");
    bootApp();
  })
  .catch(() => showFormError("loginError", "loginErrMsg", "Server error. Is the server running?"));
}

function handleRegister() {
  const first   = $("regFirst").value.trim();
  const last    = $("regLast").value.trim();
  const email   = $("regEmail").value.trim().toLowerCase();
  const pass    = $("regPassword").value;
  const confirm = $("regConfirm").value;

  if (!first || !last || !email || !pass || !confirm) {
    showFormError("regError", "regErrMsg", "Please fill in all fields."); return;
  }
  if (pass.length < 6) {
    showFormError("regError", "regErrMsg", "Password must be at least 6 characters."); return;
  }
  if (pass !== confirm) {
    showFormError("regError", "regErrMsg", "Passwords do not match."); return;
  }
  fetch("http://localhost:3000/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ firstName: first, lastName: last, email, password: pass })
  })
  .then(r => r.json())
  .then(data => {
    if (data.error) { showFormError("regError", "regErrMsg", data.error); return; }
    hideFormError("regError");
    showToast(`Welcome, ${first}! Signing you in...`);
    fetch("http://localhost:3000/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: email, password: pass })
    })
    .then(r => r.json())
    .then(ld => {
      if (ld.error) { showLogin(); return; }
      currentUser    = ld.user;
      currentUser.id = Number(ld.user.id);
      bootApp();
    });
  })
  .catch(() => showFormError("regError", "regErrMsg", "Server error. Try again."));
}

// ─────────────────────────────────────────
//  BOOT APP
// ─────────────────────────────────────────
function bootApp() {
  $("loginScreen").classList.add("hidden");
  $("registerScreen").classList.add("hidden");
  $("appShell").classList.remove("hidden");

  const init  = `${currentUser.firstName[0]}${currentUser.lastName[0]}`.toUpperCase();
  const h     = new Date().getHours();
  const greet = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";

  $("suAvatar").textContent    = init;
  $("suName").textContent      = `${currentUser.firstName} ${currentUser.lastName}`;
  $("suRole").textContent      = currentUser.role === "admin" ? "Admin" : "Member";
  $("topGreeting").textContent = `${greet}, ${currentUser.firstName}!`;
  $("topAvatar").textContent   = init;

  const isAdmin = currentUser.role === "admin";
  document.querySelectorAll(".admin-only").forEach(el  => el.classList.toggle("hidden", !isAdmin));
  document.querySelectorAll(".member-only").forEach(el => el.classList.toggle("hidden",  isAdmin));

  const now   = new Date();
  calYear     = now.getFullYear();
  calMonth    = now.getMonth();
  calSelected = todayStr();

  _knownRequests = null;
  _isPolling     = false;

  const badge = $("notifCount");
  if (badge) { badge.textContent = "0"; badge.classList.add("hidden"); }
  const list = $("notifList");
  if (list) list.innerHTML = `<div class="nd-empty">No notifications</div>`;

  showTab("dashboard", document.querySelector(".nav-link"));

  fetchRequests().then(() => { startPolling(); });
  fetchCalendar();
  if (isAdmin) fetchMembers();
}

// ─────────────────────────────────────────
//  LOGOUT
// ─────────────────────────────────────────
function handleLogout() {
  stopPolling();
  currentUser    = null;
  _requests      = [];
  _calEvents     = [];
  _members       = [];
  reqFilter      = "all";
  _knownRequests = null;
  _isPolling     = false;

  // Destroy charts so they don't linger
  [_chartStatus, _chartMonthly, _chartVenues, _chartMembers].forEach(c => { if (c) c.destroy(); });
  _chartStatus = _chartMonthly = _chartVenues = _chartMembers = null;

  $("appShell").classList.add("hidden");
  $("loginScreen").classList.remove("hidden");
  $("loginEmail").value    = "";
  $("loginPassword").value = "";

  const badge = $("notifCount");
  if (badge) { badge.textContent = "0"; badge.classList.add("hidden"); }
  const notifList = $("notifList");
  if (notifList) notifList.innerHTML = `<div class="nd-empty">No notifications</div>`;

  closeAllDropdowns();
}

// ═══════════════════════════════════════════════════════════
//  NOTIFICATION SYSTEM
// ═══════════════════════════════════════════════════════════
function buildSnapshot(requests) {
  const snap = {};
  requests.forEach(r => {
    snap[Number(r.id)] = { status: r.status, comment: r.comment || "" };
  });
  return snap;
}

function startPolling() {
  stopPolling();
  _pollTimer = setInterval(doPoll, 2000);
}
function stopPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

function doPoll() {
  if (!currentUser || _knownRequests === null || _isPolling) return;
  _isPolling = true;

  fetch("http://localhost:3000/api/requests")
    .then(r => r.json())
    .then(data => {
      const fresh   = data.requests || [];
      const isAdmin = currentUser.role === "admin";

      fresh.forEach(r => {
        const id      = Number(r.id);
        const ownerId = Number(r.submittedBy);
        const known   = _knownRequests[id];

        if (known === undefined) {
          if (isAdmin) {
            const name = (r.firstName && r.lastName) ? `${r.firstName} ${r.lastName}` : "A member";
            pushNotif(`📋 New request from <strong>${name}</strong>: "<em>${r.title}</em>"`, "new", id);
            showToast(`New request from ${name}!`);
            pulseBell();
          }
        } else {
          const statusChanged  = known.status  !== r.status;
          const commentChanged = (known.comment || "") !== (r.comment || "");

          if ((statusChanged || commentChanged) && !isAdmin && ownerId === currentUser.id) {
            if (r.status === "approved") {
              pushNotif(`✅ Your request "<strong>${r.title}</strong>" was <strong>Approved</strong>!`, "approved", id);
              showToast(`"${r.title}" was Approved! 🎉`);
              pulseBell();
            } else if (r.status === "rejected") {
              pushNotif(`❌ Your request "<strong>${r.title}</strong>" was <strong>Rejected</strong>.`, "rejected", id);
              showToast(`"${r.title}" was Rejected.`, true);
              pulseBell();
            } else if (r.status === "revision") {
              pushNotif(`🔄 Your request "<strong>${r.title}</strong>" needs <strong>Revision</strong>.`, "revision", id);
              showToast(`"${r.title}" needs Revision.`);
              pulseBell();
            } else if (statusChanged) {
              pushNotif(`Your request "<strong>${r.title}</strong>" status changed to: <strong>${cap(r.status)}</strong>`, "info", id);
              pulseBell();
            }
          }
        }
      });

      _knownRequests = buildSnapshot(fresh);

      const freshSig   = fresh.map(r => `${r.id}:${r.status}:${r.comment||""}`).join("|");
      const currentSig = _requests.map(r => `${r.id}:${r.status}:${r.comment||""}`).join("|");
      if (freshSig !== currentSig) {
        _requests = fresh;
        renderRequests(_requests);
        updateDashboard();
      }
    })
    .catch(() => {})
    .finally(() => { _isPolling = false; });
}

// ─────────────────────────────────────────
//  PUSH NOTIFICATION INTO BELL DROPDOWN
// ─────────────────────────────────────────
function pushNotif(msg, type = "info", requestId = null) {
  const list  = $("notifList");
  const badge = $("notifCount");
  if (!list || !badge) return;

  const empty = list.querySelector(".nd-empty");
  if (empty) empty.remove();

  const iconColor = type === "approved" ? "var(--green)"
                  : type === "rejected" ? "var(--red)"
                  : type === "revision" ? "var(--teal)"
                  : type === "new"      ? "var(--blue)"
                  : "var(--accent)";

  const item     = document.createElement("div");
  item.className = "nd-item" + (requestId ? " nd-item-clickable" : "");
  item.innerHTML = `
    <i class="fa-solid fa-circle-dot" style="color:${iconColor};font-size:.5rem;flex-shrink:0;margin-top:4px"></i>
    <span style="flex:1">${msg}</span>
    ${requestId ? `<i class="fa-solid fa-chevron-right" style="font-size:.55rem;color:var(--muted);flex-shrink:0"></i>` : ""}
  `;

  if (requestId) {
    item.addEventListener("click", () => {
      $("notifDrop").classList.add("hidden");
      const reqLink = document.querySelector(".nav-link[onclick*=\"requests\"]");
      showTab("requests", reqLink);
      setTimeout(() => {
        if (currentUser.role === "admin") openReview(requestId);
        else openViewModal(requestId);
      }, 120);
      item.style.opacity = "0.55";
      item.classList.remove("nd-item-clickable");
      item.style.cursor = "default";
      item.style.pointerEvents = "none";
    });
  }

  list.prepend(item);
  const curr = parseInt(badge.textContent) || 0;
  badge.textContent = curr + 1;
  badge.classList.remove("hidden");
}

function pulseBell() {
  const btn = $("bellBtn");
  if (!btn) return;
  btn.classList.remove("bell-pulse");
  void btn.offsetWidth;
  btn.classList.add("bell-pulse");
  setTimeout(() => btn.classList.remove("bell-pulse"), 600);
}

// ─────────────────────────────────────────
//  TAB NAVIGATION
// ─────────────────────────────────────────
function showTab(name, linkEl) {
  document.querySelectorAll(".tab").forEach(t => {
    t.classList.remove("active");
    t.classList.add("hidden");
  });
  const target = $(`tab-${name}`);
  if (target) { target.classList.remove("hidden"); target.classList.add("active"); }
  document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
  if (linkEl) linkEl.classList.add("active");

  if (name === "dashboard") updateDashboard();
  if (name === "calendar")  fetchCalendar();
  if (name === "members")   fetchMembers();
  if (name === "reports")   fetchReports();
}

// ─────────────────────────────────────────
//  SIDEBAR / TOPBAR TOGGLES
// ─────────────────────────────────────────
function toggleSidebar() { $("sidebar").classList.toggle("open"); }

function toggleNotif() {
  $("dotMenu").classList.add("hidden");
  $("notifDrop").classList.toggle("hidden");
}
function toggleDotMenu() {
  $("notifDrop").classList.add("hidden");
  $("dotMenu").classList.toggle("hidden");
}
function closeDotMenu() { $("dotMenu").classList.add("hidden"); }
function closeAllDropdowns() {
  ["notifDrop","dotMenu"].forEach(id => { const el = $(id); if (el) el.classList.add("hidden"); });
}

document.addEventListener("click", function(e) {
  if (!e.target.closest("#bellWrap"))  $("notifDrop") && $("notifDrop").classList.add("hidden");
  if (!e.target.closest(".dot-wrap")) $("dotMenu")   && $("dotMenu").classList.add("hidden");
  if (!e.target.closest(".sidebar") && !e.target.closest(".hamburger"))
    $("sidebar") && $("sidebar").classList.remove("open");
});

// ─────────────────────────────────────────
//  API: REQUESTS
// ─────────────────────────────────────────
function fetchRequests() {
  return fetch("http://localhost:3000/api/requests")
    .then(r => r.json())
    .then(data => {
      _requests = data.requests || [];
      if (_knownRequests === null) {
        _knownRequests = buildSnapshot(_requests);
      }
      renderRequests(_requests);
      updateDashboard();
    })
    .catch(err => console.error("fetchRequests:", err));
}

function renderRequests(requests) {
  const isAdmin = currentUser.role === "admin";
  let list = isAdmin
    ? requests
    : requests.filter(r => Number(r.submittedBy) === currentUser.id);

  if (reqFilter !== "all") list = list.filter(r => r.status === reqFilter);

  const headCols = `<th>#</th><th>Event Title</th>${isAdmin ? "<th>Submitted By</th>" : ""}<th>Date</th><th>Location</th><th>Status</th><th>Action</th>`;
  $("reqHead").innerHTML = `<tr>${headCols}</tr>`;

  if (!list.length) {
    $("reqBody").innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--muted)">No requests found.</td></tr>`;
    return;
  }

  $("reqBody").innerHTML = list.map((r, i) => {
    const byName = r.firstName ? `${r.firstName} ${r.lastName}` : (r.submittedByName || "—");
    let actionBtn;
    if (isAdmin) {
      actionBtn = `<button class="btn-view" onclick="openReview(${r.id})"><i class="fa-solid fa-eye"></i> Review</button>`;
    } else if (r.status === "revision") {
      actionBtn = `
        <div style="display:flex;gap:.35rem">
          <button class="btn-view" onclick="openViewModal(${r.id})"><i class="fa-solid fa-eye"></i> View</button>
          <button class="btn-edit" onclick="openEditModal(${r.id})"><i class="fa-solid fa-pen"></i> Edit</button>
        </div>`;
    } else {
      actionBtn = `<button class="btn-view" onclick="openViewModal(${r.id})"><i class="fa-solid fa-eye"></i> View</button>`;
    }
    const byCol = isAdmin ? `<td>${byName}</td>` : "";
    return `<tr>
      <td>${i+1}</td>
      <td>${r.title}</td>
      ${byCol}
      <td>${fmtDate(r.date)}</td>
      <td>${r.venue || "—"}</td>
      <td><span class="pill ${r.status}">${cap(r.status)}</span></td>
      <td>${actionBtn}</td>
    </tr>`;
  }).join("");
}

function filterReqs(filter, btn) {
  reqFilter = filter;
  document.querySelectorAll(".ftab").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  renderRequests(_requests);
}

// ─────────────────────────────────────────
//  SUBMIT REQUEST (Member)
// ─────────────────────────────────────────
function openEventModal() {
  $("evTitle").value = "";
  $("evDate").value  = "";
  $("evVenue").value = "";
  $("evDesc").value  = "";
  $("evError").style.display = "none";
  $("eventModal").classList.remove("hidden");
}

function submitEventRequest() {
  const title = $("evTitle").value.trim();
  const date  = $("evDate").value;
  const venue = $("evVenue").value.trim();
  const desc  = $("evDesc").value.trim();

  if (!title || !date || !venue) { $("evError").style.display = "flex"; return; }
  $("evError").style.display = "none";

  fetch("http://localhost:3000/api/requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, date, venue, desc, submittedBy: currentUser.id })
  })
  .then(r => r.json())
  .then(data => {
    if (data.error) { console.error(data.error); return; }
    closeModal("eventModal");
    fetchRequests();
    showToast("Request submitted! Awaiting admin review.");
  })
  .catch(err => console.error(err));
}

// ─────────────────────────────────────────
//  ADMIN REVIEW MODAL
// ─────────────────────────────────────────
function openReview(id) {
  reviewingId = null;
  const r = _requests.find(x => Number(x.id) === Number(id));
  if (!r) { showToast("Request not found.", true); return; }
  reviewingId = Number(id);

  const byName = r.firstName ? `${r.firstName} ${r.lastName}` : "—";

  let actionBtns = "";
  if (r.status === "approved") {
    actionBtns = `
      <button class="btn-revision" onclick="adminDecision('revision')"><i class="fa-solid fa-rotate-left"></i> Request Revision</button>
      <button class="btn-reject"   onclick="adminDecision('rejected')"><i class="fa-solid fa-xmark"></i> Reject</button>
      <button class="btn-delete"   onclick="adminDeleteRequest(${r.id})"><i class="fa-solid fa-trash"></i> Delete</button>`;
  } else if (r.status === "rejected") {
    actionBtns = `
      <button class="btn-approve"  onclick="adminDecision('approved')"><i class="fa-solid fa-check"></i> Approve</button>
      <button class="btn-revision" onclick="adminDecision('revision')"><i class="fa-solid fa-rotate-left"></i> Request Revision</button>
      <button class="btn-delete"   onclick="adminDeleteRequest(${r.id})"><i class="fa-solid fa-trash"></i> Delete</button>`;
  } else {
    actionBtns = `
      <button class="btn-approve"  onclick="adminDecision('approved')"><i class="fa-solid fa-check"></i> Approve</button>
      <button class="btn-revision" onclick="adminDecision('revision')"><i class="fa-solid fa-rotate-left"></i> Request Revision</button>
      <button class="btn-reject"   onclick="adminDecision('rejected')"><i class="fa-solid fa-xmark"></i> Reject</button>
      <button class="btn-delete"   onclick="adminDeleteRequest(${r.id})"><i class="fa-solid fa-trash"></i> Delete</button>`;
  }

  $("reviewDetails").innerHTML = `
    <div class="rd-row"><span class="rd-label">Title</span><span class="rd-val">${r.title}</span></div>
    <div class="rd-row"><span class="rd-label">Date</span><span class="rd-val">${fmtDate(r.date)}</span></div>
    <div class="rd-row"><span class="rd-label">Venue</span><span class="rd-val">${r.venue || "—"}</span></div>
    <div class="rd-row"><span class="rd-label">By</span><span class="rd-val">${byName}</span></div>
    <div class="rd-row"><span class="rd-label">Status</span><span class="rd-val"><span class="pill ${r.status}">${cap(r.status)}</span></span></div>
    ${r.desc    ? `<div class="rd-desc">${r.desc}</div>` : ""}
    ${r.comment ? `<div class="admin-comment-box"><div class="admin-comment-lbl"><i class="fa-solid fa-comment"></i> Previous Comment</div><div class="admin-comment-text">${r.comment}</div></div>` : ""}
  `;
  $("reviewComment").value = r.comment || "";

  const actionsEl = $("reviewModal").querySelector(".review-actions");
  if (actionsEl) actionsEl.innerHTML = actionBtns;

  $("reviewModal").classList.remove("hidden");
}

function adminDecision(status) {
  if (!reviewingId) { showToast("No request selected.", true); return; }
  const comment = $("reviewComment").value.trim();
  if (status === "revision" && !comment) {
    showToast("Please add a comment when requesting revision.", true); return;
  }

  fetch(`http://localhost:3000/api/requests/${reviewingId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, comment })
  })
  .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
  .then(data => {
    if (data.error) { showToast(data.error, true); return; }
    reviewingId = null;
    closeModal("reviewModal");
    fetchRequests();
    fetchCalendar();
    showToast(`Request marked as ${cap(status)}.`);
  })
  .catch(err => { console.error("adminDecision error:", err); showToast("Server error.", true); });
}

function adminDeleteRequest(id) {
  if (!confirm("Delete this request permanently?")) return;
  fetch(`http://localhost:3000/api/requests/${id}`, { method: "DELETE" })
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(data => {
      if (data.error) { showToast(data.error, true); return; }
      reviewingId = null;
      closeModal("reviewModal");
      fetchRequests();
      fetchCalendar();
      showToast("Request deleted.");
    })
    .catch(err => { console.error("adminDeleteRequest error:", err); showToast("Server error.", true); });
}

// ─────────────────────────────────────────
//  MEMBER VIEW MODAL
// ─────────────────────────────────────────
function openViewModal(id) {
  const r = _requests.find(x => Number(x.id) === Number(id));
  if (!r) return;

  const editBtn = r.status === "revision"
    ? `<button class="btn-edit-inline" onclick="closeModal('viewModal');openEditModal(${r.id})">
        <i class="fa-solid fa-pen"></i> Edit & Resubmit
       </button>`
    : "";

  $("viewDetails").innerHTML = `
    <div class="review-detail-card">
      <div class="rd-row"><span class="rd-label">Title</span><span class="rd-val">${r.title}</span></div>
      <div class="rd-row"><span class="rd-label">Date</span><span class="rd-val">${fmtDate(r.date)}</span></div>
      <div class="rd-row"><span class="rd-label">Venue</span><span class="rd-val">${r.venue || "—"}</span></div>
      <div class="rd-row"><span class="rd-label">Status</span><span class="rd-val"><span class="pill ${r.status}">${cap(r.status)}</span></span></div>
      ${r.desc ? `<div class="rd-desc">${r.desc}</div>` : ""}
      ${r.comment
        ? `<div class="admin-comment-box" style="margin-top:.5rem"><div class="admin-comment-lbl"><i class="fa-solid fa-comment"></i> Admin Comment</div><div class="admin-comment-text">${r.comment}</div></div>`
        : `<div style="margin-top:.5rem;font-size:.8rem;color:var(--muted)">No admin comment yet.</div>`}
    </div>
    ${editBtn}`;
  $("viewModal").classList.remove("hidden");
}

// ─────────────────────────────────────────
//  EDIT REQUEST MODAL
// ─────────────────────────────────────────
function openEditModal(id) {
  const r = _requests.find(x => Number(x.id) === Number(id));
  if (!r) return;

  $("editReqId").value    = r.id;
  $("editTitle").value    = r.title;
  $("editDate").value     = r.date;
  $("editVenue").value    = r.venue || "";
  $("editDesc").value     = r.desc  || "";
  $("editError").style.display = "none";

  const commentBox = $("editCommentBox");
  if (r.comment) {
    commentBox.innerHTML = `
      <div class="admin-comment-lbl"><i class="fa-solid fa-comment"></i> Admin's Revision Note</div>
      <div class="admin-comment-text">${r.comment}</div>`;
    commentBox.style.display = "block";
  } else {
    commentBox.style.display = "none";
  }

  $("editModal").classList.remove("hidden");
}

function submitEditRequest() {
  const id    = Number($("editReqId").value);
  const title = $("editTitle").value.trim();
  const date  = $("editDate").value;
  const venue = $("editVenue").value.trim();
  const desc  = $("editDesc").value.trim();

  if (!title || !date || !venue) {
    $("editError").style.display = "flex"; return;
  }
  $("editError").style.display = "none";

  fetch(`http://localhost:3000/api/requests/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, date, venue, desc, status: "pending", comment: "" })
  })
  .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
  .then(data => {
    if (data.error) { showToast(data.error, true); return; }
    closeModal("editModal");
    fetchRequests();
    showToast("Request resubmitted! Awaiting admin review.");
  })
  .catch(err => { console.error("submitEditRequest:", err); showToast("Server error.", true); });
}

// ─────────────────────────────────────────
//  MODAL HELPERS
// ─────────────────────────────────────────
function closeModal(id) { $(id).classList.add("hidden"); }
function bgClose(e, id) { if (e.target === $(id)) closeModal(id); }

// ─────────────────────────────────────────
//  DASHBOARD
// ─────────────────────────────────────────
function updateDashboard() {
  const isAdmin = currentUser.role === "admin";
  const mine    = isAdmin
    ? _requests
    : _requests.filter(r => Number(r.submittedBy) === currentUser.id);

  $("statTotal").textContent    = mine.length;
  $("statPending").textContent  = mine.filter(r => r.status === "pending").length;
  $("statResolved").textContent = mine.filter(r => r.status === "approved" || r.status === "rejected").length;

  if (isAdmin && $("statMembers")) $("statMembers").textContent = _members.length;

  let activityList;
  if (isAdmin) {
    activityList = [..._requests].slice(0, 6);
  } else {
    const approvedAll = _requests.filter(r => r.status === "approved");
    const ownOther    = _requests.filter(r => Number(r.submittedBy) === currentUser.id && r.status !== "approved");
    activityList = [...approvedAll, ...ownOther].sort((a,b) => (b.ts||0)-(a.ts||0)).slice(0, 6);
  }

  const act = $("recentActivity");
  if (!activityList.length) {
    act.innerHTML = `<div class="no-events">No activity yet.</div>`;
  } else {
    act.innerHTML = activityList.map(r => {
      const dotClass = r.status === "approved" ? "approved"
                     : r.status === "rejected" ? "rejected"
                     : r.status === "revision" ? "revision" : "pending";
      return `<div class="act-row">
        <div class="dot ${dotClass}"></div>
        <div class="act-body">
          <div class="act-title">${r.title}</div>
          <div class="act-time"><span class="ev-label">When:</span> ${fmtDate(r.date)}</div>
          <div class="act-time"><span class="ev-label">Where:</span> ${r.venue || "—"}</div>
          <div class="act-time"><span class="ev-label">Status:</span> <span class="pill ${r.status}" style="font-size:.64rem;padding:1px 7px">${cap(r.status)}</span></div>
        </div>
      </div>`;
    }).join("");
  }

  const pending = _requests.filter(r => r.status === "pending").length;
  const badge   = $("reqBadge");
  if (badge) { badge.textContent = pending; badge.classList.toggle("hidden", pending === 0); }
}

// ─────────────────────────────────────────
//  CALENDAR
// ─────────────────────────────────────────
function fetchCalendar() {
  fetch("http://localhost:3000/api/calendar")
    .then(r => r.json())
    .then(data => { _calEvents = data.events || []; renderCalendar(_calEvents); })
    .catch(() => {
      _calEvents = _requests
        .filter(r => r.status === "approved" && r.date)
        .map(r => ({ title: r.title, date: r.date, venue: r.venue, status: "approved" }));
      renderCalendar(_calEvents);
    });
}

function renderCalendar(events = []) {
  const grid  = $("calGrid");
  const label = $("calMonthLbl");
  if (!grid || !label) return;

  const monthNames = ["January","February","March","April","May","June",
                      "July","August","September","October","November","December"];
  label.textContent = `${monthNames[calMonth]} ${calYear}`;

  const firstDay    = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();
  const today       = todayStr();

  const evByDate = {};
  events.forEach(ev => {
    if (!evByDate[ev.date]) evByDate[ev.date] = [];
    evByDate[ev.date].push(ev);
  });
  _requests.filter(r => r.status === "approved" && r.date).forEach(r => {
    if (!evByDate[r.date]) evByDate[r.date] = [];
    if (!evByDate[r.date].find(e => e.title === r.title))
      evByDate[r.date].push({ title: r.title, date: r.date, venue: r.venue, status: "approved" });
  });

  let html = "";
  for (let i = 0; i < firstDay; i++) html += `<div class="cal-day other-month"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr    = `${calYear}-${pad(calMonth+1)}-${pad(d)}`;
    const isToday    = dateStr === today;
    const isSelected = dateStr === calSelected;
    const dayEvs     = evByDate[dateStr] || [];
    const hasEvent   = dayEvs.length > 0;
    const dots       = dayEvs.slice(0,3).map(() => `<span class="cal-dot approved-dot"></span>`).join("");

    let cls = "cal-day";
    if (isSelected)               cls += " selected";
    else if (isToday && hasEvent) cls += " today has-event";
    else if (isToday)             cls += " today";
    else if (hasEvent)            cls += " has-event";

    html += `<div class="${cls}" onclick="selectCalDay('${dateStr}')">
      ${d}
      ${dots ? `<div class="cal-day-dots">${dots}</div>` : ""}
    </div>`;
  }
  grid.innerHTML = html;

  const calCard = grid.closest(".cal-card");
  let addBtn = calCard.querySelector(".cal-add-btn");
  if (currentUser.role === "admin") {
    if (!addBtn) {
      addBtn = document.createElement("button");
      addBtn.className = "cal-add-btn";
      addBtn.innerHTML = `<i class="fa-solid fa-plus"></i> Add Event`;
      addBtn.onclick   = () => openCalModal();
      calCard.appendChild(addBtn);
    }
  } else {
    if (addBtn) addBtn.remove();
  }

  selectCalDay(calSelected, false);
}

function selectCalDay(dateStr, rerender = true) {
  calSelected = dateStr;
  if (rerender) { renderCalendar(_calEvents); return; }

  const title = $("calEvtTitle");
  const list  = $("calEvtList");
  if (!title || !list) return;

  title.textContent = fmtDate(dateStr);

  const seen = new Set();
  const combined = [];

  _calEvents.filter(ev => ev.date === dateStr).forEach(ev => {
    const key = `${ev.title}|${ev.date}`;
    if (!seen.has(key)) { seen.add(key); combined.push(ev); }
  });
  _requests.filter(r => r.date === dateStr && r.status === "approved").forEach(r => {
    const key = `${r.title}|${r.date}`;
    if (!seen.has(key)) { seen.add(key); combined.push(r); }
  });

  if (!combined.length) {
    list.innerHTML = `<div class="no-events">No events on this date.</div>`;
    return;
  }

  list.innerHTML = combined.map(ev => `
    <div class="act-row">
      <div class="dot approved"></div>
      <div class="act-body">
        <div class="act-title">${ev.title}</div>
        <div class="act-time"><span class="ev-label">When:</span> ${fmtDate(ev.date)}${ev.time ? " · " + ev.time : ""}</div>
        <div class="act-time"><span class="ev-label">Where:</span> ${ev.venue || ev.location || "—"}</div>
        ${ev.desc ? `<div class="act-time"><span class="ev-label">Details:</span> ${ev.desc}</div>` : ""}
      </div>
    </div>`).join("");
}

function calNav(dir) {
  calMonth += dir;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  if (calMonth < 0)  { calMonth = 11; calYear--; }
  renderCalendar(_calEvents);
}

function openCalModal() {
  $("calEvTitle").value = "";
  $("calEvDate").value  = calSelected || todayStr();
  $("calEvVenue").value = "";
  $("calEvTime").value  = "";
  $("calModal").classList.remove("hidden");
}

function addCalEvent() {
  const title = $("calEvTitle").value.trim();
  const date  = $("calEvDate").value;
  const venue = $("calEvVenue").value.trim();
  const time  = $("calEvTime").value;

  if (!title || !date) { showToast("Title and date are required.", true); return; }

  fetch("http://localhost:3000/api/calendar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, date, venue, time })
  })
  .then(r => r.json())
  .then(() => { closeModal("calModal"); fetchCalendar(); showToast("Event added to calendar."); })
  .catch(() => {
    _calEvents.push({ title, date, venue, time, status: "approved" });
    closeModal("calModal");
    renderCalendar(_calEvents);
    showToast("Event added to calendar.");
  });
}

// ─────────────────────────────────────────
//  REPORTS
// ─────────────────────────────────────────
function fetchReports() {
  fetch("http://localhost:3000/api/reports")
    .then(r => r.json())
    .then(data => renderReports(data))
    .catch(err => {
      console.error("fetchReports:", err);
      showToast("Could not load reports.", true);
    });
}

function renderReports(data) {
  const isDark = document.documentElement.getAttribute("data-theme") !== "light";
  const textColor   = isDark ? "#8892b0" : "#4a4f6a";
  const gridColor   = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)";

  // ── Summary stat cards ──
  const statusMap = {};
  (data.statusBreakdown || []).forEach(s => { statusMap[s.status] = s.count; });
  const total    = Object.values(statusMap).reduce((a,b) => a+b, 0);
  const approved = statusMap["approved"] || 0;
  const rejected = statusMap["rejected"] || 0;
  const pending  = statusMap["pending"]  || 0;
  const rate     = total > 0 ? Math.round((approved / total) * 100) : 0;

  $("rptTotal").textContent    = total;
  $("rptApproved").textContent = approved;
  $("rptRejected").textContent = rejected;
  $("rptPending").textContent  = pending;
  $("rptRate").textContent     = rate + "%";

  // ── Helper: destroy old chart if exists ──
  const makeChart = (ref, id, type, chartData, options = {}) => {
    if (ref) ref.destroy();
    const ctx = document.getElementById(id);
    if (!ctx) return null;
    return new Chart(ctx, { type, data: chartData, options });
  };

  const baseOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: textColor, font: { size: 11 } } } }
  };

  // ── 1. Donut: Status Breakdown ──
  const statusLabels = (data.statusBreakdown || []).map(s => cap(s.status));
  const statusCounts = (data.statusBreakdown || []).map(s => s.count);
  const statusColors = (data.statusBreakdown || []).map(s =>
    s.status === "approved" ? "#3ecf72"
    : s.status === "rejected" ? "#f16c6c"
    : s.status === "pending" ? "#f5a623"
    : "#2dd4bf"
  );

  _chartStatus = makeChart(_chartStatus, "chartStatus", "doughnut", {
    labels: statusLabels.length ? statusLabels : ["No Data"],
    datasets: [{
      data: statusCounts.length ? statusCounts : [1],
      backgroundColor: statusColors.length ? statusColors : ["#5a6280"],
      borderColor: isDark ? "#1c2035" : "#ffffff",
      borderWidth: 3,
      hoverOffset: 6
    }]
  }, {
    ...baseOpts,
    cutout: "65%",
    plugins: {
      ...baseOpts.plugins,
      legend: { position: "bottom", labels: { color: textColor, padding: 14, font: { size: 11 } } }
    }
  });

  // ── 2. Bar: Requests Per Month ──
  const monthLabels = (data.requestsPerMonth || []).map(m => {
    const [y, mo] = m.month.split("-");
    const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${names[parseInt(mo)-1]} ${y}`;
  });
  const monthCounts = (data.requestsPerMonth || []).map(m => m.count);

  _chartMonthly = makeChart(_chartMonthly, "chartMonthly", "bar", {
    labels: monthLabels.length ? monthLabels : ["No Data"],
    datasets: [{
      label: "Requests",
      data: monthCounts.length ? monthCounts : [0],
      backgroundColor: "rgba(108,99,245,0.7)",
      borderColor: "#6c63f5",
      borderWidth: 1,
      borderRadius: 6,
      borderSkipped: false
    }]
  }, {
    ...baseOpts,
    plugins: { ...baseOpts.plugins, legend: { display: false } },
    scales: {
      x: { ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor } },
      y: { ticks: { color: textColor, font: { size: 10 }, stepSize: 1 }, grid: { color: gridColor }, beginAtZero: true }
    }
  });

  // ── 3. Horizontal Bar: Top Venues ──
  const venueLabels = (data.topVenues || []).map(v => v.venue.length > 18 ? v.venue.slice(0,18)+"…" : v.venue);
  const venueCounts = (data.topVenues || []).map(v => v.count);

  _chartVenues = makeChart(_chartVenues, "chartVenues", "bar", {
    labels: venueLabels.length ? venueLabels : ["No Data"],
    datasets: [{
      label: "Requests",
      data: venueCounts.length ? venueCounts : [0],
      backgroundColor: [
        "rgba(79,179,246,0.75)","rgba(62,207,114,0.75)","rgba(245,166,35,0.75)",
        "rgba(45,212,191,0.75)","rgba(241,108,108,0.75)"
      ],
      borderRadius: 5,
      borderSkipped: false
    }]
  }, {
    ...baseOpts,
    indexAxis: "y",
    plugins: { ...baseOpts.plugins, legend: { display: false } },
    scales: {
      x: { ticks: { color: textColor, font: { size: 10 }, stepSize: 1 }, grid: { color: gridColor }, beginAtZero: true },
      y: { ticks: { color: textColor, font: { size: 10 } }, grid: { color: "transparent" } }
    }
  });

  // ── 4. Bar: Member Activity ──
  const memberLabels = (data.memberActivity || []).map(m => {
    const parts = m.name.split(" ");
    return parts[0] + (parts[1] ? " " + parts[1][0] + "." : "");
  });
  const memberCounts = (data.memberActivity || []).map(m => m.count);

  _chartMembers = makeChart(_chartMembers, "chartMembers", "bar", {
    labels: memberLabels.length ? memberLabels : ["No Data"],
    datasets: [{
      label: "Requests Submitted",
      data: memberCounts.length ? memberCounts : [0],
      backgroundColor: "rgba(45,212,191,0.7)",
      borderColor: "#2dd4bf",
      borderWidth: 1,
      borderRadius: 6,
      borderSkipped: false
    }]
  }, {
    ...baseOpts,
    plugins: { ...baseOpts.plugins, legend: { display: false } },
    scales: {
      x: { ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor } },
      y: { ticks: { color: textColor, font: { size: 10 }, stepSize: 1 }, grid: { color: gridColor }, beginAtZero: true }
    }
  });

  // ── 5. Recent Decisions Table ──
  const tbody = $("rptRecentBody");
  const decisions = data.recentDecisions || [];
  if (!decisions.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--muted)">No decisions yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = decisions.map((d, i) => `
    <tr>
      <td>${i+1}</td>
      <td>${d.title}</td>
      <td>${d.submittedBy}</td>
      <td>${fmtDate(d.date)}</td>
      <td><span class="pill ${d.status}">${cap(d.status)}</span></td>
    </tr>
  `).join("");
}

// ─────────────────────────────────────────
//  MEMBERS (Admin)
// ─────────────────────────────────────────
function fetchMembers() {
  fetch("http://localhost:3000/api/members")
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(data => { _members = data.members || []; renderMembers(); updateDashboard(); })
    .catch(err => { console.error("fetchMembers:", err); showToast("Could not load members.", true); });
}

function renderMembers() {
  const grid = $("memGrid");
  if (!grid) return;
  const q    = ($("memberSearch")?.value || "").toLowerCase();
  const list = q
    ? _members.filter(m => `${m.firstName} ${m.lastName} ${m.email}`.toLowerCase().includes(q))
    : _members;

  if (!list.length) {
    grid.innerHTML = `<div class="no-events" style="grid-column:1/-1">No members found.</div>`; return;
  }

  const colors = ["#6c63f5","#3ecf72","#4fb3f6","#f5a623","#f16c6c","#2dd4bf"];
  grid.innerHTML = list.map((m, i) => {
    const init     = `${m.firstName[0]}${m.lastName[0]}`.toUpperCase();
    const color    = colors[i % colors.length];
    const isAdm    = m.role === "admin";
    const isSelf   = Number(m.id) === currentUser.id;
    const isActive = (m.status || "active") === "active";

    return `<div class="mem-card">
      <div class="mem-av" style="background:${color}">${init}</div>
      <div class="mem-name">${m.firstName} ${m.lastName}</div>
      <div class="mem-role-lbl">${isAdm ? "Admin" : "Member"}</div>
      <div class="mem-status"><span class="pill ${isActive ? "approved" : "rejected"}">${cap(m.status || "active")}</span></div>
      ${!isSelf ? `
        <div style="display:flex;flex-direction:column;gap:.35rem;margin-top:.65rem">
          ${isAdm
            ? `<button class="btn-demote"  onclick="changeRole(${m.id},'member')"><i class="fa-solid fa-user-minus"></i> Demote</button>`
            : `<button class="btn-promote" onclick="changeRole(${m.id},'admin')"><i class="fa-solid fa-user-shield"></i> Promote</button>`}
          ${isActive
            ? `<button class="btn-demote"  style="margin-top:0" onclick="changeMemberStatus(${m.id},'blocked')"><i class="fa-solid fa-ban"></i> Block</button>`
            : `<button class="btn-promote" style="margin-top:0" onclick="changeMemberStatus(${m.id},'active')"><i class="fa-solid fa-circle-check"></i> Activate</button>`}
        </div>` : ""}
    </div>`;
  }).join("");
}

function changeRole(id, newRole) {
  fetch(`http://localhost:3000/api/members/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: newRole })
  })
  .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
  .then(data => { if (data.error) { showToast(data.error, true); return; } fetchMembers(); showToast(`Role updated to ${cap(newRole)}.`); })
  .catch(() => showToast("Server error. Could not update role.", true));
}

function changeMemberStatus(id, newStatus) {
  fetch(`http://localhost:3000/api/members/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: newStatus })
  })
  .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
  .then(data => { if (data.error) { showToast(data.error, true); return; } fetchMembers(); showToast(`Member ${newStatus === "blocked" ? "blocked" : "activated"}.`); })
  .catch(() => showToast("Server error. Could not update status.", true));
}

// ─────────────────────────────────────────
//  SETTINGS
// ─────────────────────────────────────────
function saveSettings() {
  $("saveMsg").classList.remove("hidden");
  setTimeout(() => $("saveMsg").classList.add("hidden"), 2500);
  showToast("Settings saved!");
}

// ─────────────────────────────────────────
//  KEYBOARD SHORTCUTS
// ─────────────────────────────────────────
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    ["eventModal","reviewModal","viewModal","calModal","editModal"].forEach(closeModal);
    closeAllDropdowns();
  }
  if (e.key === "Enter") {
    if ($("loginScreen")    && !$("loginScreen").classList.contains("hidden"))    handleLogin();
    if ($("registerScreen") && !$("registerScreen").classList.contains("hidden")) handleRegister();
  }
});