/**
 * GET /planning-admin
 *
 * Page d'administration du planning — protégée côté serveur par Basic
 * Auth (functions/_lib/auth.js). N'est liée dans aucun menu du site
 * public et n'apparaît dans aucun sitemap.
 *
 * Page 100% autonome (HTML+CSS+JS inline dans cette fonction) : elle ne
 * touche à aucun fichier du site public (index.html, css/main.css, etc.)
 *
 * Consomme /api/admin-blocks (également protégée) pour lire/écrire les
 * réservations Stripe et les blocages manuels.
 *
 * v3 :
 *  - Clic sur une date = sélection locale (aucune popup, aucun appel
 *    serveur immédiat). L'admin peut cliquer sur autant de dates qu'il
 *    veut, y compris pour annuler une sélection en recliquant dessus.
 *  - Bouton "Confirmer les modifications" intégré à la page : envoie
 *    tous les changements sélectionnés en une fois.
 *  - Bouton "Annuler la sélection" pour tout déselectionner sans rien
 *    envoyer au serveur.
 *  - Bouton "Déconnexion" → écran récapitulatif de toutes les
 *    modifications confirmées pendant la session, avec un bouton
 *    "Retour au site" intégré qui effectue la déconnexion réelle.
 *  - Déconnexion automatique après 10 minutes d'inactivité (directe,
 *    sans écran récap, puisque personne n'est présent pour le lire).
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
    --cold:#00c6f0; --green:#22d366; --red:#ff4d4d; --orange:#ff8a20; --violet:#8a5cff;
    --r:14px;
  }
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{
    font-family:-apple-system,BlinkMacSystemFont,'Inter',Arial,sans-serif;
    background:var(--bg); color:var(--text); min-height:100vh;
    padding:20px 14px 90px; line-height:1.5;
  }
  .top{display:flex; align-items:flex-start; justify-content:space-between; max-width:480px; margin:0 auto 4px; gap:10px}
  h1{font-size:1.3rem; font-weight:700}
  .sub{color:var(--muted); font-size:.85rem; margin-bottom:20px}
  .logout-btn{
    flex-shrink:0; background:rgba(255,77,77,.12); border:1px solid rgba(255,77,77,.35);
    color:#ffb0b0; font-size:.78rem; font-weight:600; padding:8px 12px; border-radius:10px; cursor:pointer;
  }
  .logout-btn:active{background:rgba(255,77,77,.25)}
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
    border:1px solid transparent; transition:transform .1s; position:relative;
  }
  .day:active{transform:scale(.92)}
  .day.empty{visibility:hidden; cursor:default}
  .day.past{color:rgba(255,255,255,.2); cursor:default; background:rgba(255,255,255,.02)}
  .day.available{background:rgba(34,211,102,.12); border-color:rgba(34,211,102,.35); color:var(--green)}
  .day.stripe{background:rgba(255,77,77,.18); border-color:rgba(255,77,77,.4); color:#ffb0b0}
  .day.manual{background:rgba(255,138,32,.18); border-color:rgba(255,138,32,.45); color:#ffcb94}
  .day.pending{border-style:dashed; border-color:var(--violet); box-shadow:0 0 0 2px rgba(138,92,255,.25) inset}
  .day.pending::after{
    content:''; position:absolute; top:3px; right:3px; width:6px; height:6px;
    border-radius:50%; background:var(--violet);
  }
  .legend{display:flex; gap:14px; flex-wrap:wrap; margin-top:16px; font-size:.78rem; color:var(--muted)}
  .legend span{display:inline-flex; align-items:center; gap:6px}
  .dot{width:11px; height:11px; border-radius:4px; display:inline-block}
  .dot.available{background:var(--green)} .dot.stripe{background:var(--red)} .dot.manual{background:var(--orange)} .dot.pending{background:var(--violet)}
  .status{
    text-align:center; font-size:.8rem; color:var(--muted); min-height:20px; margin-top:10px;
  }
  .status.error{color:var(--red)}
  .status.ok{color:var(--green)}
  .foot-note{
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

  /* Barre de confirmation flottante */
  .confirm-bar{
    position:fixed; left:0; right:0; bottom:0; z-index:40;
    background:rgba(6,18,44,.96); border-top:1px solid var(--border);
    backdrop-filter:blur(14px); padding:12px 14px;
    display:none; align-items:center; justify-content:center; gap:10px; flex-wrap:wrap;
  }
  .confirm-bar.show{display:flex}
  .confirm-bar .count{font-size:.82rem; color:var(--muted); margin-right:4px}
  .confirm-bar button{
    font-size:.85rem; font-weight:600; padding:10px 16px; border-radius:10px; cursor:pointer; border:1px solid transparent;
  }
  .btn-confirm{background:var(--cold); color:#04121e}
  .btn-confirm:active{opacity:.85}
  .btn-reset{background:transparent; border-color:var(--border); color:var(--muted)}
  .btn-reset:active{background:rgba(255,255,255,.06)}

  /* Écran récapitulatif */
  .recap-card{
    background:var(--card); border:1px solid var(--border); border-radius:var(--r);
    padding:20px; max-width:480px; margin:40px auto 0; backdrop-filter:blur(10px);
    display:none;
  }
  .recap-card.show{display:block}
  .recap-card h2{font-size:1.1rem; margin-bottom:4px}
  .recap-card .sub{margin-bottom:16px}
  .recap-list{list-style:none; display:flex; flex-direction:column; gap:8px; margin-bottom:18px; max-height:50vh; overflow-y:auto}
  .recap-list li{
    font-size:.82rem; background:rgba(255,255,255,.03); border:1px solid var(--border);
    border-radius:9px; padding:9px 11px;
  }
  .recap-list li .t{color:var(--muted); font-size:.72rem; display:block; margin-bottom:2px}
  .recap-empty{font-size:.85rem; color:var(--muted); text-align:center; padding:16px 0}
  .btn-back{
    width:100%; background:var(--cold); color:#04121e; font-weight:700; font-size:.9rem;
    padding:13px; border-radius:11px; border:none; cursor:pointer;
  }
  .btn-back:active{opacity:.85}
  #main-view.hidden{display:none}
</style>
</head>
<body>

  <div id="main-view">
    <div class="top">
      <div>
        <h1>📅 Planning — Hassan Location</h1>
        <div class="sub">Vert = disponible · Rouge = réservation Stripe · Orange = blocage manuel</div>
      </div>
      <button class="logout-btn" id="logout-btn">Déconnexion</button>
    </div>

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
        <span><i class="dot pending"></i>Sélectionné (non confirmé)</span>
      </div>
      <div class="status" id="status"></div>
    </div>

    <div class="foot-note">Déconnexion automatique après 10 minutes d'inactivité.</div>
  </div>

  <div class="recap-card" id="recap-view">
    <h2>Récapitulatif de la session</h2>
    <div class="sub">Modifications confirmées pendant cette connexion :</div>
    <ul class="recap-list" id="recap-list"></ul>
    <button class="btn-back" id="back-btn">Retour au site</button>
  </div>

  <div class="confirm-bar" id="confirm-bar">
    <span class="count" id="confirm-count">0 modification(s) sélectionnée(s)</span>
    <button class="btn-reset" id="reset-btn">Annuler la sélection</button>
    <button class="btn-confirm" id="confirm-btn">Confirmer les modifications</button>
  </div>

  <div class="overlay" id="overlay"><div class="spinner"></div></div>

<script>
(function(){
  'use strict';

  var MFR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  var INACTIVITY_LIMIT_MS = 10 * 60 * 1000; // 10 minutes

  var state = {
    month: (function(){ var d=new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; })(),
    reservations: [],
    manualBlocks: []
  };

  /* Sélection locale non confirmée */
  var pendingBlocks       = new Set(); // dates à bloquer
  var pendingUnblocks     = new Set(); // dates à débloquer
  var pendingCancellations= new Set(); // reservationId à annuler

  /* Historique des modifications confirmées (pour l'écran récap) */
  var sessionHistory = [];

  var elDays        = document.getElementById('days');
  var elTitle       = document.getElementById('month-title');
  var elStatus      = document.getElementById('status');
  var elOverlay      = document.getElementById('overlay');
  var elConfirmBar   = document.getElementById('confirm-bar');
  var elConfirmCount = document.getElementById('confirm-count');
  var elMainView     = document.getElementById('main-view');
  var elRecapView    = document.getElementById('recap-view');
  var elRecapList     = document.getElementById('recap-list');

  function setStatus(msg, kind){
    elStatus.textContent = msg || '';
    elStatus.className = 'status' + (kind ? ' ' + kind : '');
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

  /* Statut serveur (sans tenir compte de la sélection locale) */
  function baseStatus(dateISO){
    if (state.manualBlocks.indexOf(dateISO) !== -1) return 'manual';
    if (findStripeReservation(dateISO)) return 'stripe';
    return 'available';
  }

  async function loadData(){
    setStatus('Chargement…');
    try{
      var res = await fetch('/api/admin-blocks', { credentials: 'include' });
      if (res.status === 401){ setStatus('Session expirée — rechargez la page.', 'error'); return; }
      var data = await res.json();
      if (!data.ok){ setStatus(data.error || 'Erreur de chargement', 'error'); return; }
      state.reservations = data.reservations;
      state.manualBlocks = data.manualBlocks;
      setStatus('');
    } catch(e){
      setStatus('Erreur de connexion.', 'error');
    } finally {
      renderCalendar();
    }
  }

  function renderCalendar(){
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
      var cls = 'day';
      if (past){
        cls += ' past';
      } else {
        var base = baseStatus(iso);
        cls += ' ' + base;
        if (isPending(iso, base)) cls += ' pending';
      }
      html += '<span class="' + cls + '" data-date="' + iso + '">' + day + '</span>';
    }
    elDays.innerHTML = html;

    elDays.querySelectorAll('.day:not(.empty):not(.past)').forEach(function(el){
      el.addEventListener('click', function(){ toggleSelection(el.dataset.date); });
    });

    updateConfirmBar();
  }

  function isPending(iso, base){
    if (base === 'available') return pendingBlocks.has(iso);
    if (base === 'manual')    return pendingUnblocks.has(iso);
    if (base === 'stripe'){
      var r = findStripeReservation(iso);
      return !!(r && pendingCancellations.has(r.id));
    }
    return false;
  }

  /* Clic = ajoute/retire de la sélection locale. Aucun appel serveur ici. */
  function toggleSelection(iso){
    var base = baseStatus(iso);

    if (base === 'available'){
      if (pendingBlocks.has(iso)) pendingBlocks.delete(iso); else pendingBlocks.add(iso);
    } else if (base === 'manual'){
      if (pendingUnblocks.has(iso)) pendingUnblocks.delete(iso); else pendingUnblocks.add(iso);
    } else if (base === 'stripe'){
      var r = findStripeReservation(iso);
      if (!r) return;
      if (pendingCancellations.has(r.id)) pendingCancellations.delete(r.id); else pendingCancellations.add(r.id);
    }

    renderCalendar();
  }

  function pendingCount(){
    return pendingBlocks.size + pendingUnblocks.size + pendingCancellations.size;
  }

  function updateConfirmBar(){
    var n = pendingCount();
    if (n > 0){
      elConfirmBar.classList.add('show');
      elConfirmCount.textContent = n + ' modification' + (n>1?'s':'') + ' sélectionnée' + (n>1?'s':'');
    } else {
      elConfirmBar.classList.remove('show');
    }
  }

  function resetSelection(){
    pendingBlocks.clear(); pendingUnblocks.clear(); pendingCancellations.clear();
    setStatus('');
    renderCalendar();
  }

  function nowLabel(){
    var d = new Date();
    return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  }

  /* Envoie toutes les modifications sélectionnées au serveur */
  async function confirmSelection(){
    if (pendingCount() === 0) return;
    elOverlay.classList.add('show');
    setStatus('Envoi des modifications…');

    var ops = [];
    pendingBlocks.forEach(function(date){ ops.push({ body:{action:'block-manual', date: date}, label:'Blocage manuel du ' + date }); });
    pendingUnblocks.forEach(function(date){ ops.push({ body:{action:'unblock-manual', date: date}, label:'Déblocage manuel du ' + date }); });
    pendingCancellations.forEach(function(id){
      var r = state.reservations.find(function(x){ return x.id === id; });
      var label = r
        ? 'Annulation réservation ' + id + ' (libère ' + r.start_date + ' → ' + r.end_date + ')'
        : 'Annulation réservation ' + id;
      ops.push({ body:{action:'cancel-reservation', reservationId: id}, label: label });
    });

    var okCount = 0, failCount = 0;

    for (var i=0; i<ops.length; i++){
      var op = ops[i];
      try{
        var res = await fetch('/api/admin-blocks', {
          method:'POST', credentials:'include',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify(op.body)
        });
        var data = await res.json();
        if (res.ok && data.ok){
          okCount++;
          sessionHistory.push({ time: nowLabel(), text: op.label });
          if (op.body.action === 'block-manual') pendingBlocks.delete(op.body.date);
          if (op.body.action === 'unblock-manual') pendingUnblocks.delete(op.body.date);
          if (op.body.action === 'cancel-reservation') pendingCancellations.delete(op.body.reservationId);
        } else {
          failCount++;
        }
      } catch(e){
        failCount++;
      }
    }

    await loadData();
    elOverlay.classList.remove('show');

    if (failCount === 0){
      setStatus(okCount + ' modification(s) confirmée(s).', 'ok');
    } else {
      setStatus(okCount + ' réussie(s), ' + failCount + ' échouée(s) — réessayez.', 'error');
    }
  }

  document.getElementById('prev').addEventListener('click', function(){
    state.month.setMonth(state.month.getMonth()-1); renderCalendar();
  });
  document.getElementById('next').addEventListener('click', function(){
    state.month.setMonth(state.month.getMonth()+1); renderCalendar();
  });
  document.getElementById('reset-btn').addEventListener('click', resetSelection);
  document.getElementById('confirm-btn').addEventListener('click', confirmSelection);

  /* ── Déconnexion réelle (Basic Auth → écrase le cache navigateur) ── */
  function hardLogout(){
    fetch('/planning-admin', {
      headers: { 'Authorization': 'Basic ' + btoa('logout:logout') },
      cache: 'no-store'
    }).catch(function(){}).finally(function(){
      window.location.href = '/index.html';
    });
  }

  /* ── Bouton Déconnexion → écran récapitulatif ── */
  function showRecap(){
    if (pendingCount() > 0){
      setStatus('Vous avez ' + pendingCount() + ' modification(s) non confirmée(s). Confirmez-les ou annulez la sélection avant de vous déconnecter.', 'error');
      return;
    }
    if (sessionHistory.length === 0){
      elRecapList.innerHTML = '<div class="recap-empty">Aucune modification effectuée pendant cette session.</div>';
    } else {
      elRecapList.innerHTML = sessionHistory.map(function(h){
        return '<li><span class="t">' + h.time + '</span>' + h.text + '</li>';
      }).join('');
    }
    elMainView.classList.add('hidden');
    elConfirmBar.classList.remove('show');
    elRecapView.classList.add('show');
  }

  document.getElementById('logout-btn').addEventListener('click', showRecap);
  document.getElementById('back-btn').addEventListener('click', hardLogout);

  /* ── Déconnexion automatique après inactivité (directe, sans récap) ── */
  var inactivityTimer = null;
  function resetInactivityTimer(){
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(hardLogout, INACTIVITY_LIMIT_MS);
  }
  ['mousemove','mousedown','keydown','touchstart','scroll'].forEach(function(evt){
    document.addEventListener(evt, resetInactivityTimer, { passive: true });
  });
  resetInactivityTimer();

  loadData();
})();
</script>
</body>
</html>`;
