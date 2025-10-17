// ==== Auth (username -> pseudo userId) ====
const AUTH_TOKEN_KEY = 'hs_auth_token';

/** ===== Backend/Tunnel Reachability Banner ===== **/
(function installApiErrorBanner(){
  if (document.getElementById('api-error-banner')) return;
  const bar = document.createElement('div');
  bar.id = 'api-error-banner';
  bar.style.cssText = [
    'position:fixed','top:0','left:50%','transform:translateX(-50%)',
    'z-index:9999','max-width:920px','width:calc(100% - 24px)',
    'margin:8px','padding:10px 14px',
    'border-radius:10px','backdrop-filter:blur(8px)','-webkit-backdrop-filter:blur(8px)',
    'background:rgba(239,68,68,0.18)','border:1px solid rgba(239,68,68,0.45)',
    'color:#fecaca','font-weight:600','font-size:14px','display:none',
    'box-shadow:0 12px 28px rgba(0,0,0,0.35)'
  ].join(';');
  bar.innerHTML = '⚠️ Backend is unreachable right now. If you are the owner, start Spring Boot and run your ngrok tunnel, then refresh.';
  document.addEventListener('DOMContentLoaded', ()=> document.body.appendChild(bar), { once:true });

  window.__HS_API_ERR__ = {
    show(msg){
      const el = document.getElementById('api-error-banner');
      if (!el) return;
      if (msg) el.textContent = msg;
      el.style.display = 'block';
      clearTimeout(this._t); this._t = setTimeout(()=>{ try{ el.style.display='none'; }catch(_){} }, 8000);
    },
    hide(){
      const el = document.getElementById('api-error-banner');
      if (el) el.style.display = 'none';
    }
  };
})();

/** Fetch with timeout + nicer network/CORS errors */
async function fetchWithTimeout(url, opts={}, ms=10000){
  const ctrl = new AbortController();
  const id = setTimeout(()=>ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal, cache: (opts && opts.cache) ? opts.cache : 'no-store' });
    clearTimeout(id);
    return res;
  } catch (e) {
    // Surface a friendly error for network/tunnel issues
    const netMsg = (e && (e.name === 'AbortError' || e.message.includes('Failed to fetch') || e.message.includes('NetworkError')))
      ? 'Backend is unreachable. Start the backend and ngrok, then refresh.'
      : (e && e.message) || 'Request failed';
    window.__HS_API_ERR__?.show('⚠️ ' + netMsg);
    throw e;
  }
}

/** Offline/online awareness */
window.addEventListener('offline', ()=> window.__HS_API_ERR__?.show('⚠️ You are offline. Reconnect to continue.'));
window.addEventListener('online',  ()=> window.__HS_API_ERR__?.hide());
let AUTH_MODE = 'signin';
const AUTH_USER_KEY   = 'hs_user_name';
const AUTH_USERID_KEY = 'hs_user_id';
function hash32(str){ let h=2166136261>>>0; for(let i=0;i<str.length;i++){ h^=str.charCodeAt(i); h=Math.imul(h,16777619); } return (h>>>0); }
function currentUser(){ const name=localStorage.getItem(AUTH_USER_KEY); const id=localStorage.getItem(AUTH_USERID_KEY); return (name&&id)?{name,id:Number(id)}:null; }
function getUserId(){ const u=currentUser(); return u?u.id:null; }

let __hsWaterWriteGuardUntil = 0,
    __hsSleepWriteGuardUntil = 0,
    __hsWorkoutWriteGuardUntil = 0,
    __hsNutritionWriteGuardUntil = 0;

// ---- Modal scroll lock helpers ----
let __scrollYBeforeModal = 0;
function lockPageScroll() {
  __scrollYBeforeModal = window.scrollY || document.documentElement.scrollTop || 0;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${__scrollYBeforeModal}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
  document.body.style.width = '100%';   // avoid layout shift
}

function unlockPageScroll() {
  const y = __scrollYBeforeModal || 0;
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  document.body.style.width = '';
  // restore without triggering hash/observer changes
  window.scrollTo(0, y);
}

// Legacy stubs (safe no-ops), in case any old code path still calls them
function loadUsers(){ return {}; }
function saveUsers(){ /* noop */ }
async function sha256Hex(_){ return ''; }

function setUserWithId(name, id, token){
  // If user switched, clear local client-only cache so server becomes source of truth
  const prevId = Number(localStorage.getItem(AUTH_USERID_KEY) || 0);
  localStorage.setItem(AUTH_USER_KEY, name);
  localStorage.setItem(AUTH_USERID_KEY, String(id));
  if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
  if (prevId && prevId !== Number(id)) {
    try {
      if (typeof DEFAULT_STATE !== 'undefined') { state = { ...DEFAULT_STATE }; }
      if (typeof saveState === 'function') saveState();
    } catch(_) {}
  }
}
function clearUser(){
  localStorage.removeItem(AUTH_USER_KEY);
  localStorage.removeItem(AUTH_USERID_KEY);
  localStorage.removeItem(AUTH_TOKEN_KEY);
}
function getToken(){ return localStorage.getItem(AUTH_TOKEN_KEY) || null; }

// Show Sign In when not authenticated; hide app sections until logged in
function gateByLogin(){
  const u = currentUser();
  const loginSec = document.getElementById('login');
  const sections = Array.from(document.querySelectorAll('section.hero')).filter(s => s.id !== 'login');
  const nav = document.querySelector('header nav');

  if (u) {
    document.body.classList.add('authed');
    if (loginSec) loginSec.style.display = 'none';
    sections.forEach(s => s.style.display = 'grid');
    if (nav) { nav.style.opacity = '1'; nav.style.pointerEvents = 'auto'; }
  } else {
    document.body.classList.remove('authed');
    if (loginSec) loginSec.style.display = 'grid';
    sections.forEach(s => s.style.display = 'none');
    if (nav) { nav.style.opacity = '0.85'; nav.style.pointerEvents = 'none'; }
  }
}

// Toggle Sign In / Sign Up UI
function setAuthMode(mode){
  AUTH_MODE = (mode === 'signup') ? 'signup' : 'signin';
  const tabIn = document.getElementById('tab-signin');
  const tabUp = document.getElementById('tab-signup');
  const confirm = document.getElementById('signup-password2');
  const btnLogin = document.getElementById('btn-login');
  const btnSignup = document.getElementById('btn-signup');
  if(!tabIn||!tabUp||!confirm||!btnLogin||!btnSignup) return;

  const isSignup = AUTH_MODE === 'signup';

  tabIn.classList.toggle('btn', !isSignup);
  tabIn.classList.toggle('btn-outline', isSignup);
  tabUp.classList.toggle('btn', isSignup);
  tabUp.classList.toggle('btn-outline', !isSignup);

  confirm.style.display = isSignup ? 'inline-block' : 'none';
  btnLogin.style.display = isSignup ? 'none' : 'inline-flex';
  btnSignup.style.display = isSignup ? 'inline-flex' : 'none';
}

// Hook login button
document.addEventListener('DOMContentLoaded',()=>{
  const loginBtn   = document.getElementById('btn-login');
  const signupBtn  = document.getElementById('btn-signup');
  const nameInput  = document.getElementById('login-username');
  const passInput  = document.getElementById('login-password');
  const pass2Input = document.getElementById('signup-password2');
  const tabSignin  = document.getElementById('tab-signin');
  const tabSignup  = document.getElementById('tab-signup');
  const msg        = document.getElementById('auth-msg');
  const logoutBtns = [document.getElementById('btn-logout'), document.getElementById('btn-logout-nav')].filter(Boolean);

  function clearMsg(){ if(msg) msg.textContent = ''; }
  function showErr(t){ if(msg) msg.textContent = t; }

  // Default to Sign In tab
  if(tabSignin) tabSignin.addEventListener('click', ()=>{ setAuthMode('signin'); clearMsg(); });
  if(tabSignup) tabSignup.addEventListener('click', ()=>{ setAuthMode('signup'); clearMsg(); });
  setAuthMode('signin');

  // STRICT SIGN IN: only for users created via Sign Up
  if(loginBtn){
    loginBtn.addEventListener('click', async ()=>{
      clearMsg();
      const u = (nameInput?.value || '').trim();
      const p = (passInput?.value || '');
      if(!u || !p) return showErr('Enter username and password');
      try {
        const res = await fetchWithTimeout(`${API.BASE}/auth/login`, {
          method:'POST',
          headers:{ 'Content-Type':'application/json', 'Accept':'application/json' },
          body: JSON.stringify({ username:u, password:p })
        }).then(API.json);
        console.log('Login response:', res);
        setUserWithId(res.username, res.userId, res.token);
        gateByLogin(); initUserStateIfNeeded(res.userId); state = loadState(); render(); if(typeof syncFromBackend==='function') syncFromBackend();
        // document.querySelector('#dashboard')?.scrollIntoView({behavior:'smooth', block:'start'});
      } catch(err){
        const em = (err && String(err.message||'').toUpperCase()) || '';
        if (em.includes('BACKEND_UNREACHABLE') || em.includes('FETCH') || em.includes('NETWORK') || em.includes('ABORT') || em.includes('404') || em.includes('502') || em.includes('503') || em.includes('504')) {
          showErr('Cannot reach server. Start backend + ngrok and refresh.');
        } else if (em.includes('401')) {
          showErr('Invalid username or password');
        } else {
          showErr('Login failed: ' + (err.message || 'Unknown error'));
        }
      }
    });
  }

  // SIGN UP: create user record then log in
  if(signupBtn){
    signupBtn.addEventListener('click', async ()=>{
      clearMsg();
      const u  = (nameInput?.value  || '').trim();
      const p1 = (passInput?.value  || '');
      const p2 = (pass2Input?.value || '');
      if(!u || !p1 || !p2) return showErr('Fill all fields');
      if(p1.length < 4) return showErr('Password must be at least 4 chars');
      if(p1 !== p2) return showErr('Passwords do not match');
      try {
        const res = await fetchWithTimeout(`${API.BASE}/auth/signup`, {
          method:'POST',
          headers:{ 'Content-Type':'application/json', 'Accept':'application/json' },
          body: JSON.stringify({ username:u, password:p1 })
        }).then(API.json);
        setUserWithId(res.username, res.userId, res.token);
        gateByLogin(); initUserStateIfNeeded(res.userId); state = loadState(); render(); if(typeof syncFromBackend==='function') syncFromBackend();
        // document.querySelector('#dashboard')?.scrollIntoView({behavior:'smooth', block:'start'});
      } catch(err){
        const em = (err && String(err.message||'').toUpperCase()) || '';
        if (em.includes('BACKEND_UNREACHABLE') || em.includes('FETCH') || em.includes('NETWORK') || em.includes('ABORT') || em.includes('404') || em.includes('502') || em.includes('503') || em.includes('504')) {
          showErr('Cannot reach server. Start backend + ngrok and refresh.');
        } else {
          showErr('Username already exists or invalid');
        }
      }
    });
  }

  // Enter submits current mode
  function handleEnter(e){
    if(e.key !== 'Enter') return;
    if (AUTH_MODE === 'signup' && signupBtn) signupBtn.click();
    else if (loginBtn) loginBtn.click();
  }
  nameInput?.addEventListener('keydown', handleEnter);
  passInput?.addEventListener('keydown', handleEnter);
  pass2Input?.addEventListener('keydown', handleEnter);

  // Logout → clear and show login hero (support multiple logout buttons)
  logoutBtns.forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.preventDefault();
      clearUser();
      state = { ...DEFAULT_STATE };
      gateByLogin();
      if (location.hash) { history.replaceState(null, '', location.pathname + location.search); }
      window.scrollTo({ top: 0, behavior: 'auto' });
      const loginSec = document.getElementById('login');
      if(loginSec) loginSec.style.display = 'grid';
      setAuthMode('signin');
      if(nameInput) nameInput.value = '';
      if(passInput) passInput.value = '';
      if(pass2Input) pass2Input.value = '';
      clearMsg();
    });
  });

  gateByLogin();
});

// ==== API helper (talk to Spring Boot) ====
const META_API = document.querySelector('meta[name="api-base"]')?.content;
const API = {
  BASE: META_API || 'http://localhost:8080',

  async json(res){
    if(!res) throw new Error('No response');
  
    if (res.ok) {
      const ct = (res.headers && res.headers.get && (res.headers.get('content-type')||'')) || '';
      // 204 No Content or non-JSON success -> return empty object
      if (res.status === 204 || !ct.includes('application/json')) {
        try {
          const t = await res.clone().text();
          if (!t || !t.trim()) return {};
          // if server sent text but not JSON, wrap it
          return { ok: true, text: t };
        } catch(_) { return {}; }
      }
      return res.json();
    }
  
    const status = res.status;
    const ct = (res.headers && res.headers.get && (res.headers.get('content-type')||'')) || '';
    let bodyText = '';
    try { bodyText = await res.clone().text(); } catch(_) {}
  
    const looksHtml   = ct.includes('text/html') || /^</.test(bodyText.trim());
    const looksTunnel = /ngrok|tunnel|vercel|not found|bad gateway|service unavailable/i.test(bodyText);
  
    // 👉 Treat ANY HTML response or proxy error as unreachable
    if (
      status === 0 || status === 502 || status === 503 || status === 504 ||
      (status === 404 && (looksHtml || looksTunnel)) ||
      looksHtml
    ) {
      window.__HS_API_ERR__?.show('⚠️ Backend/tunnel unreachable. Start Spring Boot + ngrok, then refresh.');
      throw new Error('BACKEND_UNREACHABLE');
    }
  
    // Handle structured JSON error if available
    let msg = status + ' ' + res.statusText;
    if (ct.includes('application/json')) {
      try {
        const j = await res.json();
        if (j && (j.message || j.error)) msg = j.message || j.error;
      } catch(_) {}
    } else if (status === 401) {
      msg = '401 Unauthorized';
    }
  
    if (status === 403 && msg.toLowerCase().includes('cors')) {
      window.__HS_API_ERR__?.show('⚠️ CORS blocked by backend. Check Spring Security CORS config.');
    }
  
    throw new Error(msg);
  },

  get(p){
    const t = getToken();
    const h = { 'Accept':'application/json' };
    if (t) h['Authorization'] = 'Bearer ' + t;
    return fetchWithTimeout(API.BASE+p,{headers:h}).then(API.json);
  },

  post(p,b){
    const t = getToken();
    const h = { 'Content-Type':'application/json','Accept':'application/json' };
    if (t) h['Authorization'] = 'Bearer ' + t;
    return fetchWithTimeout(API.BASE+p,{method:'POST',headers:h,body:JSON.stringify(b||{})}).then(API.json);
  }
};
console.log('API BASE URL =>', API.BASE);

