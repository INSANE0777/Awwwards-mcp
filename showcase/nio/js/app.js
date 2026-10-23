/* ============================================================
   NEUTOMNI — private study recreation
   Design, copy and assets belong to the original owners.
   Not for publication.
   ============================================================ */

(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mobileMQ = window.matchMedia('(max-width: 768px)');
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (v, a = 0, b = 1) => {
    const t = clamp((v - a) / (b - a || 1), 0, 1);
    return t * t * (3 - 2 * t);
  };

  document.documentElement.classList.add('js');
  document.body.classList.add('is-loading');

  /* ---------- stable barcodes ---------- */
  function barcode(el, seed) {
    let s = seed * 9301 + 49297;
    const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    let x = 0;
    const bars = [];
    while (x < 300) {
      const w = rand() > 0.55 ? 4 : 2;
      if (rand() > 0.32) bars.push(`<rect x="${x}" y="0" width="${w}" height="48"/>`);
      x += w + (rand() > 0.5 ? 3 : 2);
    }
    el.innerHTML = `<svg viewBox="0 0 300 48" preserveAspectRatio="none" width="100%" height="100%" fill="#cf1830" aria-hidden="true">${bars.join('')}</svg>`;
  }
  $$('.barcode').forEach((el, i) => barcode(el, i + 3));

  /* ---------- round CTA text ---------- */
  $$('.circle-cta-ring').forEach((ring, i) => {
    const id = `cp${i}`;
    ring.innerHTML = `<svg class="circle-text" viewBox="0 0 200 200" aria-hidden="true">
      <defs><path id="${id}" d="M100,100 m-78,0 a78,78 0 1,1 156,0 a78,78 0 1,1 -156,0"/></defs>
      <text><textPath href="#${id}" startOffset="0">EXPLORE MORE · EXPLORE MORE · </textPath></text>
    </svg>`;
  });

  /* ---------- local time ---------- */
  function updateTimes() {
    const now = new Date();
    let time = '00:00:00', gmt = 'GMT+2';
    try {
      time = now.toLocaleTimeString('en-GB', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', timeZoneName: 'shortOffset' }).formatToParts(now);
      const tz = parts.find(p => p.type === 'timeZoneName');
      if (tz) gmt = tz.value.replace('UTC', 'GMT');
    } catch (e) { /* fall back */ }
    $$('[data-local-time]').forEach(el => {
      const text = `${time} (${gmt})`;
      if (el.tagName === 'P' || el.classList.contains('menu-time')) el.innerHTML = `local time<br>${text}`;
      else el.textContent = text;
    });
    const date = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const clock = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    $$('[data-xp-date]').forEach(el => { el.textContent = date; });
    $$('[data-xp-time]').forEach(el => { el.textContent = clock; });
  }
  updateTimes();
  setInterval(updateTimes, 1000);

  /* ---------- pricing fit ---------- */
  function fitComputer() {
    const fit = Math.max(window.innerWidth / 1440, window.innerHeight / 900);
    const wrap = $('#computer-fit');
    if (wrap) wrap.style.setProperty('--fit', fit.toFixed(4));
  }
  fitComputer();

  /* ---------- cookie ---------- */
  const cookie = $('#cookie');
  const cookieKey = 'neutomni-study-cookie';
  try {
    if (localStorage.getItem(cookieKey)) cookie.classList.add('is-hidden');
  } catch (e) { /* private mode */ }
  const dismissCookie = (choice) => {
    cookie.classList.add('is-hidden');
    try { localStorage.setItem(cookieKey, choice); } catch (e) { /* ignore */ }
  };
  $$('[data-cookie]').forEach(btn => btn.addEventListener('click', () => dismissCookie(btn.dataset.cookie)));
  $('#cookie-close').addEventListener('click', () => dismissCookie('closed'));

  /* ---------- menu ---------- */
  const menu = $('#menu-overlay');
  const toggle = $('#menu-toggle');
  const closeBtn = $('#menu-close');
  let menuOpen = false;
  function setMenu(open) {
    menuOpen = open;
    menu.classList.toggle('is-open', open);
    document.body.classList.toggle('menu-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-hidden', String(!open));
    if (window.lenis) open ? window.lenis.stop() : window.lenis.start();
  }
  toggle.addEventListener('click', () => setMenu(!menuOpen));
  closeBtn.addEventListener('click', () => setMenu(false));
  $$('.menu-links a').forEach(a => a.addEventListener('click', () => setMenu(false)));

  /* ---------- smooth anchors ---------- */
  function goTo(hash) {
    const target = document.querySelector(hash);
    if (!target) return;
    if (window.lenis) window.lenis.scrollTo(target, { duration: 1.35, offset: 0 });
    else target.scrollIntoView({ behavior: 'smooth' });
  }
  $$('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const hash = a.getAttribute('href');
      if (!hash || hash === '#') return;
      const target = document.querySelector(hash);
      if (!target) return;
      e.preventDefault();
      setMenu(false);
      goTo(hash);
    });
  });

  /* ---------- XP desktop ---------- */
  let zTop = 50;
  function openWindow(name) {
    const win = document.querySelector(`[data-window="${name}"]`);
    if (!win) return;
    win.classList.add('is-open');
    win.style.zIndex = String(++zTop);
  }
  $$('.xp-icon').forEach(btn => btn.addEventListener('click', () => openWindow(btn.dataset.open)));
  $$('[data-close]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    const win = document.querySelector(`[data-window="${btn.dataset.close}"]`);
    if (win) win.classList.remove('is-open');
  }));
  $$('.xp-window').forEach(win => {
    const bar = win.querySelector('.xp-titlebar');
    const close = win.querySelector('.win-close');
    if (close) close.addEventListener('click', e => { e.stopPropagation(); win.classList.remove('is-open'); });
    if (!bar || win.classList.contains('pricing-window')) return;
    let drag = null;
    bar.addEventListener('pointerdown', e => {
      if (e.target.closest('.win-close')) return;
      const r = win.getBoundingClientRect();
      const cs = getComputedStyle(win);
      drag = {
        x: e.clientX, y: e.clientY,
        left: parseFloat(cs.left) || 0,
        top: parseFloat(cs.top) || 0,
        scale: (r.width / (win.offsetWidth || 1)) || 1
      };
      win.style.zIndex = String(++zTop);
      bar.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    bar.addEventListener('pointermove', e => {
      if (!drag) return;
      const nx = clamp(drag.left + (e.clientX - drag.x) / drag.scale, 0, 1440 - 80);
      const ny = clamp(drag.top + (e.clientY - drag.y) / drag.scale, 0, 900 - 40);
      win.style.left = `${nx}px`;
      win.style.top = `${ny}px`;
    });
    const end = () => { drag = null; };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
  });
  $$('.t-tab').forEach(tab => tab.addEventListener('click', () => {
    const i = tab.dataset.client;
    $$('.t-tab').forEach(t => { t.classList.remove('is-active'); t.setAttribute('aria-selected', 'false'); });
    tab.classList.add('is-active');
    tab.setAttribute('aria-selected', 'true');
    $$('.t-pane').forEach(p => p.classList.toggle('is-active', p.dataset.pane === i));
  }));

  /* ---------- morph shapes (CTA + footer O) ---------- */
  function polyPath(cx, cy, R, n, rot, steps = 200) {
    let d = '';
    for (let i = 0; i <= steps; i++) {
      const th = (i / steps) * Math.PI * 2;
      const seg = (Math.PI * 2) / n;
      const a = ((th % seg) + seg) % seg - seg / 2;
      const r = R * Math.cos(Math.PI / n) / Math.cos(a);
      const x = cx + Math.cos(th + rot) * r;
      const y = cy + Math.sin(th + rot) * r;
      d += (i ? 'L' : 'M') + x.toFixed(2) + ' ' + y.toFixed(2);
    }
    return d + 'Z';
  }

  /* Footer O: the reference loops shape1→…→shape7→shape1, 1s per step,
     power2.inOut, +60° rotation each step. */
  (() => {
    const path = $('#footer-o-path');
    if (!path) return;
    const SHAPES = [
      'M796 78L856 138L796 198L736 138L796 78Z',
      'M795.961 77.9609L853.025 119.42L831.229 186.502H760.694L738.898 119.42L795.961 77.9609Z',
      'M796.039 77.9609L848 107.961V167.961L796.039 197.961L744.077 167.961V107.961L796.039 77.9609Z',
      'M796 78L842.91 100.591L854.496 151.351L822.033 192.058H769.967L737.504 151.351L749.09 100.591L796 78Z',
      'M796.039 77.9609L838.465 95.5345L856.039 137.961L838.465 180.387L796.039 197.961L753.612 180.387L736.039 137.961L753.612 95.5345L796.039 77.9609Z',
      'M796.039 78.0391L834.606 92.0764L855.127 127.62L848 168.039L816.56 194.421H775.517L744.077 168.039L736.95 127.62L757.471 92.0764L796.039 78.0391Z',
      'M796 78L831.267 89.459L853.063 119.459V156.541L831.267 186.541L796 198L760.733 186.541L738.937 156.541V119.459L760.733 89.459L796 78Z'
    ];
    const CX = 796;
    const CY = 138;
    const N = 180;

    const parse = d => {
      const pts = [];
      const tok = d.match(/[a-zA-Z]|-?\d*\.?\d+/g) || [];
      let x = 0, y = 0, cmd = '';
      for (let i = 0; i < tok.length;) {
        const t = tok[i++];
        if (/[a-zA-Z]/.test(t)) { cmd = t; continue; }
        const v = parseFloat(t);
        if (cmd === 'M' || cmd === 'L') { x = v; y = parseFloat(tok[i++]); pts.push([x, y]); }
        else if (cmd === 'H') { x = v; pts.push([x, y]); }
        else if (cmd === 'V') { y = v; pts.push([x, y]); }
      }
      return pts;
    };

    const radial = pts => {
      const out = new Float32Array(N);
      for (let k = 0; k < N; k++) {
        const th = (k / N) * Math.PI * 2;
        const dx = Math.cos(th);
        const dy = Math.sin(th);
        let best = Infinity;
        for (let i = 0; i < pts.length; i++) {
          const x1 = pts[i][0], y1 = pts[i][1];
          const x2 = pts[(i + 1) % pts.length][0], y2 = pts[(i + 1) % pts.length][1];
          const ex = x2 - x1, ey = y2 - y1;
          const den = dx * ey - dy * ex;
          if (Math.abs(den) < 1e-9) continue;
          const t = ((x1 - CX) * ey - (y1 - CY) * ex) / den;
          const s = ((x1 - CX) * dy - (y1 - CY) * dx) / den;
          if (t > 0 && s >= -1e-6 && s <= 1 + 1e-6 && t < best) best = t;
        }
        out[k] = best === Infinity ? 0 : best;
      }
      return out;
    };

    const samples = SHAPES.map(d => radial(parse(d)));
    const draw = (r, angle) => {
      let d = '';
      for (let k = 0; k < N; k++) {
        const th = (k / N) * Math.PI * 2;
        d += (k ? 'L' : 'M') + (CX + Math.cos(th) * r[k]).toFixed(2) + ' ' + (CY + Math.sin(th) * r[k]).toFixed(2);
      }
      path.setAttribute('d', d + 'Z');
      path.setAttribute('transform', `rotate(${angle.toFixed(2)} ${CX} ${CY})`);
    };

    if (reduce) { draw(samples[0], 0); return; }

    const ease = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    const start = performance.now();
    const tick = now => {
      const elapsed = Math.max(0, now - start) / 1000;
      const step = Math.floor(elapsed) % 7;
      const e = ease(elapsed % 1);
      const a = samples[step];
      const b = samples[(step + 1) % 7];
      const r = new Float32Array(N);
      for (let k = 0; k < N; k++) r[k] = a[k] + (b[k] - a[k]) * e;
      draw(r, step * 60 + e * 60);
      requestAnimationFrame(tick);
    };
    draw(samples[0], 0);
    requestAnimationFrame(tick);
  })();

  /* ---------- loader ---------- */
  const loader = $('#loader');
  const heroReveal = () => {
    if (reduce || !window.gsap) { document.body.classList.remove('is-loading'); return; }
    const tl = gsap.timeline();
    tl.to('.nav-row, .menu-toggle', {
      y: 0, opacity: 1, duration: 0.3, ease: 'power1.out', clearProps: 'transform'
    }, 0)
      .to('.hero-title .line', {
        opacity: 1, filter: 'blur(0px)', y: 0, duration: 0.6, ease: 'power1.out',
        stagger: { each: 0.10, from: 'start' }
      }, 0.2)
      .to('.showcase-flex', { scale: 1, duration: 0.8, ease: 'power1.out' }, 0.4)
      .to('.open-work, .hero-time', {
        y: 0, opacity: 1, duration: 0.6, ease: 'power1.out'
      }, 1);
  };

  function runLoader() {
    if (reduce || !window.gsap) {
      loader.style.display = 'none';
      document.body.classList.remove('is-loading');
      heroReveal();
      return;
    }
    const paths = $$('.loader-logo path');
    gsap.set(paths, { y: -300 });
    gsap.to(paths, { y: 0, duration: 1.5, ease: 'power1.out', stagger: { each: 0.05, from: 'center' } });
    gsap.fromTo('.loader-dot', { x: -60, opacity: 0 }, { x: 0, opacity: 1, duration: 1, stagger: 0.08, ease: 'power1.out', delay: 0.2 });

    const count = { v: 0 };
    const number = $('#loader-count');
    gsap.to(count, {
      v: 100, duration: 2.6, ease: 'power2.inOut',
      onUpdate() {
        number.textContent = String(Math.round(count.v)).padStart(2, '0');
        loader.style.setProperty('--lp', (count.v / 100).toFixed(4));
      }
    });

    const tl = gsap.timeline({ delay: 3.0 });
    tl.to('.loader-top', { height: 0, duration: 1.5, ease: 'power2.inOut' }, 0)
      .to('.loader-bottom', { height: 0, duration: 1.5, ease: 'power2.inOut' }, 0)
      .to('.loader-progress', { opacity: 0, duration: 0.6, ease: 'none' }, 0.1)
      .add(heroReveal, 1.55)
      .add(() => {
        document.body.classList.remove('is-loading');
        loader.style.display = 'none';
        if (window.ScrollTrigger) ScrollTrigger.refresh();
      }, 2.98);
  }

  /* ---------- mobile work slider ---------- */
  const wmStack = $('#wm-stack');
  if (wmStack) {
    const slides = $$('.wm-slide', wmStack);
    const countEl = $('#wm-count');
    const prev = $('#wm-prev');
    const next = $('#wm-next');
    let current = 0;
    let animating = false;
    const updateButtons = () => {
      prev.style.opacity = current === 0 ? '0.3' : '1';
      next.style.opacity = current === slides.length - 1 ? '0.3' : '1';
      countEl.textContent = String(current + 1).padStart(2, '0');
    };
    const show = (dir) => {
      if (animating) return;
      const n = current + dir;
      if (n < 0 || n >= slides.length) return;
      animating = true;
      const prevSlide = slides[current];
      const nextSlide = slides[n];
      const prevMask = prevSlide.querySelector('.wm-mask');
      const nextMask = nextSlide.querySelector('.wm-mask');
      const prevImg = prevMask.querySelector('img');
      const nextImg = nextMask.querySelector('img');
      nextSlide.classList.add('is-active');
      nextSlide.style.zIndex = '2';
      prevSlide.style.zIndex = '1';
      const ctx = { p: 0 };
      if (window.gsap) {
        gsap.set(nextMask, { clipPath: 'polygon(100% 100%, 100% 100%, 100% 100%, 100% 100%)' });
        gsap.set(nextImg, { scale: 1.2 });
        gsap.to(ctx, {
          p: 1, duration: 0.9, ease: 'power2.inOut',
          onUpdate() {
            const a = ctx.p * 100;
            nextMask.style.clipPath = `polygon(${100 - a}% ${100 - a}%, 100% ${100 - a}%, 100% 100%, ${100 - a}% 100%)`;
          },
          onComplete() {
            nextMask.style.clipPath = 'none';
            nextImg.style.transform = 'scale(1)';
            prevSlide.classList.remove('is-active');
            prevSlide.style.zIndex = '';
            nextSlide.style.zIndex = '';
            current = n;
            animating = false;
            updateButtons();
          }
        });
        gsap.to(prevImg, { scale: 1.12, duration: 0.9, ease: 'power2.inOut' });
      } else {
        nextMask.style.clipPath = 'none';
        prevSlide.classList.remove('is-active');
        current = n;
        animating = false;
        updateButtons();
      }
    };
    prev.addEventListener('click', () => show(-1));
    next.addEventListener('click', () => show(1));
    updateButtons();
    let sx = 0, sy = 0;
    wmStack.addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    wmStack.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - sx;
      const dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 45) show(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  /* ---------- reduced motion: static page ---------- */
  if (reduce) {
    loader.style.display = 'none';
    document.body.classList.remove('is-loading');
    fitComputer();
    return;
  }

  /* ---------- GSAP setup ---------- */
  if (!window.gsap || !window.ScrollTrigger) return;
  gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger.config({ ignoreMobileResize: true, limitCallbacks: true });

  const isMobile = () => mobileMQ.matches;
  const lenis = new Lenis({ lerp: isMobile() ? 0.3 : 0.075, smoothWheel: true });
  window.lenis = lenis;
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add(time => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);

  gsap.set('.nav-row, .menu-toggle', { y: 20, opacity: 0 });
  gsap.set('.showcase-flex', { scale: 0 });
  gsap.set('.open-work, .hero-time', { y: 30, opacity: 0 });

  runLoader();

  /* ---------- nav ---------- */
  const navbar = $('#navbar');
  const brand = $('.brand');
  const navRow = $('.nav-row');
  const brandStart = () => Math.max(280, window.innerWidth - 40);
  const navStart = () => {
    if (isMobile()) return 0;
    return Math.round((window.innerWidth - 40) / 6.09 + 18);
  };
  navRow.style.top = `${navStart()}px`;
  gsap.fromTo(brand, { width: brandStart() }, {
    width: 180, ease: 'none',
    scrollTrigger: { start: 260, end: 860, scrub: true, invalidateOnRefresh: true }
  });
  gsap.fromTo(navRow, { top: navStart() }, {
    top: 22, ease: 'none',
    scrollTrigger: { start: 260, end: 860, scrub: true, invalidateOnRefresh: true }
  });
  gsap.to('.tagline', {
    opacity: 0, ease: 'none',
    scrollTrigger: { start: 240, end: 480, scrub: true }
  });

  let lastY = window.scrollY, hideY = -1, navTimer = null;
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    if (menuOpen) { lastY = y; return; }
    if (y > lastY + 6 && y > 340) {
      navbar.classList.add('is-hidden');
      hideY = Math.max(hideY, y);
    } else if (y < 80) {
      navbar.classList.remove('is-hidden'); hideY = -1;
    }
    lastY = y;
    clearTimeout(navTimer);
    navTimer = setTimeout(() => {
      const y2 = window.scrollY;
      if (hideY > 0 && y2 < hideY - 80) { navbar.classList.remove('is-hidden'); hideY = -1; }
    }, 130);
  }, { passive: true });

  /* ---------- hero ---------- */
  const video = $('#video-wrap');
  ScrollTrigger.create({
    trigger: document.documentElement,
    start: 0,
    end: () => window.innerHeight,
    onUpdate: self => {
      const p = self.progress;
      const mobile = isMobile();
      gsap.set(video, { scale: mobile ? 1 : 0.4 + 0.6 * p, y: mobile ? 0 : -100 * (1 - p) });
    }
  });
  gsap.to('.hero-title', {
    opacity: 0, scale: 0.9, ease: 'none',
    scrollTrigger: { start: 850, end: 1080, scrub: true }
  });
  gsap.to('.hero-time', {
    opacity: 0, ease: 'none',
    scrollTrigger: { start: 700, end: 900, scrub: true }
  });

  /* ---------- reveals ---------- */
  $$('[data-reveal]').forEach(el => {
    if (el.closest('.pricing-page')) return;
    gsap.fromTo(el, { opacity: 0, filter: 'blur(10px)', y: 16 }, {
      opacity: 1, filter: 'blur(0px)', y: 0, duration: 0.6, ease: 'power1.out',
      scrollTrigger: { trigger: el, start: 'top 88%', once: true }
    });
  });
  $$('[data-reveal-img]').forEach(el => {
    const img = el.querySelector('img');
    if (!img) return;
    gsap.fromTo(img, { opacity: 0, scale: 1.07, filter: 'blur(6px)' }, {
      opacity: 1, scale: 1, filter: 'blur(0px)', duration: 0.9, ease: 'power2.out',
      scrollTrigger: { trigger: el, start: 'top 86%', once: true }
    });
  });
  $$('[data-badge]').forEach(el => {
    gsap.fromTo(el, { opacity: 0, scale: 0.7 }, {
      opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(1.6)',
      scrollTrigger: { trigger: el, start: 'top 90%', once: true }
    });
  });
  gsap.to('.marquee-line', {
    width: '100%', ease: 'none',
    scrollTrigger: { trigger: '.process', start: 'top 70%', end: '+=700', scrub: true }
  });

  /* ---------- process ---------- */
  const process = (() => {
    const long = $('#process-long');
    const stage = $('#process-stage');
    const canvas = $('#process-canvas');
    if (!long || !canvas) return;
    const ctx = canvas.getContext('2d');
    const cards = $$('.process-card');
    const fills = cards.map(c => c.querySelector('.card-fill'));
    const endPoints = [0.30, 0.45, 0.60, 0.75];
    let W = 0, H = 0, dpr = 1, R = 0;
    let target = 0, current = 0, raf = null, dirty = false;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = stage.clientWidth || window.innerWidth;
      H = stage.clientHeight || window.innerHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      R = Math.min(W, H) * (isMobile() ? 0.09 : 0.10);
      draw(current);
    };

    const polyRadius = (theta, n) => {
      const seg = (Math.PI * 2) / n;
      const a = ((theta % seg) + seg) % seg - seg / 2;
      return R * Math.cos(Math.PI / n) / Math.cos(a);
    };

    const draw = p => {
      const t = clamp(p, 0, 1);
      ctx.clearRect(0, 0, W, H);
      const nf = 4 + 8 * smooth(t, 0, 0.30);
      const circ = smooth(t, 0.30, 0.58);
      const apothem = R * Math.cos(Math.PI / nf);
      const axleY = H * (isMobile() ? 0.45 : 0.70);
      const roadY = axleY + apothem;
      const spacing = 2 * R * Math.sin(Math.PI / nf);
      const xLeft = -R;
      const xRight = W - R;
      const x = lerp(xLeft, xRight, t);

      // road: repeated arches
      ctx.beginPath();
      const firstPeak = xLeft + Math.ceil((-xLeft - spacing) / spacing) * spacing;
      const arches = Math.ceil((W + spacing * 2) / spacing) + 2;
      const steps = Math.max(36, Math.round(spacing));
      for (let i = 0; i < arches; i++) {
        const peak = firstPeak + i * spacing;
        const left = peak - spacing / 2;
        for (let j = 0; j <= steps; j++) {
          const lx = left + (j / steps) * spacing;
          const lxRel = lx - peak;
          const cy = roadY + apothem * (Math.cosh(lxRel / apothem) - 1);
          if (j === 0 && i === 0) ctx.moveTo(lx, cy);
          else ctx.lineTo(lx, cy);
        }
      }
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // shape
      const rot = (t * (xRight - xLeft) / spacing) * ((Math.PI * 2) / nf) - Math.PI / nf;
      const points = 220;
      ctx.beginPath();
      for (let i = 0; i <= points; i++) {
        const th = (i / points) * Math.PI * 2;
        const r = lerp(polyRadius(th, nf), R, circ);
        const px = x + Math.cos(th + rot) * r;
        const py = axleY + Math.sin(th + rot) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // axle
      ctx.save();
      ctx.setLineDash([5, 10]);
      ctx.strokeStyle = 'rgba(255,255,255,.85)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, axleY);
      ctx.lineTo(W, axleY);
      ctx.stroke();
      ctx.restore();

      // centre dot
      ctx.beginPath();
      ctx.arc(x, axleY, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
    };

    const tick = () => {
      current = lerp(current, target, 0.18);
      if (Math.abs(target - current) < 0.0008) current = target;
      draw(current);
      raf = Math.abs(target - current) >= 0.0008 ? requestAnimationFrame(tick) : null;
    };

    ScrollTrigger.create({
      trigger: long,
      start: 'top top',
      end: 'bottom bottom',
      onUpdate: self => {
        const p = self.progress;
        target = p;
        fills.forEach((f, i) => {
          if (isMobile()) return;
          f.style.height = `${clamp(p / endPoints[i], 0, 1) * 100}%`;
        });
        if (isMobile()) {
          const idx = clamp(Math.floor(p * 4), 0, 3);
          cards.forEach((c, i) => c.classList.toggle('is-active', i === idx));
        }
        if (!raf) raf = requestAnimationFrame(tick);
      }
    });
    resize();
    cards[0].classList.add('is-active');
    window.addEventListener('resize', () => { resize(); ScrollTrigger.refresh(); }, { passive: true });
    return { resize };
  })();

  /* ---------- work ---------- */
  const work = (() => {
    if (isMobile()) return null;
    const pin = $('#work-pin');
    const slides = $$('.work-slide');
    const masks = slides.map(s => s.querySelector('.slide-mask'));
    const imgs = slides.map(s => s.querySelector('img'));
    const items = $$('.work-item');
    const circle = $('#work-circle');
    if (!pin || !masks.length) return null;
    const hidden = 'polygon(100% 100%, 100% 100%, 100% 100%, 100% 100%)';
    const full = 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)';
    gsap.set(masks, { clipPath: hidden });
    gsap.set(imgs, { scale: 1.1 });
    gsap.set(items, { opacity: 0.3 });

    const setActive = i => {
      items.forEach((it, n) => it.classList.toggle('is-active', n === i));
      slides.forEach((s, n) => s.classList.toggle('is-active', n === i));
      if (circle) circle.href = items[i].getAttribute('href');
    };
    setActive(0);

    if (circle) {
      const media = $('#work-media');
      let px = 0, py = 0, cx = 0, cy = 0, sc = 0.4, tracking = false, rafId = null;
      const follow = () => {
        if (!tracking) { rafId = null; return; }
        cx += (px - cx) * 0.18;
        cy += (py - cy) * 0.18;
        sc += (1 - sc) * 0.16;
        circle.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -50%) scale(${sc})`;
        rafId = requestAnimationFrame(follow);
      };
      media.addEventListener('pointermove', e => {
        const r = media.getBoundingClientRect();
        px = e.clientX - r.left;
        py = e.clientY - r.top;
        if (!tracking) {
          tracking = true;
          cx = px;
          cy = py;
          sc = 0.4;
          circle.classList.add('is-visible');
          rafId = requestAnimationFrame(follow);
        }
      });
      media.addEventListener('pointerleave', () => {
        tracking = false;
        circle.classList.remove('is-visible');
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
      });
    }

    const tl = gsap.timeline({
      defaults: { ease: 'power2.inOut' },
      scrollTrigger: {
        trigger: pin, start: 'top top', end: 'bottom bottom', scrub: 0.8,
        onUpdate: self => {
          const p = self.progress;
          // Match the label/CTA to the slide that is actually more than half revealed.
          const t1 = clamp((p * 2.9 - 1) / 0.9, 0, 1);
          const t2 = clamp((p * 2.9 - 2) / 0.9, 0, 1);
          setActive(t2 > 0.5 ? 2 : t1 > 0.5 ? 1 : 0);
        }
      }
    });
    tl.to(masks[0], { clipPath: full, duration: 0.9 }, 0)
      .to(imgs[0], { scale: 1, duration: 0.9, ease: 'none' }, 0)
      .to(items[0], { opacity: 1, duration: 0.28 }, 0)
      .to(masks[1], { clipPath: full, duration: 0.9 }, 1)
      .to(imgs[1], { scale: 1, duration: 0.9, ease: 'none' }, 1)
      .to(imgs[0], { scale: 1.2, duration: 0.9, ease: 'none' }, 1)
      .to(items[0], { opacity: 0.3, duration: 0.28 }, 1)
      .to(items[1], { opacity: 1, duration: 0.28 }, 1)
      .to(masks[2], { clipPath: full, duration: 0.9 }, 2)
      .to(imgs[2], { scale: 1, duration: 0.9, ease: 'none' }, 2)
      .to(imgs[1], { scale: 1.2, duration: 0.9, ease: 'none' }, 2)
      .to(items[1], { opacity: 0.3, duration: 0.28 }, 2)
      .to(items[2], { opacity: 1, duration: 0.28 }, 2);

    gsap.from(items, {
      yPercent: 120, filter: 'blur(10px)', duration: 1, stagger: 0.12, ease: 'power2.out',
      scrollTrigger: { trigger: pin, start: 'top 40%', once: true }
    });
    gsap.fromTo('.work-heading h2', { opacity: 0, y: 30 }, {
      opacity: 1, y: 0, duration: 0.8,
      scrollTrigger: { trigger: pin, start: 'top 60%', once: true }
    });

    // light snapping to project steps, direction aware
    let timer = null;
    lenis.on('scroll', () => {
      const st = tl.scrollTrigger;
      if (!st || !st.isActive) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (window.__noSnap) return;
        const p = st.progress;
        if (p < 0.04 || p > 0.96) return;
        const pts = [0.02, 0.335, 0.668, 0.985];
        const dir = st.direction || 1;
        const near = dir > 0
          ? pts.find(v => v > p + 0.02) ?? pts[pts.length - 1]
          : [...pts].reverse().find(v => v < p - 0.02) ?? pts[0];
        if (Math.abs(near - p) > 0.05) {
          lenis.scrollTo(st.start + (st.end - st.start) * near, { duration: 0.8 });
        }
      }, 220);
    });
    return { tl };
  })();

  /* ---------- pricing timeline ---------- */
  const pricingPin = $('#pricing-pin');
  if (pricingPin && !isMobile()) {
    const win = $('#win-pricing');
    const page = $('#pricing-page');
    const plans = $$('.plan');
    const title = $('.pricing-title-wrap');
    const disclaimer = $('.price-disclaimer');
    const glow = $('.pricing-glow');
    const focus = $('.bg-focus');
    const computer = $('#computer');
    const titlebar = win.querySelector('.xp-titlebar');

    gsap.set(plans, { y: 860, rotateY: 180 });
    gsap.set(title, { opacity: 0 });
    gsap.set(disclaimer, { opacity: 0 });
    gsap.set(titlebar, { opacity: 0 });
    gsap.set(page, { backgroundColor: '#ffffff' });
    gsap.set(glow, { scale: 0.45, opacity: 1 });
    gsap.set(focus, { opacity: 0.7, filter: 'blur(10px)', scale: 1.04 });

    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: pricingPin,
        start: 'top top',
        end: 'bottom bottom',
        scrub: 0.7,
        onUpdate: self => {
          win.classList.toggle('is-shrunk', self.progress > 0.6);
        }
      }
    });

    tl.to(glow, { scale: 1.55, duration: 0.2, ease: 'power1.inOut' }, 0)
      .to(page, { backgroundColor: '#6db1f0', duration: 0.26, ease: 'none' }, 0.06)
      .to(glow, { scale: 2.2, opacity: 0, duration: 0.08, ease: 'power1.inOut' }, 0.18)
      .to(focus, { opacity: 1, filter: 'blur(0px)', scale: 1, duration: 0.16, ease: 'power1.out' }, 0.02)
      .to(focus, { opacity: 0.65, filter: 'blur(6px)', duration: 0.14, ease: 'none' }, 0.20)
      .to(focus, { opacity: 0, duration: 0.08, ease: 'none' }, 0.55)
      .to(plans[0], { y: 0, duration: 0.15, ease: 'power2.inOut' }, 0.30)
      .to(plans[0], { rotateY: 0, duration: 0.10, ease: 'power2.inOut' }, 0.35)
      .to(plans[1], { y: 0, duration: 0.22, ease: 'power2.inOut' }, 0.30)
      .to(plans[1], { rotateY: 0, duration: 0.17, ease: 'power2.inOut' }, 0.35)
      .to(plans[2], { y: 0, duration: 0.30, ease: 'power2.inOut' }, 0.30)
      .to(plans[2], { rotateY: 0, duration: 0.25, ease: 'power2.inOut' }, 0.35)
      .to(page, { backgroundColor: '#8cc6f6', duration: 0.25, ease: 'none' }, 0.50)
      .to(title, { opacity: 1, duration: 0.08, ease: 'none' }, 0.52)
      .to(disclaimer, { opacity: 1, duration: 0.08, ease: 'none' }, 0.55)
      .to(titlebar, { opacity: 1, duration: 0.04, ease: 'none' }, 0.62)
      .to(win, { scale: 0.45, x: 20, y: -18, duration: 0.06, ease: 'power2.inOut' }, 0.60)
      .to(computer, { scale: 0.3, duration: 0.06, ease: 'power2.inOut' }, 0.80)
      .to(computer, { rotate: 6, y: 100, duration: 0.15, ease: 'power2.inOut' }, 0.80);
  }

  /* ---------- CTA / footer ---------- */
  gsap.fromTo('.cta h2', { opacity: 0, filter: 'blur(10px)', y: 18 }, {
    opacity: 1, filter: 'blur(0px)', y: 0, duration: 0.8, ease: 'power1.out',
    scrollTrigger: { trigger: '.cta', start: 'top 70%', once: true }
  });
  gsap.fromTo('.cta-copy', { opacity: 0, y: 14 }, {
    opacity: 1, y: 0, duration: 0.7, delay: 0.15,
    scrollTrigger: { trigger: '.cta', start: 'top 65%', once: true }
  });

  /* Contact CTA: mouse-x drives a six-shape morph with roll and fading trails,
     matching the reference's .track interaction. */
  (() => {
    const section = $('.cta');
    const track = $('.cta-track');
    const link = $('#morph-cta');
    const path = $('#morph-path');
    if (!section || !track || !link || !path || isMobile()) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    const SIZE = 220;
    const CP = [0, 0.2, 0.4, 0.6, 0.8, 1];
    const SIDES = [4, 6, 8, 12, 16, 24];
    const ROT = [0, 90, 180, 270, 360, 450];
    let progress = 0;

    const xFor = p => p * Math.max(0, track.getBoundingClientRect().width - SIZE);
    const sidesAt = p => {
      for (let i = 1; i < CP.length; i++) {
        if (p <= CP[i]) {
          const f = (p - CP[i - 1]) / (CP[i] - CP[i - 1]);
          return SIDES[i - 1] + (SIDES[i] - SIDES[i - 1]) * f;
        }
      }
      return SIDES[SIDES.length - 1];
    };
    const draw = p => {
      path.setAttribute('d', polyPath(110, 110, 98, sidesAt(p), (p * 450 * Math.PI) / 180));
    };
    const trail = i => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 220 220');
      svg.setAttribute('class', 'cta-trail');
      svg.setAttribute('aria-hidden', 'true');
      svg.style.left = `${CP[i] * Math.max(0, track.getBoundingClientRect().width - SIZE)}px`;
      const outline = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      outline.setAttribute('d', polyPath(110, 110, 98, SIDES[i], (ROT[i] * Math.PI) / 180));
      outline.setAttribute('fill', 'none');
      outline.setAttribute('stroke', 'currentColor');
      outline.setAttribute('stroke-width', '1');
      svg.appendChild(outline);
      track.appendChild(svg);
      gsap.to(svg, { opacity: 0, duration: 0.55, ease: 'power2.out', onComplete: () => svg.remove() });
    };
    const setProgress = (p, smooth) => {
      p = clamp(p, 0, 1);
      if (smooth) gsap.to(link, { x: xFor(p), duration: 0.1, ease: 'none', overwrite: 'auto' });
      else gsap.set(link, { x: xFor(p) });
      draw(p);
      for (let i = 0; i < CP.length; i++) {
        const c = CP[i];
        if ((progress < c - 0.001 && p >= c - 0.001) || (progress > c + 0.001 && p <= c + 0.001)) trail(i);
      }
      progress = p;
    };
    const move = e => {
      const r = track.getBoundingClientRect();
      const usable = Math.max(0, r.width - SIZE);
      if (!usable) return;
      const x = clamp(e.clientX - r.left - SIZE / 2, 0, usable);
      setProgress(x / usable, true);
    };

    section.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('resize', () => setProgress(progress, false), { passive: true });
    setProgress(0, false);
  })();

  gsap.from('.footer-mail, .footer-time, .footer-links', {
    opacity: 0, y: 20, duration: 0.8, stagger: 0.1,
    scrollTrigger: { trigger: 'footer', start: 'top 92%', once: true }
  });

  const openWork = $('.open-work');
  if (openWork && 'IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      openWork.classList.toggle('is-hidden', entries[0].isIntersecting);
    }, { rootMargin: '0px' }).observe($('#footer'));
  }

  /* ---------- resize ---------- */
  let rt;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      fitComputer();
      navRow.style.top = `${navStart()}px`;
      if (navbar.classList.contains('is-hidden')) navbar.classList.remove('is-hidden');
      ScrollTrigger.refresh();
    }, 180);
  });

  window.addEventListener('load', () => {
    fitComputer();
    ScrollTrigger.refresh();
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => ScrollTrigger.refresh());
})();










