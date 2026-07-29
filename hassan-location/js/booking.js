/* ═══════════════════════════════════════════════════════════════════
   HASSAN LOCATION — js/booking.js
   Modal : Calendrier (dates API) → Paiement → /api/checkout → Stripe
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var state = {
    currentStep: 1, startDate: null, endDate: null,
    days: 0, rate: 0, total: 0, deposit: 0,
    rateTag: '', discount: '', payOption: null,
    calMonth: null, blockedRanges: [], consent: false,
    pickupTime: '09:00'
  };

  /* ── Case à cocher CGV / Contrat de location (obligatoire) ── */
  function updatePayBtnState() {
    var bp = document.getElementById('bk-btn-pay');
    if (bp) bp.disabled = !(state.payOption && state.consent);
  }

  /* ── Tarification (affichage seulement — serveur recalcule) ── */
  function getRate(d) {
    var c = window.SITE_CONFIG;
    if (c) return c.getRate(d);
    if (d >= 8) return { pricePerDay: 160, label: 'Tarif longue durée', discount: '-11%' };
    if (d >= 4) return { pricePerDay: 170, label: 'Tarif semaine',      discount: '-6%' };
    return              { pricePerDay: 180, label: 'Tarif standard',     discount: '' };
  }

  /* ── Chargement dates bloquées depuis /api/availability ── */
  async function loadBlockedDates() {
    try {
      var res = await fetch('/api/availability');
      var data = await res.json();
      state.blockedRanges = (data && data.blocked) ? data.blocked : [];
    } catch (e) { state.blockedRanges = []; }
    renderCalendar();
  }

  function isBlocked(date) {
    return state.blockedRanges.some(function (r) {
      var s = new Date(r.start_date + 'T00:00:00');
      var e = new Date(r.end_date   + 'T23:59:59');
      return date >= s && date <= e;
    });
  }

  function rangeHasBlocked(start, end) {
    return state.blockedRanges.some(function (r) {
      var s = new Date(r.start_date + 'T00:00:00');
      var e = new Date(r.end_date   + 'T23:59:59');
      return s <= end && e >= start;
    });
  }

  function fmtDate(d) {
    if (!d) return '';
    return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' });
  }

  function toISO(d) {
    if (!d) return '';
    return d.getFullYear() + '-' +
           String(d.getMonth() + 1).padStart(2,'0') + '-' +
           String(d.getDate()).padStart(2,'0');
  }

  /* ── Progression ── */
  function updateProgress(step) {
    for (var i = 1; i <= 3; i++) {
      var dot  = document.getElementById('bk-dot-'  + i);
      var line = document.getElementById('bk-line-' + i);
      var wrap = document.getElementById('bk-wrap-' + i);
      if (!dot) continue;
      dot.classList.remove('active','done');
      if (wrap) wrap.classList.remove('active');
      if (i < step)  { dot.classList.add('done');  dot.textContent = '✓'; }
      if (i === step){ dot.classList.add('active'); dot.textContent = i; if (wrap) wrap.classList.add('active'); }
      if (i > step)    dot.textContent = i;
      if (line && i < 3) line.classList.toggle('done', i < step);
    }
  }

  function showPanel(step) {
    state.currentStep = step;
    document.querySelectorAll('.bk-panel').forEach(function(p){ p.classList.remove('active'); });
    var p = document.getElementById('bk-panel-' + step);
    if (p) p.classList.add('active');
    updateProgress(step);
  }

  /* ── Calendrier ── */
  var MFR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  var DFR = ['Lu','Ma','Me','Je','Ve','Sa','Di'];

  function renderMonth(y, m) {
    var dim   = new Date(y, m + 1, 0).getDate();
    var first = (new Date(y, m, 1).getDay() + 6) % 7;
    var today = new Date(); today.setHours(0,0,0,0);
    var h = '<div class="cal-month"><div class="cal-month-title">' + MFR[m] + ' ' + y + '</div>';
    h += '<div class="cal-weekdays">';
    DFR.forEach(function(d){ h += '<span>' + d + '</span>'; });
    h += '</div><div class="cal-days">';
    for (var i = 0; i < first; i++) h += '<span class="cal-day"></span>';
    for (var day = 1; day <= dim; day++) {
      var d       = new Date(y, m, day);
      var past    = d < today;
      var blocked = !past && isBlocked(d);
      var inRange = !!(state.startDate && state.endDate && d > state.startDate && d < state.endDate);
      var isS     = !!(state.startDate && d.toDateString() === state.startDate.toDateString());
      var isE     = !!(state.endDate   && d.toDateString() === state.endDate.toDateString());
      var cls = 'cal-day';
      if (past)         cls += ' past';
      else if (blocked) cls += ' blocked';
      else              cls += ' selectable';
      if (inRange) cls += ' in-range';
      if (isS)     cls += ' start';
      if (isE)     cls += ' end';
      var ds = y + '-' + String(m+1).padStart(2,'0') + '-' + String(day).padStart(2,'0');
      h += '<span class="' + cls + '" data-date="' + ds + '">' + day + '</span>';
    }
    return h + '</div></div>';
  }

  function renderCalendar() {
    var grid = document.getElementById('cal-grid');
    if (!grid) return;
    var m   = state.calMonth, y1 = m.getFullYear(), mo1 = m.getMonth();
    var mo2 = mo1 === 11 ? 0 : mo1+1, y2 = mo1 === 11 ? y1+1 : y1;
    grid.innerHTML = renderMonth(y1, mo1) + renderMonth(y2, mo2);
    grid.querySelectorAll('.cal-day.selectable').forEach(function(el){
      el.addEventListener('click', function(){ onDayClick(el.dataset.date); });
    });
  }

  function onDayClick(ds) {
    var d = new Date(ds + 'T12:00:00');
    if (!state.startDate || (state.startDate && state.endDate)) {
      state.startDate = d; state.endDate = null;
    } else {
      if (d <= state.startDate) { state.startDate = d; state.endDate = null; }
      else {
        if (rangeHasBlocked(state.startDate, d)) { showCalErr('Cette plage contient des dates déjà réservées.'); return; }
        state.endDate = d;
        recalc();
      }
    }
    hideCalErr(); renderCalendar(); updateSummary();
  }

  function recalc() {
    if (!state.startDate || !state.endDate) return;
    var days = Math.ceil((state.endDate - state.startDate) / 86400000);
    if (days < 1) return;
    var r          = getRate(days);
    var depPct     = (window.SITE_CONFIG && window.SITE_CONFIG.DEPOSIT_PERCENT) || 30;
    state.days     = days;
    state.rate     = r.pricePerDay;
    state.total    = days * r.pricePerDay;
    state.deposit  = Math.ceil(state.total * depPct / 100);
    state.rateTag  = r.label;
    state.discount = r.discount || '';
  }

  function updateSummary() {
    var sum  = document.getElementById('cal-summary');
    var btn  = document.getElementById('bk-btn-next-1');
    var ptc  = document.getElementById('pickup-time-card');
    if (!sum) return;
    if (!state.startDate || !state.endDate || state.days < 1) {
      sum.classList.remove('visible'); if (btn) btn.disabled = true;
      if (ptc) ptc.classList.remove('visible');
      return;
    }
    sum.classList.add('visible');
    if (ptc) ptc.classList.add('visible');
    var q = function(id){ return sum.querySelector('#' + id); };
    if (q('cs-dates')) q('cs-dates').textContent = fmtDate(state.startDate) + ' → ' + fmtDate(state.endDate);
    if (q('cs-days'))  q('cs-days').textContent  = state.days + ' jour(s)';
    if (q('cs-rate'))  q('cs-rate').textContent  = state.rate + '€/jour';
    var b = q('cs-badge');
    if (b) { if (state.discount){ b.textContent = state.discount; b.style.display = ''; } else b.style.display = 'none'; }
    if (q('cs-total')) q('cs-total').textContent = state.total.toLocaleString('fr-FR') + '€';
    var rd = document.getElementById('pickup-time-return-date');
    if (rd) rd.textContent = fmtDate(state.endDate);
    if (btn) btn.disabled = false;
  }

  function showCalErr(m) { var e = document.getElementById('cal-error'); if(e){ e.textContent=m; e.style.display='block'; } }
  function hideCalErr()  { var e = document.getElementById('cal-error'); if(e) e.style.display='none'; }

  /* ── Étape paiement ── */
  function initPay() {
    var set = function(id,v){ var e=document.getElementById(id); if(e) e.textContent=v; };
    set('pay-deposit-amt',  state.deposit.toLocaleString('fr-FR') + '€');
    set('pay-full-amt',     state.total.toLocaleString('fr-FR')   + '€');
    set('pay-deposit-note', 'Solde ' + (state.total - state.deposit).toLocaleString('fr-FR') + '€ à la remise des clés');
    set('pay-full-note',    state.days + ' j × ' + state.rate + '€ = ' + state.total.toLocaleString('fr-FR') + '€');
  }

  window.selectPayOption = function(opt) {
    state.payOption = opt;
    document.querySelectorAll('.pay-card').forEach(function(c){ c.classList.remove('selected'); });
    var card = document.getElementById('pay-card-' + opt);
    if (card) card.classList.add('selected');
    var recap = document.getElementById('pay-recap');
    if (recap) {
      var lbl = opt === 'deposit'
        ? 'Acompte 30% = <strong>' + state.deposit.toLocaleString('fr-FR') + '€</strong> · Solde ' + (state.total - state.deposit).toLocaleString('fr-FR') + '€ à la prise en charge'
        : 'Paiement intégral = <strong>' + state.total.toLocaleString('fr-FR') + '€</strong>';
      recap.innerHTML = '📅 Du ' + fmtDate(state.startDate) + ' au ' + fmtDate(state.endDate) +
        '<br>🕐 Prise en charge à ' + state.pickupTime.replace(':', 'h') + ' · Restitution à la même heure' +
        '<br>⏱ ' + state.days + ' j × ' + state.rate + '€' +
        (state.discount ? ' <span class="badge-discount">' + state.discount + '</span>' : '') +
        '<br>💳 ' + lbl;
      recap.classList.add('visible');
    }
    updatePayBtnState();
  };

  /* ── Appel /api/checkout → redirection Stripe ── */
  async function goToStripe() {
    if (!state.payOption || !state.startDate || !state.endDate) return;
    if (!state.consent) {
      var wrap = document.getElementById('consent-check-wrap');
      var err  = document.getElementById('consent-error-msg');
      if (wrap) wrap.classList.add('error');
      if (err)  err.classList.add('visible');
      return;
    }
    showPanel(3);
    hideStripeErr();
    try {
      var res  = await fetch('/api/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate:     toISO(state.startDate),
          endDate:       toISO(state.endDate),
          paymentOption: state.payOption,
          pickupTime:    state.pickupTime
        })
      });
      var data = await res.json();
      if (!res.ok || !data.url) {
        showPanel(2);
        showStripeErr(data.error || 'Une erreur est survenue. Veuillez réessayer.');
        return;
      }
      try {
        sessionStorage.setItem('hl_pending', JSON.stringify({
          startDate: toISO(state.startDate), endDate: toISO(state.endDate),
          days: state.days, total: state.total, option: state.payOption,
          pickupTime: state.pickupTime, ts: Date.now()
        }));
      } catch(e){}
      window.location.href = data.url;
    } catch(e) {
      showPanel(2);
      showStripeErr('Erreur de connexion. Vérifiez votre connexion internet et réessayez.');
    }
  }

  function showStripeErr(m) { var e=document.getElementById('stripe-error-msg'); if(e){ e.textContent=m; e.style.display='block'; } }
  function hideStripeErr()  { var e=document.getElementById('stripe-error-msg'); if(e) e.style.display='none'; }

  /* ── Open / Close modal ── */
  function openModal() {
    var ov = document.getElementById('bk-overlay');
    if (!ov) return;
    ov.classList.add('open');
    document.body.style.overflow = 'hidden';
    var today = new Date(); today.setDate(1);
    state.calMonth = today; state.startDate = null; state.endDate = null; state.payOption = null; state.consent = false; state.pickupTime = '09:00';
    loadBlockedDates();
    showPanel(1);
    var bn = document.getElementById('bk-btn-next-1'); if(bn) bn.disabled = true;
    var rc = document.getElementById('pay-recap'); if(rc) rc.classList.remove('visible');
    var sm = document.getElementById('cal-summary'); if(sm) sm.classList.remove('visible');
    var pt = document.getElementById('pickup-time-card'); if(pt) pt.classList.remove('visible');
    var pts = document.getElementById('pickup-time-select'); if(pts) pts.value = '09:00';
    var cc = document.getElementById('consent-cgv'); if(cc) cc.checked = false;
    var cw = document.getElementById('consent-check-wrap'); if(cw) cw.classList.remove('error');
    var ce = document.getElementById('consent-error-msg'); if(ce) ce.classList.remove('visible');
    hideStripeErr();
  }

  function closeModal() {
    var ov = document.getElementById('bk-overlay');
    if (ov) ov.classList.remove('open');
    document.body.style.overflow = '';
  }

  /* ── Init ── */
  document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('[data-open-booking]').forEach(function(btn){ btn.addEventListener('click', openModal); });
    var bc = document.getElementById('bk-close'); if(bc) bc.addEventListener('click', closeModal);
    var ov = document.getElementById('bk-overlay');
    if (ov) ov.addEventListener('click', function(e){ if(e.target===ov) closeModal(); });
    document.addEventListener('keydown', function(e){ if(e.key==='Escape') closeModal(); });
    var cp = document.getElementById('cal-prev');
    var cn = document.getElementById('cal-next');
    if (cp) cp.addEventListener('click', function(){ state.calMonth.setMonth(state.calMonth.getMonth()-1); renderCalendar(); });
    if (cn) cn.addEventListener('click', function(){ state.calMonth.setMonth(state.calMonth.getMonth()+1); renderCalendar(); });
    var bn1 = document.getElementById('bk-btn-next-1');
    if (bn1) { bn1.disabled=true; bn1.addEventListener('click', function(){ if(!state.startDate||!state.endDate||state.days<1) return; initPay(); showPanel(2); }); }
    var bp = document.getElementById('bk-btn-pay');
    if (bp) { bp.disabled=true; bp.addEventListener('click', goToStripe); }
    var pts = document.getElementById('pickup-time-select');
    if (pts) { pts.addEventListener('change', function(){ state.pickupTime = pts.value; }); }
    var cc = document.getElementById('consent-cgv');
    if (cc) {
      cc.addEventListener('change', function () {
        state.consent = cc.checked;
        if (cc.checked) {
          var cw = document.getElementById('consent-check-wrap'); if(cw) cw.classList.remove('error');
          var ce = document.getElementById('consent-error-msg'); if(ce) ce.classList.remove('visible');
        }
        updatePayBtnState();
      });
    }
    if (window.location.search.includes('cancelled=true')) { openModal(); history.replaceState({},'',' '); }
  });
})();