// Smooth scrolling for header links with offset
function setupSmoothNav(){
  //const links=document.querySelectorAll('header nav a[href^="#"]');
  const links = document.querySelectorAll('a[href^="#"]');
  const header=document.querySelector('header');
  const headerH=header?header.getBoundingClientRect().height:0;
  links.forEach(a=>{
    a.addEventListener('click',(e)=>{
      const id=a.getAttribute('href'); if(!id||id==='#') return;
      const t=document.querySelector(id); if(!t) return; e.preventDefault();
      const y=t.getBoundingClientRect().top+window.scrollY-(headerH+8);
      window.scrollTo({top:y,behavior:'smooth'});
    });
  });
}

// Active nav underline based on section in view
function setupActiveNavObserver(){
  const sections=document.querySelectorAll('section.hero[id]');
  const navLinks=Array.from(document.querySelectorAll('header nav a'));
  const map=new Map(navLinks.map(a=>[a.getAttribute('href'),a]));
  const obs=new IntersectionObserver((entries)=>{
    entries.forEach(en=>{
      if(en.isIntersecting){
        const id='#'+en.target.id;
        navLinks.forEach(a=>a.classList.remove('active'));
        const link=map.get(id); if(link) link.classList.add('active');
      }
    });
  },{rootMargin:'-40% 0px -50% 0px',threshold:0.05});
  sections.forEach(s=>obs.observe(s));
}

// Pull today's data from backend & hydrate UI
async function syncFromBackend(){
  const isEmptyArr = (x) => Array.isArray(x) && x.length === 0;
  try{
    const uid=getUserId(); if(!uid) return;
    const waterLogs=await API.get(`/water/${uid}`).catch(()=>null);
    if(Array.isArray(waterLogs) && waterLogs.length){
      const totalMl = waterLogs.reduce((a,x)=>a + (x.amount ?? x.ml ?? x.volume ?? 0), 0);
      if(typeof state!=='undefined'){ 
        state.waterIntake = totalMl;   // server is source of truth
        saveState(); render(); 
      }
    } else if (isEmptyArr(waterLogs) && typeof state !== 'undefined') {
      // Only zero when server explicitly says: no entries
      if (Date.now() < (__hsWaterWriteGuardUntil||0)) {
        // skip once; next poll will apply server truth
      } else {
        state.waterIntake = 0;
        saveState(); render();
      }
    }
    // If waterLogs is null/undefined (network error), do nothing
  }catch(_){}

  try{
    const uid=getUserId(); if(!uid) return;
    const sleeps=await API.get(`/sleep/${uid}`).catch(()=>null);
    if(Array.isArray(sleeps)&&sleeps.length){
      const minutes = sleeps.reduce((a,s)=>a + (s.duration ?? s.minutes ?? 0), 0);
      if(typeof state!=='undefined'){
        state.sleepHours=Math.round((minutes/60)*10)/10;
        const last=sleeps[sleeps.length-1];
        if(last&&last.sleepStart&&last.sleepEnd){ state.sleepStart=last.sleepStart; state.sleepEnd=last.sleepEnd; }
        saveState(); render();
      }
    } else if (isEmptyArr(sleeps) && typeof state !== 'undefined') {
      if (Date.now() < (__hsSleepWriteGuardUntil||0)) {
        // skip clearing right after save
      } else {
        state.sleepHours = 0;              // reset per server
        state.sleepStart = null;
        state.sleepEnd = null;
        saveState(); render();
      }
    }
  }catch(_){}

  try {
    const uid = getUserId(); if (!uid) return;
    const items = await API.get(`/nutrition/${uid}`).catch(()=>null);
    if (Array.isArray(items)) {
      if (items.length === 0 && Date.now() < (__hsNutritionWriteGuardUntil||0)) {
        // recent write: don't wipe entries yet; next poll will pick up
      } else {
        // rebuild local state.nutritionEntries from DB rows
        const fresh = { breakfast:[], lunch:[], dinner:[], snacks:[] };
        items.forEach(row => {
          const meal = (row.meal || row.mealType || '').toLowerCase();
          const entry = {
            food: row.food || row.item,
            qty: row.quantity ?? null,
            kcal: row.kcal || 0,
            protein: row.protein || 0,
            carbs: row.carbs || 0,
            fat: row.fat || 0
          };
          if (fresh[meal]) fresh[meal].push(entry);
        });
        if (!state || typeof state !== 'object') state = { ...DEFAULT_STATE };
        state.nutritionEntries = fresh;   // server is source of truth
        saveState();
        render();
      }
    }
  } catch(_) {}

  try{
    const uid=getUserId(); if(!uid) return;
    const wos=await API.get(`/workout/${uid}`).catch(()=>null);
    if(Array.isArray(wos)&&wos.length){
      const totalMin = wos.reduce((a,w)=>a + (w.time ?? w.duration ?? w.minutes ?? 0), 0);
      const lastType = (wos[wos.length-1].type ?? wos[wos.length-1].activity ?? 'Running');
      if(typeof state!=='undefined'){ 
        state.workoutTime = totalMin;   // server is source of truth
        state.workoutType = lastType;
        saveState(); render(); 
      }
    } else if (isEmptyArr(wos) && typeof state !== 'undefined') {
      if (Date.now() < (__hsWorkoutWriteGuardUntil||0)) {
        // skip zeroing immediately after a write
      } else {
        state.workoutTime = 0;             // reset per server
        // optionally: state.workoutType = 'Running';
        saveState(); render();
      }
    }
  }catch(_){}

  try{
    const uid = getUserId(); if (!uid) return;
    const totals = await API.get(`/nutrition/${uid}/totals`).catch(()=>null);

    // Prefer backend totals when available; fallback to local computed totals
    const localTotals = totalsFromEntries(state.nutritionEntries || {});
    const merged = totals ? {
      kcal:    totals.kcal    ?? localTotals.kcal    ?? 0,
      protein: totals.protein ?? localTotals.protein ?? 0,
      carbs:   totals.carbs   ?? localTotals.carbs   ?? 0,
      fat:     totals.fat     ?? localTotals.fat     ?? 0,
    } : localTotals;

    const kcalEl = document.getElementById('kcal-total');    if (kcalEl) kcalEl.textContent = merged.kcal ?? 0;
    const pEl    = document.getElementById('protein-total'); if (pEl)    pEl.textContent    = (merged.protein ?? 0) + ' g';
    const cEl    = document.getElementById('carb-total');    if (cEl)    cEl.textContent    = (merged.carbs   ?? 0) + ' g';
    const fEl    = document.getElementById('fat-total');     if (fEl)    fEl.textContent    = (merged.fat     ?? 0) + ' g';

    const scoreEl = document.getElementById('nutrition-score');
    if (scoreEl && typeof state !== 'undefined') {
      scoreEl.textContent = String(nutritionScore(
        { kcal: merged.kcal || 0, protein: merged.protein || 0, carbs: merged.carbs || 0, fat: merged.fat || 0 },
        state.nutritionGoals || { kcal: 2000, protein: 100, carbs: 250, fat: 70 }
      ));
    }
  }catch(_){ }
}

/** === Live sync loop: keep UI updated across devices === */
let __hsSyncTimer = null;
function startLiveSync(){
  if (__hsSyncTimer) return;              // avoid duplicates
  __hsSyncTimer = setInterval(()=>{
    if (getUserId()) { syncFromBackend(); }
  }, 20000);                              // poll every 20s

  document.addEventListener('visibilitychange', ()=>{
    if (!document.hidden && getUserId()) syncFromBackend();
  });
  window.addEventListener('focus', ()=>{
    if (getUserId()) syncFromBackend();
  });
}

// POST helpers (no-ops if not logged in)
async function postWaterDelta(amount){
  const uid=getUserId(); if(!uid) return;
  __hsWaterWriteGuardUntil = Date.now() + 5000;
  try{
    try {
      await API.post('/water/add',{userId:uid, amount:amount|0});
    } catch(e){
      const m = String(e?.message||'').toUpperCase();
      if (m.includes('404') || m.includes('405')) {
        await API.post(`/water/${uid}/add`, { amount: amount|0 });
      } else {
        throw e;
      }
    }
    await syncFromBackend();
  }catch(err){
    // window.__HS_API_ERR__?.show('⚠️ Failed to save water: ' + (err?.message||'Unknown error'));
    console.warn('Skipped save due to network/auth error:', err);
  }
}

async function postSleepSave(startHHMM,endHHMM,durationMin){
  const uid=getUserId(); if(!uid) return;
  __hsSleepWriteGuardUntil = Date.now() + 5000;
  try{
    try{
      await API.post('/sleep/add',{userId:uid, sleepStart:startHHMM, sleepEnd:endHHMM, duration:durationMin|0});
    }catch(e){
      const m = String(e?.message||'').toUpperCase();
      if (m.includes('404') || m.includes('405')) {
        await API.post(`/sleep/${uid}/add`, { sleepStart:startHHMM, sleepEnd:endHHMM, duration:durationMin|0 });
      } else {
        throw e;
      }
    }
    await syncFromBackend();
  }catch(err){
    // window.__HS_API_ERR__?.show('⚠️ Failed to save sleep: ' + (err?.message||'Unknown error'));
    console.warn('Skipped save due to network/auth error:', err);
  }
}

async function postWorkoutSave(payload){
  const uid=getUserId(); if(!uid) return;
  __hsWorkoutWriteGuardUntil = Date.now() + 5000;
  try{
    try{
      await API.post('/workout/add',{userId:uid, ...payload});
    }catch(e){
      const m = String(e?.message||'').toUpperCase();
      if (m.includes('404') || m.includes('405')) {
        await API.post(`/workout/${uid}/add`, payload);
      } else {
        throw e;
      }
    }
    await syncFromBackend();
  }catch(err){
    // window.__HS_API_ERR__?.show('⚠️ Failed to save workout: ' + (err?.message||'Unknown error'));
    console.warn('Skipped save due to network/auth error:', err);
  }
}
// --- Nutrition: push one add to backend (non-blocking)
/*async function postNutritionAdd(meal, item){
  const uid = getUserId(); if(!uid) return;
  const payload = {
    userId: uid,
    meal,
    food: item.food,
    quantity: item.qty ?? item.grams ?? null,
    kcal: Math.round(item.kcal || 0),
    protein: Number(item.protein || 0),
    carbs: Number(item.carbs || 0),
    fat: Number(item.fat || 0)
  };
  try { await API.post('/nutrition/add', payload); } catch (_){ /* ignore */ //}
//}

// --- Nutrition: mirror *today* in DB to current local state
async function postNutritionReplaceToday(){
  __hsNutritionWriteGuardUntil = Date.now() + 5000;

  const uid = getUserId && getUserId();
  const payload = [
    ...(state?.nutritionEntries?.breakfast || []).map(it => ({ meal:'breakfast', food:it.food||it.name||it.n||'', quantity: it.qty ?? it.grams ?? null, kcal:Math.round(+it.kcal||0), protein:+(it.protein||it.p||0), carbs:+(it.carbs||it.c||0), fat:+(it.fat||it.f||0) })),
    ...(state?.nutritionEntries?.lunch     || []).map(it => ({ meal:'lunch',     food:it.food||it.name||it.n||'', quantity: it.qty ?? it.grams ?? null, kcal:Math.round(+it.kcal||0), protein:+(it.protein||it.p||0), carbs:+(it.carbs||it.c||0), fat:+(it.fat||it.f||0) })),
    ...(state?.nutritionEntries?.dinner    || []).map(it => ({ meal:'dinner',    food:it.food||it.name||it.n||'', quantity: it.qty ?? it.grams ?? null, kcal:Math.round(+it.kcal||0), protein:+(it.protein||it.p||0), carbs:+(it.carbs||it.c||0), fat:+(it.fat||it.f||0) })),
    ...(state?.nutritionEntries?.snacks    || []).map(it => ({ meal:'snacks',    food:it.food||it.name||it.n||'', quantity: it.qty ?? it.grams ?? null, kcal:Math.round(+it.kcal||0), protein:+(it.protein||it.p||0), carbs:+(it.carbs||it.c||0), fat:+(it.fat||it.f||0) })),
  ];

  if (!uid) { console.warn('[HS] postNutritionReplaceToday: no uid'); return; }

  console.log('[HS] postNutritionReplaceToday →', { uid, count: payload.length, sample: payload[0] });
  try {
    const res = await API.post(`/nutrition/${uid}/replaceToday`, payload);
    console.log('[HS] replaceToday OK:', { saved: Array.isArray(res) ? res.length : res });
    await syncFromBackend();
  } catch (e) {
    console.warn('[HS] replaceToday FAILED:', e);
  }
}

