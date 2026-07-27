/* ═══════════════════════════════════════════════════════
   HASSAN LOCATION — main.js
   Particules neige · Header scroll · Scroll reveal
   ═══════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── SNOWFLAKE PARTICLES ─────────────────────────── */
  function initParticles() {
    var cv = document.getElementById('cv');
    if (!cv) return;
    var ctx = cv.getContext('2d');

    function resize() {
      cv.width  = window.innerWidth;
      cv.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize, { passive: true });

    var N = 65;
    var flakes = Array.from({ length: N }, function () {
      return {
        x:  Math.random() * window.innerWidth,
        y:  Math.random() * window.innerHeight,
        r:  Math.random() * 1.6 + 0.4,
        vx: (Math.random() - .5) * 0.35,
        vy: Math.random() * 0.48 + 0.12,
        op: Math.random() * 0.45 + 0.08,
        ph: Math.random() * Math.PI * 2
      };
    });

    var frame = 0;
    function draw() {
      ctx.clearRect(0, 0, cv.width, cv.height);
      frame++;
      flakes.forEach(function (f) {
        f.x += f.vx + Math.sin(frame * .005 + f.ph) * .12;
        f.y += f.vy;
        if (f.y > cv.height + 4) { f.y = -4; f.x = Math.random() * cv.width; }
        if (f.x < -4)             f.x = cv.width  + 4;
        if (f.x > cv.width  + 4)  f.x = -4;

        var s = f.r * 3.8;
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.globalAlpha = f.op * (.78 + .22 * Math.sin(frame * .018 + f.ph));
        ctx.strokeStyle = '#b0e4ff';
        ctx.lineWidth   = f.r * .55;
        ctx.lineCap     = 'round';
        for (var i = 0; i < 6; i++) {
          ctx.beginPath();
          var a = (i / 6) * Math.PI * 2;
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(a) * s, Math.sin(a) * s);
          ctx.stroke();
        }
        ctx.restore();
      });
      requestAnimationFrame(draw);
    }
    draw();
  }

  /* ── HEADER SCROLL ───────────────────────────────── */
  function initHeader() {
    var hdr = document.getElementById('hdr');
    if (!hdr) return;
    window.addEventListener('scroll', function () {
      hdr.classList.toggle('scrolled', window.scrollY > 40);
    }, { passive: true });
  }

  /* ── SCROLL REVEAL ───────────────────────────────── */
  function initReveal() {
    var els = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: .12, rootMargin: '0px 0px -32px 0px' });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ── INIT ────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', function () {
    initParticles();
    initHeader();
    initReveal();
  });

})();
