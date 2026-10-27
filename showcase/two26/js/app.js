/* Study recreation — motion authored from the reference's measured behaviour.
   Design, copy and assets belong to Two26 Studio. Private study build, do not publish. */
(() => {
  const page = document.querySelector('.page');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasGsap = typeof gsap !== 'undefined';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  if (!hasGsap) {
    document.querySelector('.loader')?.remove();
    return;
  }
  gsap.registerPlugin(ScrollTrigger);
  if (window.DrawSVGPlugin) gsap.registerPlugin(DrawSVGPlugin);
  if (window.SplitText) gsap.registerPlugin(SplitText);
  ScrollTrigger.defaults({ scroller: page });

  /* ---------- loader ---------- */
  const loader = $('.loader');
  const startHero = () => document.dispatchEvent(new CustomEvent('two26:ready'));

  function runLoader() {
    if (!loader) return startHero();
    if (reduced) { loader.remove(); page.scrollTop = 0; return startHero(); }
    const logo = $('.loader-logo', loader);
    const paths = $$('.loader-logo-paths path', loader);
    gsap.set(paths, { opacity: 0, y: 10 });
    gsap.set(logo, { scale: .92, opacity: 0 });
    const tl = gsap.timeline({ defaults: { ease: 'power2.out' }, onComplete: () => { loader.remove(); document.body.dataset.loaded = '1'; startHero(); } });
    tl.to(logo, { opacity: 1, scale: 1, duration: .6 })
      .to(paths, { opacity: 1, y: 0, duration: .5, stagger: .06 }, '-=.3')
      .to(logo, { scale: 1.04, duration: .5, ease: 'power1.inOut' }, '+=.15')
      .to(loader, { yPercent: -100, duration: .9, ease: 'power3.inOut' }, '+=.1');
  }
  page.scrollTop = 0;
  runLoader();

  /* ---------- nav + contact ---------- */
  const contact = $('.contact-page');
  const openContact = (e) => {
    if (e) e.preventDefault();
    contact.classList.add('open');
    contact.setAttribute('aria-hidden', 'false');
    if (reduced) return;
    gsap.fromTo($$('.contact-heading', contact), { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: .6, stagger: .06, ease: 'power2.out' });
  };
  const closeContact = () => {
    contact.classList.remove('open');
    contact.setAttribute('aria-hidden', 'true');
  };
  $$('.js-contact').forEach(b => b.addEventListener('click', openContact));
  $('.close-btn', contact)?.addEventListener('click', closeContact);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeContact(); });

  const ham = $('.ham-btn');
  const hamNav = $('.ham-navbar');
  ham?.addEventListener('click', () => {
    const open = hamNav.classList.toggle('open');
    ham.setAttribute('aria-expanded', String(open));
    hamNav.setAttribute('aria-hidden', String(!open));
    gsap.fromTo($$('.hamburger-links > *', hamNav), { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: .45, stagger: .06, ease: 'power2.out' });
  });
  $$('.hamburger-links a').forEach(a => a.addEventListener('click', () => {
    hamNav.classList.remove('open');
    ham.setAttribute('aria-expanded', 'false');
  }));

  // nav pill hover: draw the squiggle underline
  $$('.navbar-link-btn .stroke-fill').forEach(fill => {
    fill.innerHTML = '<svg viewBox="0 0 75 36" fill="none" preserveAspectRatio="none"><path d="M0 21.5C6 5 16 4 15 15c-1 12-9 14-2 18 8 4 14-31 27-22 11 8-15 26-5 33 13 10 20-40 29-27 5 8-9 20 0 20 4 0 11-8 11-8" stroke="currentColor" stroke-width="24" stroke-linecap="round" vector-effect="non-scaling-stroke" style="stroke-width:0"/></svg>';
    const path = fill.querySelector('path');
    fill.closest('a').addEventListener('mouseenter', () => {
      if (reduced) return;
      gsap.fromTo(path, { attr: { 'stroke-width': 0 } }, { attr: { 'stroke-width': 24 }, duration: .35, ease: 'power2.out' });
    });
    fill.closest('a').addEventListener('mouseleave', () => {
      gsap.to(path, { attr: { 'stroke-width': 0 }, duration: .25 });
    });
  });

  /* ---------- hero ---------- */
  let heroSplit = null;
  let heroLines = [];
  function initHero() {
    const hero = $('.section-hero');
    if (!hero) return;
    const h1 = $('.heading', hero);
    let lines = [];
    function buildLines() {
      if (!window.SplitText || reduced) { lines = $$('.hero-line', hero); return; }
      if (heroSplit) { heroSplit.revert(); h1.textContent = 'LOOKING SUSPICIOUSLY GOOD'; }
      heroSplit = new SplitText(h1, { type: 'lines', linesClass: 'hero-line' });
      heroSplit.lines.forEach(line => {
        const mask = document.createElement('span');
        mask.className = 'hero-line-mask';
        line.parentNode.insertBefore(mask, line);
        mask.appendChild(line);
      });
      lines = heroSplit.lines;
      heroLines = lines;
    }
    buildLines();
    const pills = $$('.hero-pill', hero);
    const heroPaths = $$('.hero-path-svg-left path, .hero-path-svg-right path', hero);

    if (reduced) { gsap.set([lines, pills, heroPaths], { opacity: 1, clearProps: 'transform' }); return; }

    gsap.set(lines, { yPercent: 115, opacity: 0 });
    gsap.set(pills, { opacity: 0, scale: .4, y: 20 });
    gsap.set($$('.hero-pill-text', hero), { yPercent: 105, opacity: 0 });
    heroPaths.forEach(p => {
      const len = p.getTotalLength();
      p.style.strokeDasharray = len;
      p.style.strokeDashoffset = len;
      gsap.set(p, { strokeWidth: 0 });
    });

    const tl = gsap.timeline({ paused: true, defaults: { ease: 'power2.out' } }).timeScale(.75);
    tl.to(lines, { yPercent: 0, opacity: 1, duration: .85, stagger: .12, ease: 'back.out(1.4)' }, 0);
    pills.forEach((pill, i) => {
      const start = .2 + (i / Math.max(1, pills.length)) * .85;
      tl.to(pill, { opacity: 1, scale: 1, y: 0, duration: .55, ease: 'back.out(2.5)' }, start)
        .to($('.hero-pill-text', pill), { yPercent: 0, opacity: 1, duration: .5, ease: 'back.out(1.6)' }, start + .15);
    });
    heroPaths.forEach((p, i) => {
      tl.to(p, { strokeDashoffset: 0, duration: .9 }, .5 + i * .15)
        .to(p, { strokeWidth: 30, duration: .9 }, .5 + i * .15);
    });

    // kick off once the loader finishes (or immediately if it never runs)
    if (document.body.dataset.loaded === '1') tl.play();
    document.addEventListener('two26:ready', () => { tl.play(); document.body.dataset.loaded = '1'; }, { once: true });
    setTimeout(() => { if (!document.body.dataset.loaded) { document.body.dataset.loaded = '1'; tl.play(); } }, 6000);

    // marquee ribbon + infinite text
    const tp = $('.marquee-tp', hero);
    const unit = $('.marquee-unit', hero);
    const bgPath = $('.marquee-bg-path', hero);
    const maskPath = $('.marquee-mask-path', hero);
    if (tp && unit && bgPath) {
      const unitLength = unit.getComputedTextLength() || 1600;
      gsap.to(tp, { attr: { startOffset: -unitLength }, duration: unitLength / 75, ease: 'none', repeat: -1 });
      if (window.DrawSVGPlugin) {
        gsap.set([bgPath, maskPath], { drawSVG: '100% 100%' });
        gsap.to([bgPath, maskPath], {
          drawSVG: '0% 100%', duration: 1.3, ease: 'power2.out',
          scrollTrigger: { trigger: $('.hero-marquee'), start: 'top 85%', once: true },
          onComplete: () => $('.marquee-text-group')?.removeAttribute('mask')
        });
      }
    }
  }
  // split only after the display face is ready, else lines break on fallback metrics
  const fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  let heroBuilt = false;
  fontsReady.then(() => { initHero(); heroBuilt = true; });

  // re-break hero lines when the responsive bucket changes
  let lastBucket = innerWidth >= 992 ? 3 : innerWidth >= 768 ? 2 : innerWidth >= 480 ? 1 : 0;
  let rzTimer;
  addEventListener('resize', () => {
    clearTimeout(rzTimer);
    rzTimer = setTimeout(() => {
      const bucket = innerWidth >= 992 ? 3 : innerWidth >= 768 ? 2 : innerWidth >= 480 ? 1 : 0;
      if (bucket === lastBucket || !heroBuilt) return;
      lastBucket = bucket;
      const h1 = $('.section-hero .heading');
      h1.textContent = 'LOOKING SUSPICIOUSLY GOOD';
      if (heroSplit) heroSplit.revert();
      heroSplit = new SplitText(h1, { type: 'lines', linesClass: 'hero-line' });
      heroSplit.lines.forEach(line => {
        const mask = document.createElement('span');
        mask.className = 'hero-line-mask';
        line.parentNode.insertBefore(mask, line);
        mask.appendChild(line);
      });
      if (document.body.dataset.loaded === '1') gsap.set(heroSplit.lines, { yPercent: 0, opacity: 1 });
      ScrollTrigger.refresh();
    }, 250);
  });

  /* ---------- about pinned chars ---------- */
  function initAbout() {
    const section = $('.section-about');
    const para = $('.about-para', section);
    if (!section || !para) return;
    let chars;
    if (window.SplitText && !reduced) {
      const split = new SplitText(para, { type: 'chars,words', charsClass: 'about-char' });
      chars = split.chars;
    } else {
      chars = $$('.about-char', para);
    }
    const pills = $$('.about-pill', section);
    if (!chars.length) return;

    if (reduced) { gsap.set(chars, { color: '#000' }); gsap.set(pills, { opacity: 1, scale: 1, y: 0 }); return; }

    gsap.set(chars, { color: 'rgba(255,84,0,0.45)', display: 'inline-block', transformOrigin: 'center center' });
    gsap.set(pills, { opacity: 0, scale: .6, y: 24 });

    const getPinDistance = () => innerWidth < 480 ? 1150 : innerWidth < 992 ? 1550 : 2200;
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: section, start: 'top top', end: () => `+=${getPinDistance()}`,
        pin: section, pinSpacing: true, scrub: innerWidth < 992 ? .6 : .8,
        anticipatePin: 1, invalidateOnRefresh: true
      }
    });
    const total = chars.length;
    chars.forEach((c, i) => {
      const at = (i / total) * 85;
      tl.to(c, { color: '#FF5400', scale: 1.12, rotation: () => gsap.utils.random(-4, 4), duration: 3.5, ease: 'power1.out' }, at)
        .to(c, { color: '#000000', scale: 1, rotation: 0, duration: 3.5, ease: 'power1.inOut' }, at + 3.5);
    });
    [35, 72, 96].forEach((at, i) => {
      if (pills[i]) tl.to(pills[i], { opacity: 1, scale: 1, y: 0, duration: 6, ease: 'back.out(2)' }, at);
    });
  }
  initAbout();

  /* ---------- showcase marquee ---------- */
  function initShowcase() {
    const slider = $('.showcase-slider');
    if (!slider) return;
    const originals = $$('.showcase-slide', slider);
    originals.forEach(s => slider.appendChild(s.cloneNode(true)));
    $$('video', slider).forEach(v => { v.muted = true; v.play().catch(() => {}); });
    if (reduced) return;
    const half = slider.scrollWidth / 2;
    gsap.to(slider, { x: -half, duration: half / 60, ease: 'none', repeat: -1 });
  }
  initShowcase();

  /* ---------- projects ---------- */
  function initProjects() {
    const cards = $$('.project-item');
    if (!cards.length) return;
    const hoverMap = {
      'proj-heygluco-b.jpg': 'proj-heygluco-a.jpg',
      'proj-bagel-b.jpg': 'proj-bagel-a.jpg',
      'proj-tanti-b.jpg': 'proj-tanti-a.jpg',
      'proj-munchies-b.jpg': 'proj-munchies-a.jpg',
      'proj-mvp-b.jpg': 'proj-mvp-a.jpg',
      'proj-yumyum-b.jpg': 'proj-yumyum-a.jpg'
    };
    cards.forEach((item, i) => {
      const base = $('.project-img', item);
      const hoverSrc = base && hoverMap[base.getAttribute('src').split('/').pop()];
      if (hoverSrc) {
        const hi = document.createElement('img');
        hi.className = 'project-img project-img-hover';
        hi.src = base.getAttribute('src').replace(/[^/]+$/, hoverSrc);
        hi.alt = '';
        base.parentElement.insertBefore(hi, base.nextSibling);
      }
    });
    cards.forEach((item, i) => {
      const mask = $('.project-card-clip-mask', item);
      const card = $('.project-card', item);
      if (reduced) { gsap.set(mask, { clipPath: 'inset(0%)' }); return; }
      gsap.set(mask, { clipPath: 'inset(42.5%)', borderRadius: 36 });
      gsap.set(card, { rotate: i % 2 ? 4 : -4, rotateY: i % 2 ? 16 : -16, rotateX: 25, scale: 1.45, transformPerspective: 800 });
      gsap.timeline({ scrollTrigger: { trigger: item, start: 'top 85%', once: true } })
        .to(mask, { clipPath: 'inset(0%)', duration: 1.1, ease: 'power3.out' }, 0)
        .to(card, { rotate: 0, rotateY: 0, rotateX: 0, scale: 1, duration: 1.2, ease: 'power3.out' }, 0);
    });

    const end = $('.projects-end');
    if (end && !reduced) {
      const para = $('.projects-end-para', end);
      const words = para.textContent.trim().split(' ');
      para.innerHTML = words.map(w => `<span class="project-line-mask" style="display:inline-block"><span class="project-line" style="display:inline-block">${w}</span></span>`).join(' ');
      gsap.from($$('.project-line', para), { yPercent: 115, opacity: 0, duration: .9, stagger: .02, ease: 'back.out(1.4)', scrollTrigger: { trigger: para, start: 'top 85%' } });
      gsap.from($$('.projects-pill-first, .projects-pill-second, .projects-pill-fourth, .project-btn', end), {
        opacity: 0, scale: .4, y: 20, duration: .7, stagger: .1, ease: 'back.out(2)', scrollTrigger: { trigger: para, start: 'top 80%' }
      });
    }
  }
  initProjects();

  /* ---------- services ---------- */
  function initServices() {
    const section = $('.section-services-body');
    const layers = $$('.service-layer', section);
    if (!section || !layers.length) return;
    const path = $('.services-path-svg path', section);
    if (path && window.DrawSVGPlugin && !reduced) gsap.set(path, { drawSVG: '0%' });

    layers.forEach(layer => {
      const block = $('.service-block', layer);
      const svg = $('.service-svg', block);
      const para = $('.service-block-para-wrapper', block);
      const w = svg ? svg.getBoundingClientRect().width : 0;
      if (svg) { svg.dataset.w = w; gsap.set(svg, { width: 0, scale: 0, opacity: 0 }); }
      if (para) gsap.set(para, { scale: 0, rotation: 0, opacity: 0 });
    });
    if (reduced) return;

    const tl = gsap.timeline({
      scrollTrigger: { trigger: section, start: 'top 70%', end: 'bottom 70%', scrub: 1.2, invalidateOnRefresh: true }
    });
    if (path && window.DrawSVGPlugin) tl.to(path, { drawSVG: '100%', ease: 'none', duration: 1 }, 0);
    const total = layers.length;
    layers.forEach((layer, i) => {
      const block = $('.service-block', layer);
      const svg = $('.service-svg', block);
      const para = $('.service-block-para-wrapper', block);
      const at = Math.max(0, (total > 1 ? i / (total - 1) : 0) - .04);
      if (svg) tl.to(svg, { width: () => parseFloat(svg.dataset.w) || 0, scale: 1, opacity: 1, duration: .14, ease: 'back.out(3.5)' }, at);
      if (para) tl.to(para, { scale: 1, rotation: -5, opacity: 1, duration: .14, ease: 'back.out(3.5)' }, at + .02);
    });

    // lottie icons
    if (window.lottie) {
      $$('.service-svg[data-lottie]', section).forEach(el => {
        lottie.loadAnimation({ container: el, renderer: 'svg', loop: true, autoplay: true, path: el.dataset.lottie });
      });
    }
  }
  initServices();

  /* ---------- testimonials deck ---------- */
  function initTestimonials() {
    const body = $('.testimonials-body-bg');
    if (!body) return;
    const cards = $$('.testimonial-item', body);
    const sidebar = $('.side-bar', body);
    const angles = [-7.5, 6.8, -5.5, 8.2, -8.5];
    let index = 0;
    const ticks = cards.map(() => {
      const t = document.createElement('div');
      t.className = 'sidebar-tick';
      sidebar.appendChild(t);
      return t;
    });
    const render = () => {
      cards.forEach((card, i) => {
        const order = (i - index + cards.length) % cards.length;
        card.style.zIndex = String(cards.length - order);
        gsap.to(card, { rotation: i === index ? 0 : angles[i % angles.length], scale: 1, duration: .55, ease: 'back.out(1.6)', overwrite: 'auto' });
      });
      ticks.forEach((t, i) => gsap.to(t, { width: i === index ? 34 : 14, opacity: i === index ? 1 : .35, duration: .35, ease: 'power2.out' }));
    };
    render();
    body.addEventListener('click', () => { index = (index + 1) % cards.length; render(); });
  }
  initTestimonials();

  /* ---------- faq ---------- */
  function initFaq() {
    const items = $$('.faq-item');
    items.forEach(item => {
      item.querySelector('.question-block').addEventListener('click', () => {
        if (item.classList.contains('is-open')) return;
        items.forEach(i => i.classList.remove('is-open'));
        item.classList.add('is-open');
        if (!reduced) gsap.fromTo($('.faq-block-btm', item), { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: .45, ease: 'power2.out' });
        ScrollTrigger.refresh();
      });
    });
  }
  initFaq();

  /* ---------- footer ---------- */
  function initFooter() {
    const footer = $('.footer');
    if (!footer) return;
    if (!reduced) {
      gsap.from($$('.footer-heading-line', footer), {
        yPercent: 115, opacity: 0, duration: .8, stagger: .08, ease: 'power2.out',
        scrollTrigger: { trigger: footer, start: 'top 55%' }
      });
      gsap.from($$('.footer-top-right a, .footer-link-header', footer), {
        opacity: 0, y: 16, duration: .6, stagger: .04, ease: 'power2.out',
        scrollTrigger: { trigger: footer, start: 'top 45%' }
      });
      gsap.set($('.footer-btm', footer), { yPercent: 55 });
      gsap.to($('.footer-btm', footer), {
        yPercent: 0, ease: 'none',
        scrollTrigger: { trigger: footer, start: 'top bottom', end: 'bottom bottom', scrub: true }
      });
    }
    gsap.from($('.footer-svg-logo', footer), {
      yPercent: 30, ease: 'none',
      scrollTrigger: { trigger: footer, start: 'top bottom', end: 'bottom bottom', scrub: true }
    });
  }
  initFooter();

  /* ---------- anchors inside the custom scroller ---------- */
  $$('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const id = a.getAttribute('href');
      if (!id || id === '#') return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      const y = target.offsetTop + (target.closest('.pin-spacer') ? 0 : 0);
      gsap.to(page, { scrollTop: y, duration: reduced ? 0 : 1.1, ease: 'power2.inOut' });
    });
  });

  // keep ScrollTrigger honest after media/fonts settle
  window.addEventListener('load', () => ScrollTrigger.refresh());
  setTimeout(() => ScrollTrigger.refresh(), 1200);
})();
