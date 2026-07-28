/**
 * GET /planning-admin
 *
 * Page d'administration du planning — protégée côté serveur par Basic
 * Auth (functions/_lib/auth.js). N'est liée dans aucun menu du site
 * public et n'apparaît dans aucun sitemap.
 *
 * Page 100% autonome (HTML+CSS+JS inline dans cette fonction) : elle ne
 * touche à aucun fichier du site public (index.html, css/main.css, etc.)
 * et n'ajoute donc aucun risque de régression visuelle ou fonctionnelle
 * sur le site existant.
 *
 * Consomme /api/admin-blocks (également protégée) pour lire/écrire les
 * réservations Stripe et les blocages manuels.
 */

import { checkAdminAuth } from './_lib/auth.js';

export async function onRequestGet({ request, env }) {
  const authFail = await checkAdminAuth(request, env);
  if (authFail) return authFail;

  return new Response(PAGE_HTML, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

const PAGE_HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Planning — Administration</title>
<style>
  :root{
    --bg:#040c1a; --card:rgba(6,18,44,.85); --border:rgba(0,198,240,.18);
    --text:rgba(220,240,255,.92); --muted:rgba(185,225,255,.6);
    --cold:#00c6f0; --green:#22d366; --red:#ff4d4d; --orange:#ff8a20;
    --r:14px;
  }
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{
    font-family:-apple-system,BlinkMacSystemFont,'Inter',Arial,sans-serif;
    background:var(--bg); color:var(--text); min-height:100vh;
    padding:20px 14px 60px; line-height:1.5;
  }
  h1{font-size:1.3rem; font-weight:700; margin-bottom:4px}
  .sub{color:var(--muted); font-size:.85rem; margin-bottom:20px}
  .card{
    background:var(--card); border:1px solid var(--border); border-radius:var(--r);
    padding:16px; max-width:480px; margin:0 auto 16px; backdrop-filter:blur(10px);
  }
  .nav{display:flex; align-items:center; justify-content:space-between; margin-bottom:14px}
  .nav button{
    background:rgba(0,198,240,.12); border:1px solid var(--border); color:var(--cold);
    width:36px; height:36px; border-radius:10px; font-size:1.1rem; cursor:pointer;
  }
  .nav button:active{background:rgba(0,198,240,.25)}
  .nav .month-title{font-weight:600; font-size:1.05rem; text-transform:capitalize}
  .weekdays{display:grid; grid-template-columns:repeat(7,1fr); gap:4px; margin-bottom:6px}
  .weekdays span{text-align:center; font-size:.7rem; color:var(--muted); font-weight:600}
  .days{display:grid; grid-template-columns:repeat(7,1fr); gap:4px}
  .day{
    aspect-ratio:1; display:flex; align-items:center; justify-content:center;
    border-radius:9px; font-size:.85rem; cursor:pointer; user-select:none;
    border:1px solid transparent; transition:transform .1s;
  }
  .day:active{transform:scale(.92)}
  .day.empty{visibility:hidden; cursor:default}
  .day.past{color:rgba(255,255,255,.2); cursor:default; background:rgba(255,255,255,.02)}
  .day.available{background:rgba(34,211,102,.12); border-color:rgba(34,211,102,.35); color:var(--green)}
  .day.stripe{background:rgba(255,77,77,.18); border-color:rgba(255,77,77,.4); color:#ffb0b0}
  .day.manual{background:rgba(255,138,32,.18); border-color:rgba(255,138,32,.45); color:#ffcb94}
  .legend{display:flex; gap:14px; flex-wrap:wrap; margin-top:16px; font-size:.78rem; color:var(--muted)}
  .legend span{display:inline-flex; align-items:center; gap:6px}
  .dot{width:11px; height:11px; border-radius:4px; display:inline-block}
  .dot.available{background:var(--green)} .dot.stripe{background:var(--red)} .dot.manual{background:var(--orange)}
  .status{
    text-align:center; font-size:.8rem; color:var(--muted); min-height:20px; margin-top:10px;
  }
  .status.error{color:var(--red)}
  .logout{
    display:block; max-width:480px; margin:0 auto; text-align:center;
    color:var(--muted); font-size:.78rem; margin-top:18px;
  }
  .overlay{
    position:fixed; inset:0; background:rgba(4,12,26,.55); display:none;
    align-items:center; justify-content:center; z-index:50;
  }
  .overlay.show{display:flex}
  .spinner{
    width:28px; height:28px; border-radius:50%; border:3px solid rgba(0,198,240,.2);
    border-top-color:var(--cold); animation:spin .7s linear infinite;
  }
  @keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>

  <h1>📅 Planning — Hassan Location</h1>
  <div class="sub">Vert = disponible · Rouge = réservation Stripe · Orange = blocage manuel</div>

  <div class="card">
    <div class="nav">
      <button id="prev" aria-label="Mois précédent">‹</button>
      <div class="month-title" id="month-title">—</div>
      <button id="next" aria-label="Mois suivant">›</button>
    </div>
    <div class="weekdays">
      <span>Lu</span><span>Ma</span><span>Me</span><span>Je</span><span>Ve</span><span>Sa</span><span>Di</span>
    </div>
    <div class="days" id="days"></div>
    <div class="legend">
      <span><i class="dot available"></i>Disponible</span>
      <span><i class="dot stripe"></i>Réservé (Stripe)</span>
      <span><i class="dot manual"></i>Bloqué manuellement</span>
    </div>
    <div class="status" id="status"></div>
  </div>

  <div class="logout">Fermez cet onglet pour vous déconnecter.</div>

  <div class="overlay" id="overlay"><div class="spinner"></div></div>

<script>
(function(){
  'use strict';

  var MFR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

  var state = {
    month: (function(){ var d=new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; })(),
    reservations: [],
    manualBlocks: [],
    loading: false
  };

  var elDays   = document.getElementById('days');
  var elTitle  = document.getElementById('month-title');
  var elStatus = document.getElementById('status');
  var elOverlay= document.getElementById('overlay');

  function setStatus(msg, isError){
    elStatus.textContent = msg || '';
    elStatus.className = 'status' + (isError ? ' error' : '');
  }

  function toISO(y,m,day){
    return y + '-' + String(m+1).padStart(2,'0') + '-' + String(day).padStart(2,'0');
  }

  function findStripeReservation(dateISO){
    var d = new Date(dateISO + 'T12:00:00');
    for (var i=0;i<state.reservations.length;i++){
      var r = state.reservations[i];
      var s = new Date(r.start_date + 'T00:00:00');
      var e = new Date(r.end_date + 'T23:59:59');
      if (d >= s && d <= e) return r;
    }
    return null;
  }

  function dayStatus(dateISO){
    if (state.manualBlocks.indexOf(dateISO) !== -1) return 'manual';
    if (findStripeReservation(dateISO)) return 'stripe';
    return 'available';
  }

  async function loadData(){
    state.loading = true;
    setStatus('Chargement…');
    try{
      var res = await fetch('/api/admin-blocks', { credentials: 'include' });
      if (res.status === 401){ setStatus('Session expirée — rechargez la page.', true); return; }
      var data = await res.json();
      if (!data.ok){ setStatus(data.error || 'Erreur de chargement', true); return; }
      state.reservations = data.reservations;
      state.manualBlocks = data.manualBlocks;
      setStatus('');
    } catch(e){
      setStatus('Erreur de connexion.', true);
    } finally {
      state.loading = false;
      render();
    }
  }

  function render(){
    var y = state.month.getFullYear(), m = state.month.getMonth();
    elTitle.textContent = MFR[m] + ' ' + y;

    var dim   = new Date(y, m+1, 0).getDate();
    var first = (new Date(y, m, 1).getDay() + 6) % 7;
    var today = new Date(); today.setHours(0,0,0,0);

    var html = '';
    for (var i=0;i<first;i++) html += '<span class="day empty"></span>';

    for (var day=1; day<=dim; day++){
      var iso = toISO(y,m,day);
      var d = new Date(y,m,day);
      var past = d < today;
      var st = past ? 'past' : dayStatus(iso);
      html += '<span class="day ' + st + '" data-date="' + iso + '">' + day + '</span>';
    }
    elDays.innerHTML = html;

    elDays.querySelectorAll('.day:not(.empty):not(.past)').forEach(function(el){
      el.addEventListener('click', function(){ onDayClick(el.dataset.date); });
    });
  }

  async function onDayClick(iso){
    var st = dayStatus(iso);

    if (st === 'available'){
      await sendAction({ action:'block-manual', date: iso }, 'Blocage de ' + iso + '…');
    } else if (st === 'manual'){
      await sendAction({ action:'unblock-manual', date: iso }, 'Déblocage de ' + iso + '…');
    } else if (st === 'stripe'){
      var r = findStripeReservation(iso);
      if (!r) return;
      var ok = confirm(
        'Réservation ' + r.id + '\\n' +
        'Du ' + r.start_date + ' au ' + r.end_date + '\\n' +
        (r.client_email ? 'Client : ' + r.client_email + '\\n' : '') +
        '\\nAnnuler cette réservation et libérer TOUTES ses dates ?'
      );
      if (!ok) return;
      await sendAction({ action:'cancel-reservation', reservationId: r.id }, 'Annulation de ' + r.id + '…');
    }
  }

  async function sendAction(body, loadingMsg){
    elOverlay.classList.add('show');
    setStatus(loadingMsg);
    try{
      var res = await fetch('/api/admin-blocks', {
        method:'POST',
        credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(body)
      });
      var data = await res.json();
      if (!res.ok || !data.ok){
        setStatus(data.error || 'Erreur', true);
        return;
      }
      await loadData();
    } catch(e){
      setStatus('Erreur de connexion.', true);
    } finally {
      elOverlay.classList.remove('show');
    }
  }

  document.getElementById('prev').addEventListener('click', function(){
    state.month.setMonth(state.month.getMonth()-1); render();
  });
  document.getElementById('next').addEventListener('click', function(){
    state.month.setMonth(state.month.getMonth()+1); render();
  });

  loadData();
})();
</script>
</body>
</html>`;
