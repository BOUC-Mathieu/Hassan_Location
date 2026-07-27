/* ═══════════════════════════════════════════════════════════════════
   HASSAN LOCATION — js/config.js
   Configuration centrale du site.

   ⚠️  SEUL CE FICHIER À MODIFIER pour changer :
       - les coordonnées,
       - les prix,
       - la clé Stripe publique.

   La tarification doit rester IDENTIQUE à celle de
   functions/api/checkout.js (serveur recalcule et valide).
   ═══════════════════════════════════════════════════════════════════ */

window.SITE_CONFIG = (function () {

  /* ─── Contact ─────────────────────────────────────────────── */
  var PHONE         = '0693397792';
  var PHONE_DISPLAY = '0693 39 77 92';
  var WHATSAPP      = '262693397792';
  var EMAIL         = 'contact@hassan-location.re';

  /* ─── Stripe (clé PUBLIQUE uniquement — pk_live_ ou pk_test_) ─ */
  var STRIPE_PUBLIC_KEY = 'pk_test_51TxKygQ4OOddmt1dysPugPio1SBmdaIiCRHDx0KOaDfZi4lNEmlNSu6JgQj4iR5UisnNCPUSeibPK6vEleztKA3600WiwVXqpu';

  /* ─── Tarification ─────────────────────────────────────────── */
  /* DOIT correspondre à la fonction calcAmounts() dans           */
  /* functions/api/checkout.js — toute modification doit être     */
  /* répercutée dans les deux fichiers.                           */
  var RATES = [
    { minDays: 1, maxDays: 3,        pricePerDay: 180, label: 'Tarif standard',      discount: '' },
    { minDays: 4, maxDays: 7,        pricePerDay: 165, label: 'Tarif semaine',        discount: '-8%' },
    { minDays: 8, maxDays: Infinity, pricePerDay: 150, label: 'Tarif longue durée',   discount: '-17%' }
  ];
  var DEPOSIT_PERCENT = 30; // % de l'acompte

  /* ─── Helpers ──────────────────────────────────────────────── */
  function getRate(days) {
    for (var i = RATES.length - 1; i >= 0; i--) {
      if (days >= RATES[i].minDays) return RATES[i];
    }
    return RATES[0];
  }

  function calcTotal(days) {
    var r       = getRate(days);
    var total   = days * r.pricePerDay;
    var deposit = Math.ceil(total * DEPOSIT_PERCENT / 100);
    return {
      days:     days,
      rate:     r.pricePerDay,
      label:    r.label,
      discount: r.discount,
      total:    total,
      deposit:  deposit
    };
  }

  return {
    PHONE:            PHONE,
    PHONE_DISPLAY:    PHONE_DISPLAY,
    WHATSAPP:         WHATSAPP,
    EMAIL:            EMAIL,
    STRIPE_PUBLIC_KEY: STRIPE_PUBLIC_KEY,
    RATES:            RATES,
    DEPOSIT_PERCENT:  DEPOSIT_PERCENT,
    getRate:          getRate,
    calcTotal:        calcTotal
  };
})();