async function loadLeaderboardToday() {
  try {
    const list = await API.get('/leaderboard/today');
    const ul = document.getElementById('leaderboard-today');
    if (!ul) return;

    if (Array.isArray(list) && list.length) {
      ul.innerHTML = list
        .slice(0, 10)
        .map((e, i) =>
          `<li>
             <span class="rank">${i + 1}.</span>
             <span class="name">${e.username ?? 'Unknown'}</span>
             <span class="score">(${e.score ?? e.totalScore ?? 0})</span>
           </li>`
        )
        .join('');
    } else {
      ul.innerHTML = '<li class="empty">No scores yet</li>';
    }
  } catch (err) {
    console.warn('[HS] leaderboard load failed', err);
    const ul = document.getElementById('leaderboard-today');
    if (ul) ul.innerHTML = '<li class="empty">Unable to load</li>';
  }
}

/** === Live cross-device sync via SSE === */
let __hsSSE = null;
let __hsSSEBackoffMs = 1000; // 1s → 2s → 4s … capped at 30s

function startSSE() {
  const uid = getUserId();
  const token = getToken();
  if (!uid || !token) return;

  // Close any existing connection first to avoid duplicates
  if (__hsSSE) { try { __hsSSE.close(); } catch(_) {} __hsSSE = null; }

  const url = `${API.BASE}/sync/stream/${uid}?token=${encodeURIComponent(token)}`;
  const es = new EventSource(url, { withCredentials: false });
  __hsSSE = es;

  es.onopen = () => {
    console.log('[SSE] Connected');
    __hsSSEBackoffMs = 1000; // reset backoff on successful connect
  };

  // Server sends named events
  es.addEventListener('changed', () => {
    if (typeof syncFromBackend === 'function') syncFromBackend();
  });
  es.addEventListener('ping', () => { /* heartbeat keep-alive */ });

  // Fallback for unnamed messages
  es.onmessage = (ev) => {
    if (ev.type === 'ping' || ev.data === 'ping') return; // ignore heartbeats
    if (ev?.data && typeof syncFromBackend === 'function') syncFromBackend();
  };

  es.onerror = (err) => {
    console.warn('[SSE] Error:', err);
    try { es.close(); } catch(_) {}
    __hsSSE = null;
    setTimeout(startSSE, Math.min(__hsSSEBackoffMs, 30000));
    __hsSSEBackoffMs *= 2;
  };
}

// Reconnect around mobile/tab lifecycle events
window.addEventListener('pageshow', () => startSSE());
window.addEventListener('pagehide', () => { try { __hsSSE?.close(); } catch(_) {} __hsSSE = null; });
document.addEventListener('visibilitychange', () => { if (!document.hidden) startSSE(); });

document.addEventListener('DOMContentLoaded', () => loadLeaderboardToday());

// Init helpers after DOM ready
document.addEventListener('DOMContentLoaded',()=>{
  setupSmoothNav();
  setupActiveNavObserver();
  if (typeof loadState === 'function') {
    try { state = loadState(); } catch(_) {}
  }
  ensureStateOwner();

  // Only pre-stamp if this is truly a first run with empty data
  try {
    const k = lastResetKeyFor(effectiveResetOwnerId());
    if (!localStorage.getItem(k)) {
      const noData =
        !state || typeof state !== 'object' ||
        (
          (Number(state.waterIntake) || 0) === 0 &&
          (Number(state.workoutTime) || 0) === 0 &&
          state.nutritionEntries &&
          Array.isArray(state.nutritionEntries.breakfast) && state.nutritionEntries.breakfast.length === 0 &&
          Array.isArray(state.nutritionEntries.lunch) && state.nutritionEntries.lunch.length === 0 &&
          Array.isArray(state.nutritionEntries.dinner) && state.nutritionEntries.dinner.length === 0 &&
          Array.isArray(state.nutritionEntries.snacks) && state.nutritionEntries.snacks.length === 0
        );
      if (noData) {
        localStorage.setItem(k, todayISO());
      }
    }
  } catch(_) {}

  ensureDailyReset();
  scheduleMidnightReset(); // auto rollover if the tab stays open

  if(getUserId()) { syncFromBackend(); startSSE(); }
  startLiveSync();
});

document.addEventListener('DOMContentLoaded', ()=>{

  // --- Water Goal (inline) persistence ---
  const goalInputInline = document.getElementById('goal-input-inline');
  const btnSaveWater = document.getElementById('btn-save-water');
  if (btnSaveWater) {
    btnSaveWater.addEventListener('click', ()=>{
      const v = Math.max(0, Number(goalInputInline?.value || 0));
      if (v > 0) {
        state.waterGoal = Math.round(v);
        saveState();
        render();
      }
    });
  }

  // --- Workout Details persistence (local + backend) ---
  const btnSaveWD = document.getElementById('btn-save-workout-details');
    if (btnSaveWD && btnSaveWD.dataset.bound !== '1') {
      btnSaveWD.dataset.bound = '1';
      btnSaveWD.addEventListener('click', ()=>{
      const typeSel = document.getElementById('workout-type');
      const type = typeSel?.value || 'Running';
      const time = Number(document.getElementById('wd-time')?.value || 0);
      const distVal = document.getElementById('wd-distance')?.value;
      const distance = distVal === '' ? null : Number(distVal);
      const rawMuscle = document.getElementById('wd-muscle')?.value || null;
      const muscle = (type === 'Strength') ? (rawMuscle || null) : null;
      // do nothing if both time and distance are empty/invalid
      if ((isNaN(time) || time <= 0) && (distVal === '' || isNaN(Number(distVal)))) {
        return; // don't add an empty workout
      }

      const entry = { type, time, distance, muscle, at: Date.now() };
      safePushWorkout(entry);

      // if we actually added it, update aggregates & backend
      const last = state.workoutLog[state.workoutLog.length - 1];
      if (last && last.at === entry.at) {
        state.workoutType = last.type;
        state.workoutTime = (state.workoutTime||0) + (Number(last.time)||0);
        saveState();
        render();
        postWorkoutSave({ type: last.type, time: last.time, distanceKm: last.distance||0, muscleGroup: last.muscle||undefined });
      }
      });
  }

  // --- Workout: keep & show only last 7 days on History click ---
(function setupWorkoutHistory7d(){
  const btnHist = document.getElementById('btn-workout-history');
  if (!btnHist || btnHist.dataset.bound === '1') return;
  btnHist.dataset.bound = '1';

  function startOfDay(ts){
    const d = new Date(ts);
    d.setHours(0,0,0,0);
    return d.getTime();
  }
  function labelFor(ts){
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' });
  }
  function keepLast7Days(){
    if (!state || !Array.isArray(state.workoutLog)) return;
    const today0 = startOfDay(Date.now());
    const cutoff = today0 - 6*24*60*60*1000; // inclusive 7 days window
    state.workoutLog = state.workoutLog.filter(e => (e?.at ?? 0) >= cutoff);
    saveState();
  }
  function renderHistoryModal(){
    const today0 = startOfDay(Date.now());
    const days = [];
    for (let i=6; i>=0; i--){
      const day0 = today0 - i*24*60*60*1000;
      const day1 = day0 + 24*60*60*1000;
      const entries = (state.workoutLog||[]).filter(e => {
        const t = e?.at ?? 0;
        return t >= day0 && t < day1;
      });
      days.push({ day0, label: labelFor(day0), entries });
    }

    const content = `
      <div>
        <h2 style="margin:0 0 10px;color:#ef4444">Workout — Last 7 Days</h2>
        <div style="display:flex; flex-direction:column; gap:10px;">
          ${days.map(d => `
            <div style="background:rgba(255,255,255,0.10);border:1px solid rgba(255,255,255,0.22);border-radius:12px;padding:10px 12px;">
              <strong style="color:#e5e7eb">${d.label}</strong>
              ${
                d.entries.length
                  ? `<ul style="list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:6px">
                      ${d.entries.map(e => `
                        <li style="display:flex;justify-content:space-between;gap:8px;">
                          <span>${e.type || 'Workout'}</span>
                          <span style="opacity:.9">
                            ${Number(e.time||0)} min
                            ${e.distance!=null && !isNaN(e.distance) ? ` • ${Number(e.distance)} km` : ''}
                            ${e.muscle ? ` • ${e.muscle}` : ''}
                          </span>
                        </li>
                      `).join('')}
                    </ul>`
                  : `<div style="opacity:.7;margin-top:6px">No workouts</div>`
              }
            </div>
          `).join('')}
        </div>
      </div>
    `;

    if (typeof showModal === 'function') {
      lockPageScroll?.();
      showModal(content);
    } else {
      alert('Workout history (last 7 days only) is ready—but showModal() is not available.');
    }
  }

  btnHist.addEventListener('click', (e)=>{
    e.preventDefault();
    // 1) trim storage to last 7 days
    keepLast7Days();
    // 2) re-render UI if you show aggregates anywhere
    if (typeof render === 'function') render();
    // 3) show the 7-day history
    renderHistoryModal();
  });
})();

  // --- Nutrition Update modal open ---
  const btnNutriUpdate = document.getElementById('btn-nutrition-update');
  if (btnNutriUpdate && btnNutriUpdate.dataset.bound !== '1') {
    btnNutriUpdate.dataset.bound = '1';
    btnNutriUpdate.addEventListener('click', (e)=>{
      e.preventDefault();
      lockPageScroll();
      openNutritionModal();
    });
  }

  // --- Nutrition Goals persistence ---
  (function setupNutritionGoals(){
    const gK   = document.getElementById('goal-kcal');
    const gP   = document.getElementById('goal-protein');
    const gC   = document.getElementById('goal-carbs');
    const gF   = document.getElementById('goal-fat');
    const btnG = document.getElementById('save-nutri-goals');

    function hydrate(){
      ensureNutritionState();
      const goals = state.nutritionGoals || { kcal: 2000, protein: 100, carbs: 250, fat: 70 };
      if (gK) gK.value = goals.kcal;
      if (gP) gP.value = goals.protein;
      if (gC) gC.value = goals.carbs;
      if (gF) gF.value = goals.fat;
    }

    hydrate(); // on load

    if (btnG && btnG.dataset.bound !== '1'){
      btnG.dataset.bound = '1';
      btnG.addEventListener('click',(e)=>{
        e.preventDefault();
        ensureNutritionState();
        state.nutritionGoals = {
          kcal:    Math.max(0, Number(gK?.value) || 2000),
          protein: Math.max(0, Number(gP?.value) || 100),
          carbs:   Math.max(0, Number(gC?.value) || 250),
          fat:     Math.max(0, Number(gF?.value) || 70),
        };
        saveState();
        refreshNutriTotalsAndScore();
        if (typeof render === 'function') render();
      });
    }
  })();

  // --- Global delegation for Nutrition modal actions (Remove / Close) ---
  if (document && document.body && document.body.dataset.nutriRmBound !== '1') {
    document.body.dataset.nutriRmBound = '1';

    document.addEventListener('click', function (ev) {
      const el = ev.target.closest('[data-remove], .rm-entry, #nutri-close');
      if (!el) return;

      // Close button (optional)
      if (el.id === 'nutri-close') {
        ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
        const closeBtn = document.querySelector('.modal-close');
        if (closeBtn) closeBtn.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
        return;
      }

      // Normalize: support BOTH data-remove="meal:idx" and legacy .rm-entry
      let meal, idx;
      if (el.matches('[data-remove]')) {
        const raw = el.getAttribute('data-remove') || '';
        const [m, i] = raw.split(':');
        meal = m; idx = Number(i);
      } else {
        meal = el.getAttribute('data-meal');
        idx  = Number(el.getAttribute('data-idx'));
      }

      if (!meal || Number.isNaN(idx)) return;
      const arr = state?.nutritionEntries?.[meal];
      if (!Array.isArray(arr)) return;

      ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();

      // 1) Update local state
      arr.splice(idx, 1);
      saveState();

      // 2) Refresh THIS modal’s meal list (your UI)
      rebuildMealList(meal);

      // 3) Totals/UI
      try { refreshNutriTotalsAndScore(); } catch(_) {}
      if (typeof render === 'function') render();

      // 4) Mirror to backend (debounced)
      debounce('nutri-replace-today', () => { try { postNutritionReplaceToday(); } catch(_) {} }, 350);
    }, true); // capture
  }

}, { once: true });

function setSleepTimesInline() {
  const s = document.getElementById('bedtime')?.value || '23:00';
  const e = document.getElementById('waketime')?.value || '07:00';
  state.sleepStart = s;
  state.sleepEnd = e;
  const [sh, sm] = s.split(':').map(Number);
  const [eh, em] = e.split(':').map(Number);
  const start = (sh*60 + sm) % 1440;
  const end = (eh*60 + em) % 1440;
  const dur = (end - start + 1440) % 1440;
  state.sleepHours = +(dur/60).toFixed(1);
  upsertSleepHistory(dur);
  saveState();
  render();
  // also notify backend (non-blocking)
  postSleepSave(s, e, dur);
}
const STATE_KEY = 'healthstep_state_v1';
const LAST_RESET_KEY = 'healthstep_last_reset'; // legacy (kept for backward compat)
const LAST_RESET_KEY_PREFIX = 'healthstep_last_reset_uid_';
function lastResetKeyFor(uid){ return `${LAST_RESET_KEY_PREFIX}${uid||'anon'}`; }

const STATE_OWNER_KEY = 'healthstep_state_owner';
function ensureStateOwner(){
  try{
    const uid = getUserId();
    const as = String(uid ?? 'anon');
    const owner = localStorage.getItem(STATE_OWNER_KEY);
    if (owner !== as){
      // New user context detected → clear only sleep history
      if (!state || typeof state !== 'object') { state = { ...DEFAULT_STATE }; }
      state.sleepHistory = [];
      saveState();
      localStorage.setItem(STATE_OWNER_KEY, as);
    }
  }catch(_){}
}

