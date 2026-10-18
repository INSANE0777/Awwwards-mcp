/* neu-ix.js — replaces Webflow IX2: loader choreography + circle-cta cursor follow */
document.addEventListener('DOMContentLoaded', function () {
  if (typeof gsap === 'undefined') return;

  /* ---- Loader ---- */
  var loader = document.getElementById('page-loader');
  if (loader) {
    var topCover = loader.querySelector('.top_cover');
    var bottomCover = loader.querySelector('.bottom_cover');
    var line = loader.querySelector('.solid_line');
    var scissors = loader.querySelector('.scissors');
    var dots = gsap.utils.toArray('.loader_dot');

    document.body.style.overflow = 'hidden';
    gsap.set(line, { width: '9%' });
    gsap.set(dots, { x: '-80vw' });
    if (topCover) gsap.set(topCover, { transformOrigin: '50% 0%' });
    if (bottomCover) gsap.set(bottomCover, { transformOrigin: '50% 100%' });

    var tl = gsap.timeline({
      onComplete: function () {
        loader.style.display = 'none';
        document.body.style.overflow = '';
        if (typeof ScrollTrigger !== 'undefined') ScrollTrigger.refresh();
      }
    });
    // dashed cut line draws across while the counter runs (3s, power2.inOut)
    tl.to(line, { width: '100%', duration: 3, ease: 'power2.inOut' }, 0);
    if (scissors) tl.to(scissors, { x: function () { return window.innerWidth * 0.95; }, duration: 3, ease: 'power2.inOut' }, 0);
    tl.to(dots, { x: 0, duration: 1.2, ease: 'power3.out', stagger: 0.12 }, 0.2);
    // covers split and reveal the page (hero intro starts at 4.5s per script-22)
    if (topCover) tl.to(topCover, { yPercent: -100, duration: 1.1, ease: 'power4.inOut' }, 3.6);
    if (bottomCover) tl.to(bottomCover, { yPercent: 100, duration: 1.1, ease: 'power4.inOut' }, 3.6);
  }

  /* ---- circle-cta follows cursor inside each work mask ---- */
  document.querySelectorAll('.slide_mask').forEach(function (mask) {
    var cta = mask.querySelector('.circle-cta');
    if (!cta) return;
    var xTo = gsap.quickTo(cta, 'x', { duration: 0.4, ease: 'power3' });
    var yTo = gsap.quickTo(cta, 'y', { duration: 0.4, ease: 'power3' });
    mask.addEventListener('mousemove', function (e) {
      var r = mask.getBoundingClientRect();
      xTo(e.clientX - r.left - 35);
      yTo(e.clientY - r.top - 35);
    });
  });

  /* ---- Scroll-scrubbed IX2 replacements (measured from ref frames) ---- */
  // hero h1: ref fades the fixed .h1_wrap out as the manifesto enters (scrollY ~800-1200)
  // same IX2 exit hides the fixed hero CTA button and hero clock
  gsap.to(['.h1_wrap', '.hero_button_wrapper', '.hero_additional_wrap .timezone'], {
    opacity: 0, ease: 'none',
    scrollTrigger: { trigger: '.process_container', start: 'top bottom', end: 'top 65%', scrub: true }
  });

  // footer_shadow (dark overlay over the reveal footer) clears as the footer settles
  var shadow = document.querySelector('.footer_shadow');
  if (shadow) {
    gsap.to(shadow, {
      opacity: 0, ease: 'none',
      scrollTrigger: { trigger: '.container.cta', start: 'top bottom', end: 'bottom bottom', scrub: true }
    });
  }

  // process cards: staggered rise inside the sticky process window
  var pcards = gsap.utils.toArray('.process_card');
  if (pcards.length) {
    gsap.fromTo(pcards,
      { y: 400 },
      { y: 0, ease: 'none', stagger: 0.12,
        scrollTrigger: { trigger: '.process_long_wrap', start: 'top 30%', end: 'bottom 90%', scrub: 0.5 } });
  }

  // pricing cards: scrubbed 3D flip from barcode back face to front inside the 1000vh window
  var pWrap = document.querySelector('.sticky_blur_wrapper');
  if (pWrap) {
    // base state = back face, pushed down (ref: translate3d(0,860px,0) rotateY(180deg))
    gsap.set('.service_card', { rotationY: 180, y: function () { return window.innerHeight * 0.955; } });
    var tl2 = gsap.timeline({
      scrollTrigger: { trigger: pWrap, start: 'top top', end: 'bottom bottom', scrub: 0.4 }
    });
    tl2.to({}, { duration: 1 }); // time-base so positions = fraction of the 1000vh window
    // ref: y 860→0 across p .25–.54; rotationY 180→0 across p .33–.51
    tl2.to('.service_card', { y: 0, ease: 'none', duration: 0.29 }, 0.25);
    tl2.to('.service_card', { rotationY: 0, ease: 'none', duration: 0.18, stagger: 0.012 }, 0.33);
    // "We keep our focus on important things" blurs out as the window scrubs (ref: blurred by mid-window)
    var tl3 = gsap.timeline({
      scrollTrigger: { trigger: pWrap, start: 'top top', end: 'bottom bottom', scrub: 0.4 }
    });
    tl3.to({}, { duration: 1 });
    tl3.fromTo('.bg-service-text', { filter: 'blur(0px)' }, { filter: 'blur(25px)', ease: 'none', duration: 0.25 }, 0.10);
    tl3.to('.bg-service-text', { opacity: 0, ease: 'none', duration: 0.15 }, 0.55);
    // window chrome (oval title + disclaimer) appears only in the second half (ref: opacity 0 through p0.5)
    tl3.fromTo(['.title_wrap.white', '.price-disclaimer'], { opacity: 0 }, { opacity: 1, ease: 'none', duration: 0.12 }, 0.50);
    // late in the window the whole retro desktop (CRT + docked window + icons) scales into the monitor (ref: ~1 -> 0.325 across p .85-1)
    tl3.fromTo('.external_ps_wrap', { scale: 1 }, { scale: 0.325, transformOrigin: '50% 63%', ease: 'none', duration: 0.15 }, 0.85);
  }

  // navbar: hide on scroll down, reveal on scroll up (ref behavior; includes the fixed brand logo .link)
  var nav = document.querySelector('.navbar');
  var navLogo = document.querySelector('.nav_wrap .link');
  if (nav && typeof ScrollTrigger !== 'undefined') {
    var lastY = 0;
    ScrollTrigger.create({
      start: 0, end: 'max',
      onUpdate: function (self) {
        var y = self.scroll();
        if (y > 600 && y > lastY + 2) {
          gsap.to(nav, { yPercent: -110, duration: 0.4, ease: 'power2.out' });
          if (navLogo) gsap.to(navLogo, { yPercent: -300, duration: 0.4, ease: 'power2.out' });
        } else if (y < lastY - 2) {
          gsap.to(nav, { yPercent: 0, duration: 0.4, ease: 'power2.out' });
          if (navLogo) gsap.to(navLogo, { yPercent: 0, duration: 0.4, ease: 'power2.out' });
        }
        lastY = y;
      }
    });
  }

  // navbar white cover clears with the loader reveal
  var navCover = document.querySelector('.navbar .cover');
  if (navCover) tl.to(navCover, { yPercent: -115, duration: 0.9, ease: 'power3.inOut' }, 3.9);
});