function todayISO(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

// Track last reset day in both localStorage and state for extra safety
function getStateLastResetDay(){
  try { return (state && state.metaLastResetDay) ? String(state.metaLastResetDay) : null; } catch(_){ return null; }
}
function setStateLastResetDay(d){
  try {
    if (!state || typeof state !== 'object') state = { ...DEFAULT_STATE };
    state.metaLastResetDay = String(d);
    saveState();
  } catch(_){}
}

// Prefer current user; else fall back to last known owner; else 'anon'
function effectiveResetOwnerId(){
  try{
    const uid   = getUserId();
    const owner = localStorage.getItem(STATE_OWNER_KEY);
    return (uid != null ? uid : (owner ?? 'anon'));
  }catch(_){ return 'anon'; }
}

// Ensure per-day metrics reset once per local day (per user)
function ensureDailyReset(){
  try{
    const ownerId = effectiveResetOwnerId();
    const key     = lastResetKeyFor(ownerId);
    const legacyK = LAST_RESET_KEY;
    const lsLast  = localStorage.getItem(key) || localStorage.getItem(legacyK);
    const stLast  = getStateLastResetDay();
    const today   = todayISO();

    // ---- DEBUG (shows once per page load)
    if (!window.__hsResetLogged) {
      window.__hsResetLogged = true;
      console.log('[HS] ensureDailyReset', { ownerId, key, lsLast, stLast, today });
    }

    // State says "already reset today" but LS missing → backfill LS and exit
    if (stLast === today && lsLast !== today) {
      localStorage.setItem(key, today);
      localStorage.setItem(legacyK, today);
      return;
    }

    // LS says "already reset today" → sync state stamp and exit
    if (lsLast === today) {
      if (stLast !== today) setStateLastResetDay(today);
      return;
    }

    // First-ever run with empty data → just stamp today; don't clear anything
    const firstRunNoData =
      (!stLast && !lsLast) &&
      state && typeof state === 'object' &&
      (state.waterIntake === 0) &&
      (state.workoutTime === 0) &&
      state.nutritionEntries &&
      Array.isArray(state.nutritionEntries.breakfast) && state.nutritionEntries.breakfast.length === 0 &&
      Array.isArray(state.nutritionEntries.lunch) && state.nutritionEntries.lunch.length === 0 &&
      Array.isArray(state.nutritionEntries.dinner) && state.nutritionEntries.dinner.length === 0 &&
      Array.isArray(state.nutritionEntries.snacks) && state.nutritionEntries.snacks.length === 0;

    if (firstRunNoData) {
      setStateLastResetDay(today);
      localStorage.setItem(key, today);
      localStorage.setItem(legacyK, today);
      return;
    }

    // Real new day → reset only per-day aggregates & today’s meal entries
    if (!state || typeof state !== 'object') state = { ...DEFAULT_STATE };

    state.waterIntake = 0;
    state.workoutTime = 0;

    if (!state.nutritionEntries || typeof state.nutritionEntries !== 'object') {
      state.nutritionEntries = { breakfast:[], lunch:[], dinner:[], snacks:[] };
    } else {
      state.nutritionEntries.breakfast = [];
      state.nutritionEntries.lunch = [];
      state.nutritionEntries.dinner = [];
      state.nutritionEntries.snacks = [];
    }

    saveState();
    setStateLastResetDay(today);
    localStorage.setItem(key, today);
    localStorage.setItem(legacyK, today);

    try { refreshNutriTotalsAndScore(); } catch(_) {}
    if (typeof render === 'function') render();
  } catch(err){
    console.warn('[HS] ensureDailyReset error', err);
  }
}

function msUntilNextLocalMidnight() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0); // next local midnight
  return next - now;
}

let __midnightTimer;
function scheduleMidnightReset() {
  try { if (__midnightTimer) clearTimeout(__midnightTimer); } catch(_){}
  __midnightTimer = setTimeout(() => {
    console.log('[HS] Midnight reached – running ensureDailyReset()');
    ensureDailyReset();
    scheduleMidnightReset(); // schedule for the following day
  }, Math.max(1000, msUntilNextLocalMidnight()));
}

const DEFAULT_STATE = {
  waterIntake: 0,
  sleepHours: 7,
  sleepStart: "23:00",
  sleepEnd: "06:30",
  workoutTime: 30,
  workoutType: "Running",
  workoutDetails: {},
  waterHistory: [],
  workoutLog: [],
  nutrition: { breakfast: "healthy", lunch: "healthy", dinner: "healthy", snacks: "healthy" },
  waterGoal: 2500,
  sleepHistory: [],
  // --- Nutrition extension ---
  nutritionGoals: { kcal: 2000, protein: 100, carbs: 250, fat: 70 },
  nutritionEntries: { breakfast: [], lunch: [], dinner: [], snacks: [] },
};

// --- Workout MET table and calculator ---
const WORKOUT_MET = {
  Running: 9.8,
  Walking: 3.5,
  Cycling: 7.5,
  Strength: 6.0,
  Yoga: 3.0,
  HIIT: 8.0,
  Other: 5.0,
};

function computeWorkoutStats(type, timeMin, distanceKm) {
  const weightKg = state.userWeight || 70; // default baseline
  const met = WORKOUT_MET[type] || WORKOUT_MET.Other;
  const hours = Math.max(0, (parseFloat(timeMin) || 0) / 60);
  const calories = Math.round(met * weightKg * hours);
  let speed = null; // km/h
  if ((type === 'Running' || type === 'Walking' || type === 'Cycling') && distanceKm != null) {
    const d = parseFloat(distanceKm);
    if (!isNaN(d) && d >= 0 && hours > 0) speed = +(d / hours).toFixed(2);
  }
  return { calories, speed };
}

const WATER_FACTS = [
  "Up to 60% of the adult human body is water.",
  "Your brain and heart are about 73% water; lungs are ~83% water.",
  "Mild dehydration (1–2%) can impair focus and mood.",
  "Water helps regulate body temperature through sweating.",
  "Kidneys filter ~180 liters of fluid per day—water intake supports this.",
  "A 2% drop in hydration can reduce physical performance noticeably.",
  "Fiber + water improves digestion and prevents constipation.",
  "Thirst can be mistaken for hunger; drinking water may reduce overeating.",
  "Hydration supports joint lubrication via synovial fluid.",
  "Urine color is a simple hydration indicator: pale straw = well hydrated.",
];

// --- Simple Food DB (per 100g) ---
const FOOD_DB = [
  { n: 'Apple', unit: 'count', per: { kcal: 95, p: 0.5, c: 25, f: 0.3 } },
  { n: 'Banana', unit: 'count', per: { kcal: 105, p: 1.3, c: 27, f: 0.4 } },
  { n: 'Egg (boiled)', unit: 'count', per: { kcal: 78, p: 6.3, c: 0.6, f: 5.3 } },
  { n: 'Rice (cooked)', kcal: 130, p: 2.4, c: 28, f: 0.3 },
  { n: 'Paneer', kcal: 265, p: 18, c: 4, f: 20 },
  { n: 'Chicken breast (cooked)', kcal: 165, p: 31, c: 0, f: 3.6 },
  { n: 'Dal (cooked)', unit: 'ml', kcal: 116, p: 9, c: 20, f: 0.4 },
  { n: 'Chapati', unit: 'count', per: { kcal: 80, p: 1, c: 18, f: 3.7 } },
  { n: 'Oats (cooked)', kcal: 71, p: 2.5, c: 12, f: 1.5 },
  { n: 'Milk (toned)', unit: 'ml', kcal: 60, p: 3.2, c: 5, f: 3.3 }
];
const findFood = (name) => FOOD_DB.find(x => x.n.toLowerCase() === String(name||'').toLowerCase());
function macrosFor(name, amount) {
  const f = findFood(name);
  const a = Math.max(0, Number(amount) || 0);
  if (!f) return { kcal: 0, protein: 0, carbs: 0, fat: 0 };

  // Count-based items with per-piece macros
  if (f.unit === 'count' && f.per) {
    return {
      kcal: Math.round(f.per.kcal * a),
      protein: +(f.per.p * a).toFixed(1),
      carbs: +(f.per.c * a).toFixed(1),
      fat: +(f.per.f * a).toFixed(1),
    };
  }

  // Default: per 100g
  return {
    kcal: +(f.kcal * a / 100).toFixed(0),
    protein: +(f.p * a / 100).toFixed(1),
    carbs: +(f.c * a / 100).toFixed(1),
    fat: +(f.f * a / 100).toFixed(1),
  };
}
function totalsFromEntries(entries) {
  const sum = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  Object.values(entries||{}).forEach(arr => (arr||[]).forEach(item => {
    sum.kcal += item.kcal; sum.protein += item.protein; sum.carbs += item.carbs; sum.fat += item.fat;
  }));
  return {
    kcal: Math.round(sum.kcal),
    protein: +sum.protein.toFixed(1),
    carbs: +sum.carbs.toFixed(1),
    fat: +sum.fat.toFixed(1)
  };
}

function rebuildMealList(meal){
  const listEl = document.querySelector(`[data-list="${meal}"]`);
  if (!listEl) return;

  const arr = (state?.nutritionEntries?.[meal]) || [];
  if (!arr.length) {
    listEl.innerHTML = '<em style="color:#9ca3af">No items</em>';
    return;
  }

  const html = '<ul style="list-style:none;margin:6px 0 0;padding:0;display:flex;flex-direction:column;gap:6px">' +
    arr.map((it,i)=>{
      const meta = findFood(it.food);
      const unitType = meta && meta.unit ? meta.unit : 'g';
      const q = (typeof it.qty !== 'undefined') ? it.qty : it.grams;
      const unit = unitType === 'count' ? 'x' : (unitType === 'ml' ? 'ml' : 'g');
      const qtyLabel = (q != null) ? `${q}${unit}` : '';
      return `<li class="nm-item">
        <span class="nm-food-label">${it.food} — ${qtyLabel}</span>
        <span class="nm-macros">${it.kcal} kcal • P ${it.protein} • C ${it.carbs} • F ${it.fat}</span>
        <button class="btn-outline mini" data-remove="${meal}:${i}" style="margin:0">Remove</button>
      </li>`;
    }).join('') + '</ul>';

  listEl.innerHTML = html;
}

function nutritionScore(tot, goal) {
  // Simple score: 40% calories closeness, 60% macro balance (protein weighted)
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const calRatio = tot.kcal / Math.max(1, goal.kcal);
  const calScore = 1 - Math.min(1, Math.abs(1 - calRatio)); // 1 when on target
  const pRatio = tot.protein / Math.max(1, goal.protein);
  const cRatio = tot.carbs / Math.max(1, goal.carbs);
  const fRatio = tot.fat / Math.max(1, goal.fat);
  const macroScore = (clamp01(1 - Math.abs(1-pRatio)) * 0.45)
                   + (clamp01(1 - Math.abs(1-cRatio)) * 0.30)
                   + (clamp01(1 - Math.abs(1-fRatio)) * 0.25);
  return Math.round((calScore*0.4 + macroScore*0.6) * 100);
}

function refreshNutriTotalsAndScore() {
  const totals = totalsFromEntries(state.nutritionEntries || {});
  const goals  = state.nutritionGoals || { kcal: 2000, protein: 100, carbs: 250, fat: 70 };

  const kcalEl  = document.getElementById('kcal-total');
  const pEl     = document.getElementById('protein-total');
  const cEl     = document.getElementById('carb-total');
  const fEl     = document.getElementById('fat-total');
  const scoreEl = document.getElementById('nutrition-score');
  const tipEl   = document.getElementById('nutri-hydration-tip');

  if (kcalEl)  kcalEl.textContent  = totals.kcal;
  if (pEl)     pEl.textContent     = `${totals.protein} g`;
  if (cEl)     cEl.textContent     = `${totals.carbs} g`;
  if (fEl)     fEl.textContent     = `${totals.fat} g`;
  if (scoreEl) scoreEl.textContent = String(nutritionScore(totals, goals));

  if (tipEl) {
    const pct = Math.min(100, Math.max(0, Math.round((state.waterIntake / state.waterGoal) * 100)));
    tipEl.textContent = pct >= 100 ? 'Hydration on point. 🥤' : `Hydration: ${pct}% of today’s goal.`;
  }
}
// Ensure nutrition totals are refreshed after every render (idempotent hook)
(function(){
  if (typeof window !== 'undefined' && typeof window.render === 'function' && !window.render.__nutriHooked) {
    const __prevRender = window.render;
    const hooked = function(){
      __prevRender.apply(this, arguments);
      try { refreshNutriTotalsAndScore(); } catch(_) {}
    };
    hooked.__nutriHooked = true;
    window.render = hooked;
  }
})();

// --- debounce helper (shared) ---
const __debounceMap = new Map();
function debounce(key, fn, delay = 300) {
  clearTimeout(__debounceMap.get(key));
  const t = setTimeout(fn, delay);
  __debounceMap.set(key, t);
}

// Global remover (works even if the modal is inside a shadow root)
function removeNutritionEntry(meal, idx){
  try {
    const arr = state?.nutritionEntries?.[meal];
    if (!meal || Number.isNaN(Number(idx)) || !Array.isArray(arr)) return;

    console.log('[HS] removeNutritionEntry', { meal, idx, beforeLen: arr.length });

    // 1) Remove locally + persist
    arr.splice(Number(idx), 1);
    saveState();

    // 2) Repaint UI
    const bodyEl = document.getElementById('nutri-modal-body') || document.getElementById('modal-body');
    if (bodyEl) renderNutritionModalBody(bodyEl);
    if (typeof refreshNutriTotalsAndScore === 'function') refreshNutriTotalsAndScore();
    if (typeof render === 'function') render();

    // 3) Mirror to backend (debounced)
    debounce('nutri-replace-today', () => {
      try { postNutritionReplaceToday(); } catch(_) {}
    }, 400);
  } catch (e) {
    console.warn('[HS] removeNutritionEntry failed', e);
  }
}
window.removeNutritionEntry = removeNutritionEntry;

// Dev helper: simulate “new day” without changing system time
window.__forceNewDayReset = function() {
  try {
    const key = lastResetKeyFor(effectiveResetOwnerId());
    localStorage.setItem(key, '1970-01-01'); // force “old” day
    if (state) { delete state.metaLastResetDay; saveState(); }
    console.log('[HS] __forceNewDayReset: invoking ensureDailyReset()');
    ensureDailyReset();
  } catch (e) {
    console.warn('[HS] __forceNewDayReset failed', e);
  }
};
window.addEventListener('beforeunload', ()=> {
  try { postNutritionReplaceToday(); } catch(_) {}
});

function renderNutritionModalBody(bodyEl){
  if (!bodyEl) return; // silently no-op when modal body isn't present

  ensureNutritionState();
  const entries = state.nutritionEntries || { breakfast:[], lunch:[], dinner:[], snacks:[] };
  const meals = ['breakfast','lunch','dinner','snacks'];

  const sections = meals.map(meal => {
    const list = (entries[meal]||[]).map((it, idx) => {
      const name = it.name || it.n || 'Item';
      const amt  = (it.amount != null) ? it.amount : (it.a != null ? it.a : '');
      const kcal = it.kcal ?? 0;
      const p = it.protein ?? it.p ?? 0;
      const c = it.carbs ?? it.c ?? 0;
      const f = it.fat ?? it.f ?? 0;
      return `
        <li style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:6px 0;">
          <span>${name} <small style="opacity:.8">(${amt})</small><br>
            <small style="opacity:.8">${kcal} kcal · P ${p}g · C ${c}g · F ${f}g</small>
          </span>
          <button
            type="button"
            class="btn-outline mini rm-entry"
            data-meal="${meal}"
            data-idx="${idx}"
          >Remove</button>
        </li>`;
    }).join('');
    return `
      <div class="nutri-sec">
        <h4 style="margin:6px 0 6px; color:#f59e0b; font-size:14px; text-transform:capitalize;">${meal}</h4>
        <ul style="padding:0; margin:0; list-style:none;">${list || '<li style="opacity:.8">No items</li>'}</ul>
      </div>`;
  }).join('');

  bodyEl.innerHTML = `<div style="display:flex; flex-direction:column; gap:10px;">${sections}</div>`;

  // Attach once to THIS modal body
  if (bodyEl.dataset.rmDelegated !== '1') {
    console.log('[HS] binding rm-entry listener on modal body');
    bodyEl.addEventListener('click', (ev) => {
      // Don't rely on instanceof Element; use nodeType check and fallback
      const tgt = ev.target && (ev.target.nodeType === 1 ? ev.target : ev.target.parentElement);
      const btn = tgt && tgt.closest ? tgt.closest('.rm-entry') : null;
      if (!btn) return;

      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();

      const meal = btn.getAttribute('data-meal') || btn.dataset.meal;
      const idx  = Number(btn.getAttribute('data-idx') ?? btn.dataset.idx);
      console.log('[HS] rm-entry clicked', { meal, idx });

      ensureNutritionState();
      const arr = meal ? state.nutritionEntries && state.nutritionEntries[meal] : null;
      if (!meal || !Array.isArray(arr) || Number.isNaN(idx)) {
        console.warn('[HS] rm-entry invalid payload', { meal, idx, arrType: Array.isArray(arr) });
        return;
      }

      // Remove, persist, repaint
      arr.splice(idx, 1);
      saveState();

      renderNutritionModalBody(bodyEl);
      try { refreshNutriTotalsAndScore(); } catch(_) {}
      if (typeof render === 'function') render();
    }, true); // capture

    bodyEl.dataset.rmDelegated = '1';
  } else {
    console.log('[HS] rm-entry listener already bound on modal body');
  }
}

const bodyEl = document.getElementById('nutri-modal-body'); // <- must exist in your modal markup
renderNutritionModalBody(bodyEl);

function openNutritionUpdateModal(){
  // Use existing (old) modal system
  ensureNutritionState();

  const shell = `
    <div>
      <h2 style="margin:0 0 10px;color:#f59e0b">Update Nutrition</h2>
      <div id="nutri-modal-body"></div>
      <div style="margin-top:12px; display:flex; gap:8px; justify-content:flex-end;">
        <button class="btn-outline mini" id="nutri-close">Close</button>
      </div>
    </div>`;

  if (typeof showModal === 'function') {
    showModal(shell);
  }
  // Try to render after host modal attaches content
  (function tryMount(){
    const el = document.getElementById('nutri-modal-body');
    if (el) { renderNutritionModalBody(el); return; }
    requestAnimationFrame(tryMount);
  })();

  // Render entries into the modal body
  const bodyEl = document.getElementById('nutri-modal-body');
  if (bodyEl) renderNutritionModalBody(bodyEl);

  // Wire up the Close button to the host modal system
  const closeBtn = document.getElementById('nutri-close');
  if (closeBtn && closeBtn.dataset.bound !== '1') {
    closeBtn.dataset.bound = '1';
    closeBtn.addEventListener('click', (e)=>{
      e.preventDefault();
      // Try to trigger host close button if available
      const hostClose = document.querySelector('.modal-close');
      if (hostClose) hostClose.dispatchEvent(new Event('click'));
    });
  }

  // Delegate Remove inside JUST this modal body (capture to beat host listeners)
  if (bodyEl && !bodyEl.dataset.rmBound) {
    bodyEl.addEventListener('click', (ev)=>{
      const t = ev.target;
      if (!(t instanceof Element)) return;
      const btn = t.closest('.rm-entry');
      if (!btn) return;
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();

      const meal = btn.getAttribute('data-meal');
      const idx  = Number(btn.getAttribute('data-idx'));
      ensureNutritionState();
      if (!meal || isNaN(idx)) return;
      if (!Array.isArray(state.nutritionEntries[meal])) return;

      state.nutritionEntries[meal].splice(idx, 1);
      saveState();
      postNutritionReplaceToday(); 

      renderNutritionModalBody(bodyEl);
      if (typeof refreshNutriTotalsAndScore === 'function') refreshNutriTotalsAndScore();
      if (typeof render === 'function') render();
    }, true);
    bodyEl.dataset.rmBound = '1';
  }
}

function getDailyFacts(facts, count = 3) {
  const seed = new Date().toDateString();
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const res = [];
  const used = new Set();
  while (res.length < Math.min(count, facts.length)) {
    h = (h * 1664525 + 1013904223) >>> 0; // LCG
    const idx = h % facts.length;
    if (!used.has(idx)) { used.add(idx); res.push(facts[idx]); }
  }
  return res;
}

let state = loadState();

function ensureNutritionState(){
  if (!state || typeof state !== 'object') state = { ...DEFAULT_STATE };
  if (!state.nutritionEntries || typeof state.nutritionEntries !== 'object') {
    state.nutritionEntries = { breakfast:[], lunch:[], dinner:[], snacks:[] };
  } else {
    ['breakfast','lunch','dinner','snacks'].forEach(k=>{
      if (!Array.isArray(state.nutritionEntries[k])) state.nutritionEntries[k] = [];
    });
  }
  if (!state.nutritionGoals || typeof state.nutritionGoals !== 'object') {
    state.nutritionGoals = { kcal: 2000, protein: 100, carbs: 250, fat: 70 };
  }
}
ensureNutritionState();

function normalizeWorkoutLogArray(arr){
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(e => e && typeof e === 'object')
    .map(e => ({
      type: (typeof e.type === 'string' && e.type) ? e.type : 'Running',
      time: Number.isFinite(e.time) ? e.time : 0,
      distance: (e.distance == null || isNaN(Number(e.distance))) ? null : Number(e.distance),
      muscle: (typeof e.muscle === 'string' && e.muscle) ? e.muscle : null,
      at: Number.isFinite(e.at) ? e.at : Date.now()
    }));
}

// Normalize legacy/undefined entries once at startup
state.workoutLog = compactWorkoutLog(state.workoutLog);
saveState();

function compactWorkoutLog(arr){
  const norm = normalizeWorkoutLogArray(arr);
  // bucket by local day + type + time
  const dayKey = (ms) => {
    try { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`; }
    catch { return 'na'; }
  };
  const map = new Map();
  // oldest → newest so newer details can “promote” over older
  for (const e of norm.sort((a,b)=>(a.at||0)-(b.at||0))) {
    const key = `${dayKey(e.at)}|${e.type}|${Number(e.time)||0}`;
    if (!map.has(key)) { map.set(key, { ...e }); continue; }
    const cur = map.get(key);
    // prefer richer details and the newest timestamp
    if (cur.distance == null && e.distance != null) cur.distance = e.distance;
    if (cur.muscle   == null && e.muscle   != null) cur.muscle   = e.muscle;
    if ((e.at||0) > (cur.at||0)) cur.at = e.at;
  }
  // newest first for display
  return Array.from(map.values()).sort((a,b)=>(b.at||0)-(a.at||0));
}

function safePushWorkout(entry){
  if (!entry || typeof entry !== 'object') return;

  const norm = {
    type: (typeof entry.type === 'string' && entry.type) ? entry.type : 'Running',
    time: Number.isFinite(entry.time) ? entry.time : 0,
    distance: (entry.distance == null || isNaN(Number(entry.distance))) ? null : Number(entry.distance),
    muscle: (typeof entry.muscle === 'string' && entry.muscle) ? entry.muscle : null,
    at: Number.isFinite(entry.at) ? entry.at : Date.now()
  };

  // Reject empty submissions (no duration and no distance)
  if ((norm.time|0) <= 0 && norm.distance == null) return;

  if (!Array.isArray(state.workoutLog)) state.workoutLog = [];

  // De-duplicate: if the most recent item matches and was just added, skip
  const last = state.workoutLog[state.workoutLog.length - 1];
  if (last) {
    const closeInTime = Math.abs((Number(last.at)||0) - norm.at) <= 3000; // 3s window
    const sameTypeTime = last.type === norm.type && (Number(last.time)||0) === (Number(norm.time)||0);

    if (closeInTime && sameTypeTime) {
      const sameDistance = ((last.distance==null && norm.distance==null) || Number(last.distance) === Number(norm.distance));
      const sameMuscle = (last.muscle || null) === (norm.muscle || null);

      // A) exact duplicate → drop
      if (sameDistance && sameMuscle) return;

      // B) promote added details instead of pushing a new row
      let promoted = false;
      if ((last.distance == null) && (norm.distance != null)) { last.distance = norm.distance; promoted = true; }
      if ((last.muscle == null) && (norm.muscle != null)) { last.muscle = norm.muscle; promoted = true; }
      if (promoted) { last.at = norm.at; saveState(); return; }
    }
  }

  state.workoutLog.push(norm);
  state.workoutLog = compactWorkoutLog(state.workoutLog).slice(-200);
}

// === Water droplet wave animation state ===
let wavePhase = 0;             // radians
let waveReqId = null;          // RAF handle
let currentLevel = 0;          // 0..1 animated level
let targetLevel = 0;           // 0..1 target level from state
const WAVE = { width: 200, height: 260, amp: 6, freq: 2.2, speed: 1.6, ease: 0.08 };

function migrateLegacyState(uid){
  try{
    const legacy = localStorage.getItem(STATE_KEY);
    const perUserKey = stateKeyFor(uid);
    // If a legacy blob exists but the per-user one doesn't, promote it once
    if (legacy && !localStorage.getItem(perUserKey)) {
      localStorage.setItem(perUserKey, legacy);
      localStorage.removeItem(STATE_KEY);
    }
  }catch(_){}
}

function loadState() {
  try {
    const uid = getUserId();
    // If no logged-in user, fall back to a temporary ephemeral state
    if (!uid) return { ...DEFAULT_STATE };

    // Migrate any legacy (non user-keyed) state into the per-user key once
    migrateLegacyState(uid);

    checkDailyReset();
    const key = stateKeyFor(uid);
    const saved = localStorage.getItem(key);
    return { ...DEFAULT_STATE, ...(saved ? JSON.parse(saved) : {}) };
  } catch (e) {
    return { ...DEFAULT_STATE };
  }
}

function checkDailyReset() {
  const uid = getUserId();
  const resetKey = lastResetKeyFor(uid);

  // Always use ISO (YYYY-MM-DD)
  const todayIso = todayISO();
  let last = localStorage.getItem(resetKey);

  // Back-compat: if old human-readable string exists, treat it as today once,
  // then rewrite to ISO to prevent thrashing on each refresh.
  if (last && last.includes(' ')) {
    const legacyToday = new Date().toDateString();
    if (last === legacyToday) {
      localStorage.setItem(resetKey, todayIso);
      last = todayIso;
    }
  }

  if (last === todayIso) return; // already stamped for today

  // Build from previous state while preserving long-lived fields
  let prev = {};
  try { prev = JSON.parse(localStorage.getItem(stateKeyFor(uid)) || '{}'); } catch (_) {}

  const preserved = {
    sleepHistory: Array.isArray(prev?.sleepHistory) ? prev.sleepHistory : [],
    sleepStart: typeof prev?.sleepStart === 'string' ? prev.sleepStart : DEFAULT_STATE.sleepStart,
    sleepEnd:   typeof prev?.sleepEnd   === 'string' ? prev.sleepEnd   : DEFAULT_STATE.sleepEnd,
    waterGoal:  typeof prev?.waterGoal  === 'number' ? prev.waterGoal  : DEFAULT_STATE.waterGoal,
    nutritionGoals: prev?.nutritionGoals || DEFAULT_STATE.nutritionGoals,
    nutritionEntries: prev?.nutritionEntries || DEFAULT_STATE.nutritionEntries,
    workoutLog: Array.isArray(prev?.workoutLog) ? prev.workoutLog : [],
  };

  const resetState = {
    ...DEFAULT_STATE,
    ...preserved,
    waterIntake: 0,
    waterHistory: [],
    workoutTime: 0,
  };

  localStorage.setItem(stateKeyFor(uid), JSON.stringify(resetState));
  localStorage.setItem(resetKey, todayIso);
}

function saveState() {
  const uid = getUserId();
  if (!uid) return; // do not persist to a shared/global key when unauthenticated
  try {
    localStorage.setItem(stateKeyFor(uid), JSON.stringify(state));
  } catch (e) {}
}
function stateKeyFor(userId){ return userId ? `${STATE_KEY}_${userId}` : STATE_KEY; }
function initUserStateIfNeeded(userId){
  const key=stateKeyFor(userId);
  if(!localStorage.getItem(key)){
    localStorage.setItem(key, JSON.stringify(DEFAULT_STATE));
  }
}


// --- Water droplet animated wave helper ---
function buildWavePath(level, phase) {
  const W = WAVE.width, H = WAVE.height;
  // keep waterline a bit below the apex to avoid a sharp clip at 100%
  const safeLevel = Math.min(level, 0.97);
  const yBase = H - H * safeLevel;
  const A = WAVE.amp;
  const k = (Math.PI * 2 * WAVE.freq) / W;
  const step = 8;
  const left = -20;          // extend past clip on both sides
  const right = W + 20;
  let d = `M 0 ${H} L ${left} ${H} L ${left} ${yBase}`;
  for (let x = left; x <= right; x += step) {
    const y = yBase + Math.sin(k * x + phase) * A;
    d += ` L ${x} ${y}`;
  }
  d += ` L ${right} ${H} Z`;
  return d;
}

function animateWaterWave() {
  const path = document.getElementById('water-wave');
  if (!path) { waveReqId = null; return; }
  // ease the level toward target
  currentLevel += (targetLevel - currentLevel) * WAVE.ease;
  // advance phase
  wavePhase += 0.05 * WAVE.speed;
  // update path
  path.setAttribute('d', buildWavePath(currentLevel, wavePhase));
  waveReqId = requestAnimationFrame(animateWaterWave);
}

function render() {
  const water = document.getElementById('water-count');
  const reminder = document.getElementById('reminder');
  const sleepHrs = document.getElementById('sleep-hours');
  const sleepStatus = document.getElementById('sleep-status');
  const workout = document.getElementById('workout-time');
  const circle = document.getElementById('wellness-circle');

  const ovWater = document.getElementById('ov-water');
  if (ovWater) ovWater.textContent = `${(state.waterIntake/1000).toFixed(1)}L / ${(state.waterGoal/1000).toFixed(1)}L`;

  const goalInputInline = document.getElementById('goal-input-inline');
  if (goalInputInline) goalInputInline.value = state.waterGoal || 2500;

  const ovSleep = document.getElementById('ov-sleep');
  if (ovSleep) ovSleep.textContent = `${state.sleepHours} hrs`;

  const ovWorkout = document.getElementById('ov-workout');
  if (ovWorkout) ovWorkout.textContent = `${state.workoutTime} min ${state.workoutType}`;

  const totals = totalsFromEntries(state.nutritionEntries);
  const ovNutrition = document.getElementById('ov-nutrition');
  if (ovNutrition) ovNutrition.textContent = `${totals.kcal} kcal • Score ${nutritionScore(totals, state.nutritionGoals)}%`;

  const ovLeader = document.getElementById('ov-leader');
  if (ovLeader) ovLeader.textContent = "Top 3: Alex, Jamie, Robin"; // or pull dynamically

  const waterL = (state.waterIntake / 1000).toFixed(1);
  const goalL = (state.waterGoal / 1000).toFixed(1);
  water.innerText = waterL + 'L/' + goalL + 'L';
  // Circular progress for Water
  const arc = document.getElementById('water-progress-arc');
  const pctEl = document.getElementById('water-progress-pct');
  const literEl = document.getElementById('water-progress-liters');
  if (arc || pctEl || literEl) {
    const C = 753.98; // circumference for r=140
    const pct = Math.min(100, Math.max(0, Math.round((state.waterIntake / state.waterGoal) * 100)));
    if (arc) arc.style.strokeDashoffset = String(C * (1 - pct / 100));
    if (pctEl) pctEl.textContent = pct + '%';
    if (literEl) literEl.textContent = `${waterL}/${goalL}L`;
  }
  // Water droplet level (animated sine wave)
  const wavePath = document.getElementById('water-wave');
  if (wavePath) {
    targetLevel = Math.max(0, Math.min(0.97, state.waterGoal > 0 ? (state.waterIntake / state.waterGoal) : 0));
    // jump currentLevel on first paint so it doesn’t animate from 0 every load
    if (currentLevel === 0 && targetLevel > 0) currentLevel = targetLevel;
    if (!waveReqId) waveReqId = requestAnimationFrame(animateWaterWave);
  }
  // Populate Water Facts panel
  const factsList = document.getElementById('water-facts-list');
  if (factsList) {
    const dayIndex = new Date().getDay();
    const rotateBy = (dayIndex * 2) % WATER_FACTS.length;
    const rotatedFacts = [...WATER_FACTS.slice(rotateBy), ...WATER_FACTS.slice(0, rotateBy)];
    const facts = rotatedFacts.slice(0, 2); // show 2 facts only
    factsList.innerHTML = facts.map(f => `<li><span class="fact-text">${f}</span></li>`).join('');
  }
  
  if (reminder) {
    const remaining = state.waterGoal - state.waterIntake;
    reminder.innerText = remaining <= 0
      ? 'You reached your water goal! 🎉'
      : 'Drink ' + (remaining / 1000).toFixed(1) + 'L more water today';
  }

  // Compute sleep duration from start/end times
  const minsFromHHMM = (hhmm) => {
    const [h, m] = (hhmm || '00:00').split(':').map(n => parseInt(n, 10));
    return (h * 60 + (m || 0)) % 1440;
  };
  const startM = minsFromHHMM(state.sleepStart);
  const endM = minsFromHHMM(state.sleepEnd);
  const durM = (endM - startM + 1440) % 1440; // wrap overnight
  const durH = Math.floor(durM / 60);
  const durMin = durM % 60;
  const durLabel = `${durH}h ${durMin}m`;
  upsertSleepHistory(durM);

  sleepHrs.innerText = durLabel;
  sleepStatus.innerText = (durM >= 480) ? 'Excellent' : 'Good';
  // Update inline sleep inputs if present (bedtime/waketime)
  const bedInput = document.getElementById('bedtime');
  const wakeInput = document.getElementById('waketime');
  if (bedInput) bedInput.value = state.sleepStart;
  if (wakeInput) wakeInput.value = state.sleepEnd;

  // Update sleep clock precise arc (path)
  const sleepArcPath = document.getElementById('sleep-arc-path');
  if (sleepArcPath) {
    const cx = 150, cy = 150, r = 120;
    const twoPi = Math.PI * 2;
    const startAngle = (startM / 1440) * twoPi - Math.PI / 2; // 0 at top, clockwise
    const endAngle = ((startM + durM) / 1440) * twoPi - Math.PI / 2;
    const largeArc = durM > 720 ? 1 : 0; // > 12h

    const sx = cx + r * Math.cos(startAngle);
    const sy = cy + r * Math.sin(startAngle);
    const ex = cx + r * Math.cos(endAngle);
    const ey = cy + r * Math.sin(endAngle);

    // Sweep flag 1 = clockwise
    const d = `M ${sx} ${sy} A ${r} ${r} 0 ${largeArc} 1 ${ex} ${ey}`;
    sleepArcPath.setAttribute('d', d);
  }

  // Position bedtime (start) and wake (end) dots on the ring
  const sd = document.getElementById('sleep-start-dot');
  const ed = document.getElementById('sleep-end-dot');
  if (sd || ed) {
    const center = 150, radius = 120; // match SVG
    // angle with 0 at top, increasing clockwise
    const aStart = (startM / 1440) * 2 * Math.PI - Math.PI / 2;
    const aEnd   = (endM   / 1440) * 2 * Math.PI - Math.PI / 2;
    const rx = radius; // place on stroke center; adjust inward if needed
    if (sd) {
      sd.setAttribute('cx', String(center + Math.cos(aStart) * rx));
      sd.setAttribute('cy', String(center + Math.sin(aStart) * rx));
      // Highlight the start dot
      sd.classList.add('highlight-dot');
      sd.setAttribute('r', '9');
      sd.setAttribute('opacity', '1');
      sd.setAttribute('fill', '#c4b5fd');
    }
    if (ed) {
      ed.setAttribute('cx', String(center + Math.cos(aEnd) * rx));
      ed.setAttribute('cy', String(center + Math.sin(aEnd) * rx));
      // Remove highlight from end dot if it had it
      ed.classList.remove('highlight-dot');
      ed.setAttribute('r', '6');
      ed.setAttribute('opacity', '0.95');
      ed.setAttribute('fill', '#c4b5fd');
    }
  }

  // Update center label in clock if present
  const durCenter = document.getElementById('sleep-duration-label');
  if (durCenter) durCenter.textContent = durLabel;

  // === Build Sleep 7-day history (moon discs) ===
  const histEl = document.getElementById('sleep-history');
  if (histEl) {
    const DAY = 24*60*60*1000;
    if (!Array.isArray(state.sleepHistory)) state.sleepHistory = [];
    const map = new Map(state.sleepHistory.map(e => [e.date, e.minutes]));

    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i*DAY);
      const key = d.toDateString();
      const mins = map.get(key);
      days.push({
        date: key,
        minutes: typeof mins === 'number' ? mins : null,
        dow: d.toLocaleDateString(undefined, { weekday: 'short' })
      });
    }

    const base = 480; // 8h baseline in minutes
    histEl.innerHTML = days.map((item, idx) => {
      const m = item.minutes;
      const ratio = Math.max(0, Math.min(1, (m ?? 0) / base));
      const r = 16, cx = 20, cy = 20;
      const offset = (2*r + 6) * ratio; // ensure full disc when ratio=1
      const maskId = `sleepMoonMask_${idx}`;
      const hrsLabel = m == null ? '-' : `${Math.round((m/60)*10)/10}h`;
      return `
        <div class="sleep-history-item" title="${item.dow}: ${hrsLabel}">
          <svg viewBox="0 0 40 40" aria-hidden="true">
            <defs>
              <mask id="${maskId}">
                <rect width="40" height="40" fill="black"/>
                <circle cx="${cx}" cy="${cy}" r="${r}" fill="white"/>
                <circle cx="${cx + offset}" cy="${cy}" r="${r}" fill="black"/>
              </mask>
            </defs>
            <circle cx="${cx}" cy="${cy}" r="${r}"
                    mask="url(#${maskId})" fill="#8b5cf6"
                    style="filter: drop-shadow(0 0 6px rgba(139,92,246,0.6));" />
            <circle cx="${cx}" cy="${cy}" r="${r}"
                    fill="none" stroke="#a78bfa" stroke-width="2.5"
                    vector-effect="non-scaling-stroke" paint-order="stroke fill" />
          </svg>
          <div class="day">${item.dow}</div>
          <div class="hrs">${hrsLabel}</div>
        </div>`;
    }).join('');
  }
  // Sync right-panel Nutrition goals inputs with saved state
  (function syncNutritionGoalsInputs(){
    const g = state.nutritionGoals || {};
    const gk = document.getElementById('goal-kcal');     if (gk) gk.value = g.kcal;
    const gp = document.getElementById('goal-protein');  if (gp) gp.value = g.protein;
    const gc = document.getElementById('goal-carbs');    if (gc) gc.value = g.carbs;
    const gf = document.getElementById('goal-fat');      if (gf) gf.value = g.fat;
  })();
  refreshNutriTotalsAndScore();

  workout.innerText = `${state.workoutTime} min • ${state.workoutType || 'Running'}`;
  if (document.getElementById('workout-details')) {
    try { renderWorkoutDetails(); } catch(_) {}
  }
  if (circle) circle.style.borderColor = state.workoutTime >= 60 ? '#10b981' : '#f59e0b';
  // updateWaterUpdateButtonState(); (removed)

  // Ensure Daily Totals panel reflects local state on every render
  if (typeof refreshNutriTotalsAndScore === 'function') {
    refreshNutriTotalsAndScore();
  } 

}


function addWater(amount = 250) {
  if (state.waterIntake < state.waterGoal) {
    const oldIntake = state.waterIntake;
    state.waterIntake = Math.min(state.waterIntake + amount, state.waterGoal);
    const actualAdded = state.waterIntake - oldIntake;
    if (actualAdded > 0) {
      state.waterHistory.push(actualAdded);
      postWaterDelta(actualAdded);
    }
    saveState();
    render();
  }
}


function undoWater() {
  if (state.waterHistory.length > 0) {
    const lastAmount = state.waterHistory.pop();
    state.waterIntake = Math.max(0, state.waterIntake - lastAmount);
    saveState();
    render();
  }
}

function resetWaterToday() {
  state.waterIntake = 0;
  state.waterHistory = [];
  saveState();
  render();
}

function upsertSleepHistory(minutes) {
  try {
    const todayKey = new Date().toDateString();
    if (!Array.isArray(state.sleepHistory)) state.sleepHistory = [];
    const idx = state.sleepHistory.findIndex(e => e && e.date === todayKey);
    const prev = idx >= 0 ? state.sleepHistory[idx].minutes : undefined;

    if (idx >= 0) {
      if (prev === minutes) return;           // no change → skip save
      state.sleepHistory[idx] = { date: todayKey, minutes };
    } else {
      state.sleepHistory.push({ date: todayKey, minutes });
    }

    state.sleepHistory.sort((a,b) => new Date(a.date) - new Date(b.date));
    while (state.sleepHistory.length > 7) state.sleepHistory.shift();
    saveState();
  } catch (_) {}
}

function setSleep() {
  const input = document.getElementById('sleep-input');
  const hours = parseFloat(input.value);
  if (!isNaN(hours) && hours >= 0 && hours <= 24) {
    state.sleepHours = hours;
    const minutes = Math.round(hours * 60);
    upsertSleepHistory(minutes);
    saveState();
    render();
    input.value = '';
  } else {
    alert('Please enter a valid number between 0 and 24 hours');
  }
}

function addWorkout() {
  if (state.workoutTime < 180) {
    state.workoutTime += 10;
    saveState();
    render();
  }
}

function ensureModal() {
  let overlay = document.getElementById('modal-overlay');
  if (overlay) return overlay; // already exists

  overlay = document.createElement('div');
  overlay.id = 'modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content">
      <button class="modal-close" id="modal-close" aria-label="Close">×</button>
      <div id="modal-body"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Close handlers
  overlay.addEventListener('click', (e) => { if (e.target === overlay) hideModal(); });
  const closeBtn = overlay.querySelector('#modal-close');
  if (closeBtn) closeBtn.addEventListener('click', hideModal);

  return overlay;
}

function showModal(content) {
  const overlay = ensureModal();
  const body = overlay.querySelector('#modal-body');
  body.innerHTML = content;
  // 🔒 Lock background scroll
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';
  document.body.style.position = 'fixed';

  // force reflow then show
  overlay.offsetHeight;
  setTimeout(() => overlay.classList.add('show'), 10);
}

function hideModal() {
  const overlay = document.getElementById('modal-overlay');
  if (!overlay) return;
  overlay.classList.remove('show');
  const body = overlay.querySelector('#modal-body');
  if (body) body.innerHTML = '';
  // 🔓 Unlock background scroll
  document.documentElement.style.overflow = '';
  document.body.style.overflow = '';
  document.body.style.position = '';
  unlockPageScroll();
}

// --- Modal creators ---
function createWaterModal() {
  const waterL = (state.waterIntake / 1000).toFixed(1);
  const goalL = (state.waterGoal / 1000).toFixed(1);
  const remaining = state.waterGoal - state.waterIntake;
  
  return `
    <div style="text-align: center;">
      <div style="font-size: 48px; margin-bottom: 10px;">💧</div>
      <h2 style="margin: 0 0 10px 0; color: #2563eb;">Water Intake</h2>
      <h1 style="margin: 0 0 20px 0; font-size: 32px;">${waterL}L / ${goalL}L</h1>
      <p style="color: #6b7280; margin-bottom: 20px;">
        ${remaining <= 0 ? '🎉 Goal reached!' : `Drink ${(remaining / 1000).toFixed(1)}L more today`}
      </p>
      <div class="modal-water-buttons">
        <button onclick="addWater(250); hideModal();">+250ml</button>
        <button onclick="addWater(500); hideModal();">+500ml</button>
        <button onclick="addWater(750); hideModal();">+750ml</button>
        <button onclick="addWater(1000); hideModal();">+1L</button>
        <button onclick="undoWater(); hideModal();" class="modal-undo-btn undo-btn">↶ Undo</button>
      </div>
      <div style="margin-top: 20px;">
        <input type="number" id="goal-input" min="500" step="100" placeholder="Set goal (ml)" style="padding: 8px; text-align: center;">
        <button onclick="setWaterGoal(); hideModal();" class="modal-set-btn">Set Goal</button>
      </div>
    </div>
  `;
}

function setWaterGoal() {
  const input = document.getElementById('goal-input');
  const goal = parseInt(input.value);

  if (!isNaN(goal) && goal >= 500 && goal <= 10000) {
    state.waterGoal = goal;
    if (state.waterIntake > state.waterGoal) {
      state.waterIntake = state.waterGoal;
    }
    saveState();
    render();
  } else {
    alert('Please enter a goal between 500 ml and 10,000 ml');
  }
}
function setWaterGoalInline() {
  const input = document.getElementById('goal-input-inline');
  const goal = parseInt(input.value);
  if (!isNaN(goal) && goal >= 500 && goal <= 10000) {
    state.waterGoal = goal;
    if (state.waterIntake > state.waterGoal) {
      state.waterIntake = state.waterGoal;
    }
    saveState();
    render();
    input.value = '';
  } else {
    alert('Please enter a goal between 500 ml and 10,000 ml');
  }
}

function createSleepModal() {
  return `
    <div style="text-align: center;">
      <div style="font-size: 48px; margin-bottom: 10px;">🌙</div>
      <h2 style="margin: 0 0 10px 0; color: #a78bfa;">Sleep Schedule</h2>
      <div class="modal-sleep-input">
        <label style="display:block;margin-bottom:6px;color:#c7d2fe;">Bedtime</label>
        <input type="time" id="sleep-start-input" value="${state.sleepStart}" />
        <label style="display:block;margin:12px 0 6px;color:#c7d2fe;">Wake Up</label>
        <input type="time" id="sleep-end-input" value="${state.sleepEnd}" />
        <button onclick="setSleepTimesFromModal(); hideModal();" class="modal-set-btn" style="margin-top:16px;">Save</button>
      </div>
    </div>
  `;
}

function createWorkoutModal() {
  return `
    <div style="text-align: center;">
      <div style="font-size: 48px; margin-bottom: 10px;">🏋️‍♂️</div>
      <h2 style="margin: 0 0 10px 0; color: #fb923c;">Workout Log</h2>
      <h1 style="margin: 0 0 20px 0; font-size: 32px;">${state.workoutTime} min</h1>
      <p style="color: #6b7280; margin-bottom: 20px;">
        ${state.workoutTime >= 60 ? 'Great workout!' : 'Keep it up!'}
      </p>
      <div class="modal-workout-buttons">
        <button onclick="addWorkout(); hideModal();">+10 min</button>
        <button onclick="addWorkout(); addWorkout(); hideModal();">+20 min</button>
      </div>
    </div>
  `;
}
function openWorkoutHistoryModal() {
  const log = Array.isArray(state.workoutLog) ? state.workoutLog : [];

  const fmtDate = (msOrStr) => {
    if (!msOrStr) return '';
    if (typeof msOrStr === 'number') {
      try {
        return new Date(msOrStr).toLocaleDateString(undefined, { month: 'short', day: '2-digit' });
      } catch { return ''; }
    }
    // legacy string like "Sat Sep 20 2025"
    const t = Date.parse(msOrStr);
    if (!isNaN(t)) {
      try {
        return new Date(t).toLocaleDateString(undefined, { month: 'short', day: '2-digit' });
      } catch { return String(msOrStr); }
    }
    return String(msOrStr);
  };

  const items = log
    .map(e => ({
      type: (typeof e.type === 'string' && e.type) ? e.type : 'Workout',
      time: Number.isFinite(e.time) ? e.time : 0,
      distance: (e.distance == null || isNaN(Number(e.distance))) ? null : Number(e.distance),
      muscle: (typeof e.muscle === 'string' && e.muscle) ? e.muscle : null,
      at: typeof e.at === 'number' ? e.at : (e.date ? Date.parse(e.date) : null),
      dateLabel: fmtDate(typeof e.at === 'number' ? e.at : e.date)
    }))
    .sort((a,b) => (b.at || 0) - (a.at || 0))
    .map(e => {
      const prefix = e.dateLabel ? `${e.dateLabel}: ` : '';
      const dist = e.distance == null ? '' : `, ${e.distance} km`;
      const musc = e.muscle ? `, ${e.muscle}` : '';
      return `<li>${prefix}${e.type} — ${e.time} min${dist}${musc}</li>`;
    })
    .join('');

  showModal(`
    <div>
      <h2 style="margin:0 0 10px;color:#fb923c">Workout History</h2>
      <ul style="text-align:left;color:#e5e7eb;padding-left:20px">
        ${items || '<em>No workouts logged yet</em>'}
      </ul>
    </div>
  `);
}
function saveWorkoutDetails() {
  const typeSel = document.getElementById('workout-type');
  const type = (typeSel && typeSel.value) || state.workoutType || 'Running';
  const timeEl = document.getElementById('wd-time');
  const distEl = document.getElementById('wd-distance');
  const muscleEl = document.getElementById('wd-muscle');

  const timeMin = Math.max(0, parseInt(timeEl && timeEl.value, 10) || 0);
  const distanceKm = (['Running','Walking','Cycling'].includes(type))
    ? Math.max(0, parseFloat(distEl && distEl.value) || 0)
    : null;
  const muscle = (type === 'Strength') ? ((muscleEl && muscleEl.value) || '') : '';

  // persist
  state.workoutType = type;
  state.workoutTime = timeMin;
  if (!state.workoutDetails) state.workoutDetails = {};
  state.workoutDetails[type] = { timeMin, distanceKm, muscle };

  // log: update today's log with muscle logic for Strength
  if (!state.workoutLog) state.workoutLog = [];
  const today = new Date().toDateString();
  let existing = state.workoutLog.find(e => e.date === today && e.type === type);

  // For Strength workouts, also consider muscle group
  if (type === 'Strength') {
    existing = state.workoutLog.find(e => e.date === today && e.type === type && e.muscle === muscle);
  }

  if (existing) {
    const sameTime = existing.time === timeMin;
    const sameDist = (existing.distance ?? null) === (distanceKm ?? null);
    const sameMuscle = (existing.muscle ?? null) === (muscle || null);
    if (!(sameTime && sameDist && sameMuscle)) {
      state.workoutLog.push({ date: today, type, time: timeMin, distance: distanceKm ?? undefined, muscle: muscle || undefined });
    }
  } else {
    state.workoutLog.push({ date: today, type, time: timeMin, distance: distanceKm ?? undefined, muscle: muscle || undefined });
  }

  // quick stats
  const stats = computeWorkoutStats(type, timeMin, distanceKm);
  const sumEl = document.getElementById('wd-summary');
  if (sumEl) {
    const parts = [ `${timeMin} min`, type ];
    if (distanceKm != null) parts.push(`${distanceKm} km`);
    if (stats && stats.calories != null) parts.push(`${stats.calories} kcal`);
    if (stats && stats.speed != null) parts.push(`${stats.speed} km/h`);
    sumEl.textContent = parts.join(' • ');
  }

  postWorkoutSave({ type, time: timeMin, distance: (distanceKm==null? undefined : distanceKm), muscle: muscle || undefined });
  saveState();
  render();
}

function setSleepTimesFromModal() {
  const s = document.getElementById('sleep-start-input')?.value || '23:00';
  const e = document.getElementById('sleep-end-input')?.value || '07:00';
  state.sleepStart = s;
  state.sleepEnd = e;
  // Optionally also store computed hours
  const [sh, sm] = s.split(':').map(Number);
  const [eh, em] = e.split(':').map(Number);
  const start = (sh*60+sm)%1440, end=(eh*60+em)%1440;
  const dur = (end - start + 1440)%1440;
  state.sleepHours = +(dur/60).toFixed(1);
  upsertSleepHistory(dur);
  saveState();
  render();
}
// === Draw ticks and numbers on sleep clock (inside ring) ===
const sleepRing = document.querySelector(".sleep-ring");
if (sleepRing) {
  const NS = "http://www.w3.org/2000/svg";
  const center = 150, radius = 120; // matches CSS (r=120)

  for (let h = 0; h < 24; h++) {
    // angle: 0h at top, increasing clockwise
    const angle = (h / 24) * 2 * Math.PI - Math.PI / 2;

    // Draw ticks *inside* the ring
    const inner = radius - 15;   // closer to center
    const outer = radius - 5;    // just inside ring stroke
    const x1 = center + Math.cos(angle) * inner;
    const y1 = center + Math.sin(angle) * inner;
    const x2 = center + Math.cos(angle) * outer;
    const y2 = center + Math.sin(angle) * outer;

    const tick = document.createElementNS(NS, "line");
    tick.setAttribute("x1", x1);
    tick.setAttribute("y1", y1);
    tick.setAttribute("x2", x2);
    tick.setAttribute("y2", y2);
    tick.setAttribute("stroke", "rgba(255,255,255,0.7)");
    tick.setAttribute("stroke-width", h % 6 === 0 ? 3 : 1.5); // bold at 0,6,12,18
    sleepRing.appendChild(tick);

    // Numbers at every 2-hour interval (00, 02, ..., 22) in 24-hour format, two digits
    if (h % 2 === 0) {
      const labelR = radius - 34; // deeper inside for readability
      const tx = center + Math.cos(angle) * labelR;
      const ty = center + Math.sin(angle) * labelR;

      const label = document.createElementNS(NS, "text");
      label.setAttribute("x", tx);
      label.setAttribute("y", ty);
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("dominant-baseline", "middle");
      label.setAttribute("font-size", "14");
      label.setAttribute("fill", "#e5e7eb");
      // Show as two-digit 24-hour (00, 02, ... 22)
      label.textContent = String(h).padStart(2, '0');
      sleepRing.appendChild(label);
    }
  }
}

// --- Nutrition modal (enhanced) ---
function openNutritionModal() {
  const goals = state.nutritionGoals || { kcal: 2000, protein: 100, carbs: 250, fat: 70 };
  const meals = ['breakfast','lunch','dinner','snacks'];

  const list = (meal) => {
    const arr = (state.nutritionEntries && state.nutritionEntries[meal]) || [];
    if (!arr.length) return '<em style="color:#9ca3af">No items</em>';
    return '<ul style="list-style:none;margin:6px 0 0;padding:0;display:flex;flex-direction:column;gap:6px">' +
      arr.map((it,i)=>{
        const meta3 = findFood(it.food);
        const unitType3 = meta3 && meta3.unit ? meta3.unit : 'g';
        const q3 = (typeof it.qty !== 'undefined') ? it.qty : it.grams;
        const unit3 = unitType3 === 'count' ? 'x' : (unitType3 === 'ml' ? 'ml' : 'g');
        const qtyLabel3 = (q3 != null) ? `${q3}${unit3}` : '';
        return `<li class="nm-item">
          <span class="nm-food-label">${it.food} — ${qtyLabel3}</span>
          <span class="nm-macros">${it.kcal} kcal • P ${it.protein} • C ${it.carbs} • F ${it.fat}</span>
          <button class="btn-outline mini" data-remove="${meal}:${i}" style="margin:0">Remove</button>
        </li>`;
      }).join('') + '</ul>';
  };

  const foodOptions = FOOD_DB.map(f=>`<option value="${f.n}"></option>`).join('');

  const content = `
    <div>
      <h2 style="margin:0 0 10px;color:#f59e0b">Nutrition Log</h2>
      <p style="margin:0 0 10px;color:#cbd5e1">
        Quickly add foods to each meal. (Totals, goals & score are shown on the right panel.)
      </p>

      <div style="display:grid;grid-template-columns:1fr;gap:14px">
        ${meals.map(meal=>`
          <div style="background:rgba(255,255,255,0.10);border:1px solid rgba(255,255,255,0.22);border-radius:12px;padding:12px 12px 10px">
            <strong style="color:#e5e7eb;text-transform:capitalize">${meal}</strong>
            <div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap">
              <input list="food-db" data-meal="${meal}" class="nm-food" placeholder="Food (e.g., Apple)"
                     style="flex:1;min-width:180px;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.08);color:#e5e7eb" />
              <input type="number" min="1" step="1" value="1" data-meal="${meal}" class="nm-qty" placeholder="qty"
                     style="width:100px;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.08);color:#e5e7eb;text-align:center" />
              <button class="btn" data-add="${meal}" style="margin:0">Add</button>
            </div>
            <div class="nm-list" data-list="${meal}">${list(meal)}</div>
          </div>`).join('')}
      </div>

      <datalist id="food-db">${foodOptions}</datalist>
    </div>
  `;

  showModal(content);

  // Larger layout for this modal
  const overlay = document.getElementById('modal-overlay');
  const mc = overlay && overlay.querySelector('.modal-content');
  if (mc) mc.classList.add('nutrition-modal');

  const body = overlay && overlay.querySelector('#modal-body');

  // Helper: re-render just one meal's list
  function renderMealList(meal) {
    const listEl = body && body.querySelector(`[data-list="${meal}"]`);
    if (!listEl) return;
    const arr = (state.nutritionEntries && state.nutritionEntries[meal]) || [];
    if (!arr.length) {
      listEl.innerHTML = '<em style="color:#9ca3af">No items</em>';
      return;
    }
    listEl.innerHTML =
      '<ul style="list-style:none;margin:6px 0 0;padding:0;display:flex;flex-direction:column;gap:6px">' +
      arr.map((it,i)=>{
        const meta = findFood(it.food);
        const unitType = meta && meta.unit ? meta.unit : 'g';
        const q = (typeof it.qty !== 'undefined') ? it.qty : it.grams;
        const unit = unitType === 'count' ? 'x' : (unitType === 'ml' ? 'ml' : 'g');
        const qtyLabel = (q != null) ? `${q}${unit}` : '';
        return `<li class="nm-item">
          <span class="nm-food-label">${it.food} — ${qtyLabel}</span>
          <span class="nm-macros">${it.kcal} kcal • P ${it.protein} • C ${it.carbs} • F ${it.fat}</span>
          <button class="btn-outline mini" data-remove="${meal}:${i}" style="margin:0">Remove</button>
        </li>`;
      }).join('') + '</ul>';
  }

  // Tune qty controls based on selected food
  function tuneQtyForMeal(mealKey) {
    const foodEl = body && body.querySelector(`.nm-food[data-meal="${mealKey}"]`);
    const qtyEl  = body && body.querySelector(`.nm-qty[data-meal="${mealKey}"]`);
    if (!foodEl || !qtyEl) return;
    const f = findFood((foodEl.value||'').trim());
    if (f && f.unit === 'count') {
      qtyEl.min = 1; qtyEl.step = 1; if (!qtyEl.value || Number(qtyEl.value) <= 0) qtyEl.value = 1;
      qtyEl.placeholder = 'count';
    } else if (f && f.unit === 'ml') {
      qtyEl.min = 50; qtyEl.step = 50; if (!qtyEl.value || Number(qtyEl.value) <= 0) qtyEl.value = 200;
      qtyEl.placeholder = 'ml';
    } else {
      qtyEl.min = 1; qtyEl.step = 100; if (!qtyEl.value || Number(qtyEl.value) <= 0) qtyEl.value = 100;
      qtyEl.placeholder = 'g';
    }
  }
  body.querySelectorAll('.nm-food').forEach(inp => {
    const mealKey = inp.getAttribute('data-meal');
    inp.addEventListener('change', () => tuneQtyForMeal(mealKey));
    inp.addEventListener('blur',   () => tuneQtyForMeal(mealKey));
  });

  // ADD handlers (per-button)
  body.querySelectorAll('[data-add]').forEach(btn => {
    btn.addEventListener('click', () => {
      const meal = btn.getAttribute('data-add');
      const foodEl = body.querySelector(`.nm-food[data-meal="${meal}"]`);
      const qtyEl  = body.querySelector(`.nm-qty[data-meal="${meal}"]`);
      const food = (foodEl && foodEl.value || '').trim();
      const qty = Number(qtyEl && qtyEl.value);
      const meta = findFood(food);
      if (!food || !meta || !(qty > 0)) return alert('Pick a known food and enter a quantity');
      const m = macrosFor(food, qty);
      const item = { food, qty, ...m };
      if (!state.nutritionEntries) state.nutritionEntries = { breakfast: [], lunch: [], dinner: [], snacks: [] };
      if (!state.nutritionEntries[meal]) state.nutritionEntries[meal] = [];
      state.nutritionEntries[meal].push(item);
      saveState();

      renderMealList(meal);
      refreshNutriTotalsAndScore?.();
      render?.();
      refreshNutriTotalsAndScore && refreshNutriTotalsAndScore();
      if (typeof render === 'function') render();
      postNutritionReplaceToday();     // mirror the new state to the backend
    });
  });

  // REMOVE handler (delegated, attaches once per open)
  if (body && !body.dataset.rmBound) {
    body.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-remove]');
      if (!btn) return;
      ev.preventDefault();
      ev.stopPropagation();

      const payload = btn.getAttribute('data-remove') || '';
      const [meal, idxStr] = payload.split(':');
      const idx = Number(idxStr);
      if (!meal || Number.isNaN(idx)) return;

      const arr = state.nutritionEntries && state.nutritionEntries[meal];
      if (!Array.isArray(arr) || idx < 0 || idx >= arr.length) return;

      arr.splice(idx, 1);
      saveState();

      try { postNutritionAdd(meal, item); } catch(_) {}

      renderMealList(meal);
      refreshNutriTotalsAndScore?.();
      render?.();
    }, true);
    body.dataset.rmBound = '1';
  }
}



// --- Global UI wiring (runs once on load) ---
function initUI() {
  // Nutrition Update button (opens modal)
  const upd = document.getElementById('btn-nutrition-update');
  if (upd) {
    upd.addEventListener('click', (e) => {
      e.preventDefault();
      openNutritionModal();
    });
  }

  // Inline Water: Save Goal button
  const saveWaterBtn = document.getElementById('btn-save-water');
  if (saveWaterBtn) {
    saveWaterBtn.addEventListener('click', (e) => {
      e.preventDefault();
      setWaterGoalInline();
    });
  }

  // Inline Sleep Save button
  const saveSleepBtn = document.getElementById('btn-set-sleep');
  if (saveSleepBtn) {
    saveSleepBtn.addEventListener('click', (e) => {
      e.preventDefault();
      setSleepTimesInline();
    });
  }
}
// Workout: Save Details button
const saveWorkoutBtn = document.getElementById('btn-save-workout-details');
if (saveWorkoutBtn) {
  saveWorkoutBtn.addEventListener('click', (e) => {
    e.preventDefault();
    saveWorkoutDetails();
  });
}
// Workout history button
const histBtn = document.getElementById('btn-workout-history');
if (histBtn) {
  histBtn.addEventListener('click', (e) => {
    e.preventDefault();
    openWorkoutHistoryModal();
  });
}


// Workout type change toggles Distance/Muscle inputs
const workoutTypeSel = document.getElementById('workout-type');
if (workoutTypeSel) {
  workoutTypeSel.addEventListener('change', () => {
    const type = workoutTypeSel.value;
    state.workoutType = type;

    const distRow = document.getElementById('wd-distance-row');
    const muscleRow = document.getElementById('wd-muscle-row');

    if (distRow) {
      distRow.style.display = (type === 'Running' || type === 'Walking' || type === 'Cycling')
        ? '' : 'none';
    }
    if (muscleRow) {
      muscleRow.style.display = (type === 'Strength')
        ? '' : 'none';
    }

    saveState();
    render();
  });
}

// Run init and render after DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initUI();
  render();
});

// === Section observer for navbar highlight ===
document.addEventListener("DOMContentLoaded", () => {
  const sections = document.querySelectorAll("section.hero");
  const navLinks = document.querySelectorAll("header nav a");

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        navLinks.forEach(link => link.classList.remove("active"));
        const activeLink = document.querySelector(`header nav a[href="#${entry.target.id}"]`);
        if (activeLink) activeLink.classList.add("active");
      }
    });
  }, { threshold: 0.6 });

  sections.forEach(section => observer.observe(section));
});

// Hook login button
document.addEventListener('DOMContentLoaded',()=>{
  gateByLogin();                 // <— add this line at the very top of the block

  const loginBtn   = document.getElementById('btn-login');
  const signupBtn  = document.getElementById('btn-signup');
  const nameInput  = document.getElementById('login-username');
  const passInput  = document.getElementById('login-password');
  const pass2Input = document.getElementById('signup-password2');
  const tabSignin  = document.getElementById('tab-signin');
  const tabSignup  = document.getElementById('tab-signup');
  const msg        = document.getElementById('auth-msg');
  const logoutBtn  = document.getElementById('btn-logout'); // may be null

  function clearMsg(){ if(msg) msg.textContent = ''; }
  function showErr(t){ if(msg) msg.textContent = t; }

  // Default: start on Sign In; user can switch to Sign Up
  if(tabSignin) tabSignin.addEventListener('click', ()=>{ setAuthMode('signin'); clearMsg(); });
  if(tabSignup) tabSignup.addEventListener('click', ()=>{ setAuthMode('signup'); clearMsg(); });
  setAuthMode('signin');

  // STRICT SIGN IN: must match a user created via Sign Up
  if(loginBtn){
    loginBtn.addEventListener('click', async ()=>{
      clearMsg();
      const u = (nameInput?.value || '').trim();
      const p = (passInput?.value || '');
      if(!u || !p) return showErr('Enter username and password');
      const users = loadUsers();
      const rec = users[u];
      if(!rec) return showErr('User not found. Please sign up.');
      const h = await sha256Hex(p);
      if(h !== rec.pwdHash) return showErr('Incorrect password');
      setUserWithId(u, rec.id);
      gateByLogin(); initUserStateIfNeeded(res.userId); state = loadState(); ensureStateOwner(); ensureDailyReset(); render(); if(typeof syncFromBackend==='function') syncFromBackend();    });
  }

  // SIGN UP: create user, then log in
  if(signupBtn){
    signupBtn.addEventListener('click', async ()=>{
      clearMsg();
      const u  = (nameInput?.value  || '').trim();
      const p1 = (passInput?.value  || '');
      const p2 = (pass2Input?.value || '');
      if(!u || !p1 || !p2) return showErr('Fill all fields');
      if(p1.length < 4) return showErr('Password must be at least 4 chars');
      if(p1 !== p2) return showErr('Passwords do not match');
      try {
        const res = await fetch(`${API.BASE}/auth/signup`, {
          method:'POST',
          headers:{'Content-Type':'application/json','Accept':'application/json'},
          body: JSON.stringify({username:u, password:p1})
        }).then(API.json);
        setUserWithId(res.username, res.userId, res.token);
        gateByLogin(); initUserStateIfNeeded(res.userId); state = loadState(); ensureStateOwner(); ensureDailyReset(); render(); if(typeof syncFromBackend==='function') syncFromBackend();      } catch(err){
        console.error('[AUTH] signup failed:', err);
        showErr(err && err.message ? err.message : 'Username already exists or invalid');
      }
    });
  }

  // Enter submits current mode (signup if confirm field visible)
  function handleEnter(e){
    if(e.key !== 'Enter') return;
    const isSignup = (pass2Input && pass2Input.style.display !== 'none');
    if(isSignup && signupBtn) signupBtn.click();
    else if(loginBtn) loginBtn.click();
  }
  nameInput?.addEventListener('keydown', handleEnter);
  passInput?.addEventListener('keydown', handleEnter);
  pass2Input?.addEventListener('keydown', handleEnter);

  // Logout → clear user and reveal login hero
  if(loginBtn){
    loginBtn.addEventListener('click', async ()=>{
      clearMsg();
      const u = (nameInput?.value || '').trim();
      const p = (passInput?.value || '');
      if(!u || !p) return showErr('Enter username and password');
      try {
        const res = await fetch(`${API.BASE}/auth/login`, {
          method:'POST',
          headers:{'Content-Type':'application/json','Accept':'application/json'},
          body: JSON.stringify({username:u, password:p})
        }).then(API.json);
        setUserWithId(res.username, res.userId, res.token);
        gateByLogin(); initUserStateIfNeeded(res.userId); state = loadState(); render(); syncFromBackend?.();
        document.querySelector('#dashboard')?.scrollIntoView({behavior:'smooth', block:'start'});
      } catch(err){
        console.error('[AUTH] signup failed:', err);
        showErr(err && err.message ? err.message : 'Username already exists or invalid');
      }
    });
  }
  // Persist Water Goal from inline input
  const goalInputInline = document.getElementById('goal-input-inline');
  const btnSaveWater = document.getElementById('btn-save-water');
  if (btnSaveWater) {
    btnSaveWater.addEventListener('click', ()=>{
      const v = Math.max(0, Number(goalInputInline?.value || 0));
      if (v > 0) {
        state.waterGoal = Math.round(v);
        saveState();
        render();
      }
    });
  }

  // initial gate
  gateByLogin();
});