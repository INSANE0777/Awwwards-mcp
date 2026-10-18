
/* ==== script-16.js ==== */
gsap.registerPlugin(MorphSVGPlugin,ScrollTrigger,SplitText,ScrollToPlugin,Observer);

/* ==== script-19.js ==== */

const LERP_SMOOTH = 0.07; 
const LERP_SNAPPY = 0.14; 
const LERP_MOBILE = 0.3;
 

const isMobile = window.matchMedia('(max-width: 768px)').matches;
 
const lenis = new Lenis({
  lerp: isMobile ? LERP_MOBILE : LERP_SMOOTH
});
 
lenis.on('scroll', ScrollTrigger.update);
 
gsap.ticker.add((time) => {
  lenis.raf(time * 1000);
});
gsap.ticker.lagSmoothing(0);
 
const jumpState = window.jumpState || {
  triggerId: null,
  label: null,
  until: 0
};


/* ==== script-20.js ==== */

document.addEventListener("DOMContentLoaded", function () {
  if (
    typeof gsap === "undefined" ||
    typeof ScrollTrigger === "undefined" ||
    typeof SplitText === "undefined"
  ) return;

  gsap.registerPlugin(ScrollTrigger, SplitText);

  const MOBILE_BP = 768;
  const DESKTOP_BP = 992;
  const DEFAULT_OFFSET = 0.2;

  const jumpState = {
    triggerId: null,
    label: null,
    until: 0
  };

  function setJumpLock(triggerId, label, duration) {
    jumpState.triggerId = triggerId || null;
    jumpState.label = label || null;
    jumpState.until = Date.now() + (duration || 1200);
  }

  function clearJumpLockLater(delay) {
    setTimeout(function () {
      if (Date.now() >= jumpState.until) {
        jumpState.triggerId = null;
        jumpState.label = null;
        jumpState.until = 0;
      }
    }, delay || 1300);
  }

  function setNavLight(isLight) {
    if (typeof $ !== "undefined") {
      $(".logo, .nav_link").toggleClass("light", !!isLight);
    } else {
      document.querySelectorAll(".logo, .nav_link").forEach(function (el) {
        el.classList.toggle("light", !!isLight);
      });
    }
  }

  /* Blur reveal */
  gsap.utils.toArray('[data-reveal="blur"]').forEach(function (text) {
    if (
      text.matches("a") ||
      text.closest("a") ||
      text.querySelector('a[href^="#"]')
    ) {
      return;
    }

    SplitText.create(text, {
      type: "lines",
      linesClass: "about-line",
      autoSplit: true,
      onSplit(self) {
        return gsap.fromTo(
          self.lines,
          {
            opacity: 0,
            filter: "blur(10px)",
            y: 15
          },
          {
            opacity: 1,
            filter: "blur(0px)",
            y: 0,
            duration: 0.4,
            ease: "power1.out",
            stagger: 0.12,
            overwrite: true,
            scrollTrigger: {
              trigger: text,
              start: "top 85%",
              toggleActions: "play none none none",
              jumpIgnore: true
            }
          }
        );
      }
    });
  });

/* Portfolio scroll - desktop only */
gsap.registerPlugin(ScrollTrigger);
ScrollTrigger.config({ limitCallbacks: true, ignoreMobileResize: true });
 
gsap.matchMedia().add("(min-width: 992px)", function () {
  const section = document.querySelector(".sticky_wrap");
  const pinEl = document.querySelector(".case_wrapper");
  if (!section || !pinEl) return;
 
  const items = gsap.utils.toArray(".work_item", pinEl);
  const masks = gsap.utils.toArray(".slide_mask", pinEl);
  const images = masks.map(function (m) {
    return m.querySelector("img");
  });
 
  if (
    !items.length ||
    !masks.length ||
    images.some(function (img) {
      return !img;
    })
  ) {
    console.warn("[Portfolio scroll] not started – check .work_item, .slide_mask and an <img> inside every .slide_mask");
    return;
  }
 
  /* ---- Animation ---- */
  const SCROLL_PER_SLIDE = 1;    // viewport heights of scrolling per image
  const SCRUB = 0.8;             // only used when Lenis isn't on the page
  const SCRUB_WITH_LENIS = true; // Lenis already smooths the scroll; 0.8 on top made the image trail behind. Try 0.3 for a softer feel.
  const TRANSITION = 0.9;
  const FADE = 0.28;
  const DIM = 0.28;
  const ZOOM_IN = 1.1;
  const ZOOM_OUT = 1.2;
  const START_REVEALED = false;
  const REVEAL_EASE = "power2.inOut";
 
  /* ---- Snapping ---- */
  const SNAP_FORWARD_AT = 0.1; // scrolling down: go to the next image once its reveal is 10% through
  const SNAP_BACK_AT = 0.9;    // scrolling up: go back once the reveal drops under 70%
  const SNAP_DELAY = 90;      // ms after you stop scrolling
  const SNAP_LERP = 0.1;       // how hard Lenis pulls to the snap point (higher = faster)
 
  const HIDDEN = "polygon(100% 100%, 100% 100%, 100% 100%, 100% 100%)";
  const FULL = "polygon(0% 0%, 100% 0%, 100% 101%, 0% 101%)";
 
  const STEP = 1;
  const OFFSET = START_REVEALED ? 0 : 1;
  const REVEAL_PART = TRANSITION / STEP; // each step = reveal (first 80%) + pause (last 20%)
 
  // Works with both versions of Smooth scroll: window.lenis or a global `lenis`
  const lenisRef = window.lenis || (typeof lenis !== "undefined" ? lenis : null);
  const smooth =
    lenisRef && typeof lenisRef.scrollTo === "function" && typeof lenisRef.on === "function"
      ? lenisRef
      : null;
 
  gsap.set(items, {
    opacity: DIM,
    willChange: "opacity"
  });
 
  gsap.set(masks, {
    clipPath: HIDDEN,
    willChange: "clip-path"
  });
 
  gsap.set(images, {
    scale: ZOOM_IN,
    transformOrigin: "50% 50%",
    force3D: true,
    willChange: "transform"
  });
 
  if (START_REVEALED) {
    gsap.set(masks[0], { clipPath: FULL });
    gsap.set(images[0], { scale: 1 });
    gsap.set(items[0], { opacity: 1 });
  }
 
  const tl = gsap.timeline({
    defaults: {
      duration: TRANSITION,
      ease: REVEAL_EASE
    }
  });
 
  if (!START_REVEALED) {
    tl.addLabel("top", 0)
      .to(masks[0], { clipPath: FULL }, 0)
      .to(images[0], { scale: 1, ease: "none" }, 0)
      .to(items[0], { opacity: 1, duration: FADE, ease: "none" }, 0);
  }
 
  tl.addLabel("s0", OFFSET * STEP);
 
  for (let i = 1; i < masks.length; i++) {
    const at = (i + OFFSET - 1) * STEP;
 
    tl.to(masks[i], { clipPath: FULL }, at)
      .to(images[i], { scale: 1, ease: "none" }, at)
      .to(images[i - 1], { scale: ZOOM_OUT, ease: "none" }, at)
      .to(items[i - 1], { opacity: DIM, duration: FADE, ease: "none" }, at)
      .to(items[i], { opacity: 1, duration: FADE, ease: "none" }, at)
      .addLabel("s" + i, (i + OFFSET) * STEP);
  }
 
  const END = (masks.length - 1 + OFFSET) * STEP;
 
  tl.to({}, { duration: 0.01 }, END - 0.01);
 
  const dur = tl.duration();
 
  const labelsAsc = Array.from(
    new Set(
      Object.values(tl.labels).map(function (t) {
        return t / dur;
      })
    )
  ).sort(function (a, b) {
    return a - b;
  });
 
  const revealEase = gsap.parseEase(REVEAL_EASE);
 
  /* Which label to snap to.
     progress: 0–1 over the whole section. dir: 1 down, -1 up, 0 unknown. */
  function pickLabel(progress, dir) {
    const p = gsap.utils.clamp(0, 1, progress);
 
    for (let i = 0; i < labelsAsc.length - 1; i++) {
      const lower = labelsAsc[i];
      const upper = labelsAsc[i + 1];
      if (p > upper) continue;
 
      const local = (p - lower) / (upper - lower);
      const revealed = revealEase(gsap.utils.clamp(0, 1, local / REVEAL_PART));
      const threshold = dir > 0 ? SNAP_FORWARD_AT : dir < 0 ? SNAP_BACK_AT : 0.5;
 
      return revealed >= threshold ? upper : lower;
    }
 
    return labelsAsc[labelsAsc.length - 1];
  }
 
  /* Jump links can force a label for a moment (jumpState lives in the GSAP block) */
  function forcedProgress() {
    const forced =
      typeof jumpState !== "undefined" &&
      jumpState.triggerId === "portfolio-scroll" &&
      jumpState.label &&
      Date.now() < jumpState.until;
 
    if (!forced) return null;
 
    const t = tl.labels[jumpState.label];
    return t !== undefined && dur > 0 ? t / dur : null;
  }
 
  const stVars = {
    id: "portfolio-scroll",
    animation: tl,
    trigger: section,
    start: "top top",
    end: function () {
      return "+=" + Math.round((END / STEP) * window.innerHeight * SCROLL_PER_SLIDE);
    },
    pin: pinEl,
    pinSpacing: true,
    anticipatePin: 1,
    invalidateOnRefresh: true,
    scrub: smooth ? SCRUB_WITH_LENIS : SCRUB
  };
 
  // No Lenis: ScrollTrigger snaps, with the same rules
  if (!smooth) {
    stVars.snap = {
      snapTo: function (value, self) {
        const forced = forcedProgress();
        if (forced !== null) return forced;
        return pickLabel((self.scroll() - self.start) / (self.end - self.start), self.direction);
      },
      duration: { min: 0.45, max: 0.65 },
      delay: SNAP_DELAY / 1000,
      ease: "power1.inOut",
      inertia: false
    };
  }
 
  const st = ScrollTrigger.create(stVars);
 
  if (!smooth) return;
 
  /* ---- Snapping with Lenis ---- */
  let dir = 0;
  let lastY = st.scroll();
  let touching = false;
  let wheelTimer = null;
  let idleTimer = null;
 
  // Where the page will end up: Lenis's target while it glides, otherwise where it is now
  function heading() {
    return smooth.isScrolling === "smooth" && typeof smooth.targetScroll === "number"
      ? smooth.targetScroll
      : st.scroll();
  }
 
  function trySnap() {
    if (touching || smooth.isStopped) return;
 
    const range = st.end - st.start;
    if (range <= 0) return;
 
    const y = heading();
    if (y < st.start || y > st.end) return; // ending up outside the section: leave it alone
 
    const forced = forcedProgress();
    const p = forced !== null ? forced : pickLabel((y - st.start) / range, dir);
    const target = Math.round(st.start + range * p);
 
    if (Math.abs(target - y) < 2) return;
 
    smooth.scrollTo(target, { lerp: SNAP_LERP });
  }
 
  // Lenis scroll (also fires for keyboard, scrollbar and touch scrolling)
  function onScroll() {
    const y = st.scroll();
    if (y !== lastY) {
      dir = y > lastY ? 1 : -1;
      lastY = y;
    }
    clearTimeout(idleTimer);
    idleTimer = setTimeout(trySnap, SNAP_DELAY);
  }
 
  // Mouse wheel / trackpad: snap as soon as input stops, even while Lenis still glides
  function onWheel(e) {
    if (e.ctrlKey) return; // pinch zoom
    if (e.deltaY) dir = e.deltaY > 0 ? 1 : -1;
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(trySnap, SNAP_DELAY);
  }
 
  function onTouchStart() {
    touching = true;
    clearTimeout(idleTimer);
    clearTimeout(wheelTimer);
  }
 
  function onTouchEnd() {
    touching = false;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(trySnap, SNAP_DELAY);
  }
 
  const unsubscribe = smooth.on("scroll", onScroll);
  window.addEventListener("wheel", onWheel, { passive: true });
  window.addEventListener("touchstart", onTouchStart, { passive: true });
  window.addEventListener("touchend", onTouchEnd, { passive: true });
  window.addEventListener("touchcancel", onTouchEnd, { passive: true });
 
  // Runs when the window goes below 992px
  return function () {
    clearTimeout(idleTimer);
    clearTimeout(wheelTimer);
    if (typeof unsubscribe === "function") unsubscribe();
    else if (typeof smooth.off === "function") smooth.off("scroll", onScroll);
    window.removeEventListener("wheel", onWheel);
    window.removeEventListener("touchstart", onTouchStart);
    window.removeEventListener("touchend", onTouchEnd);
    window.removeEventListener("touchcancel", onTouchEnd);
  };
});
  
  /* Jump to section / label */
  document.querySelectorAll('a[href^="#"]').forEach(function (link) {
    link.addEventListener(
      "click",
      function (e) {
        const href = this.getAttribute("href");
        if (!href || href === "#") return;

        const targetId = href.slice(1);
        const target = document.getElementById(targetId);
        if (!target) return;

        e.preventDefault();

        const isMobile = window.innerWidth < DESKTOP_BP;
        if (!isMobile) e.stopImmediatePropagation();

        const doJump = function () {
          document.documentElement.style.scrollBehavior = "auto";
          document.body.style.scrollBehavior = "auto";

          document.body.getBoundingClientRect();

          let destination;
          let st = null;

          if (typeof ScrollTrigger !== "undefined") {
            ScrollTrigger.refresh(true);

            const stId = target.dataset.scrollTriggerId;
            if (stId) {
              st = ScrollTrigger.getById(stId) || null;
            }

            if (!st) {
              const candidates = ScrollTrigger.getAll().filter(function (instance) {
                if (!instance || !instance.trigger) return false;
                if (instance.vars && instance.vars.jumpIgnore) return false;

                return (
                  target === instance.trigger ||
                  target.contains(instance.trigger) ||
                  instance.trigger.contains(target)
                );
              });

              st =
                candidates.find(function (instance) {
                  return instance.trigger === target;
                }) ||
                candidates.sort(function (a, b) {
                  const aLen = Math.abs((a.end || 0) - (a.start || 0));
                  const bLen = Math.abs((b.end || 0) - (b.start || 0));
                  return bLen - aLen;
                })[0] ||
                null;
            }
          }

          if (st) {
            const anim = st.animation;
            const namedLabel = target.dataset.scrollLabel;
            const stId = (st.vars && st.vars.id) ? st.vars.id : null;

            if (
              namedLabel &&
              anim &&
              anim.labels &&
              anim.labels[namedLabel] !== undefined &&
              typeof anim.duration === "function" &&
              anim.duration() > 0
            ) {
              const fraction = anim.labels[namedLabel] / anim.duration();

              if (stId) setJumpLock(stId, namedLabel, 1200);

              destination = st.start + (st.end - st.start) * fraction;

              if (namedLabel === "s0") {
                destination += 1;
              }
            } else {
              const pct = parseFloat(target.dataset.scrollOffset ?? DEFAULT_OFFSET);
              destination = st.start + (st.end - st.start) * pct;
            }
          } else {
            const pct = parseFloat(target.dataset.scrollOffset ?? DEFAULT_OFFSET);
            const scrollableHeight = Math.max(0, target.offsetHeight - window.innerHeight);

            destination =
              target.getBoundingClientRect().top +
              window.scrollY +
              scrollableHeight * pct;
          }

          window.scrollTo({
            top: Math.max(0, destination),
            behavior: "auto"
          });

          requestAnimationFrame(function () {
            requestAnimationFrame(function () {
              document.documentElement.style.scrollBehavior = "";
              document.body.style.scrollBehavior = "";

              if (typeof ScrollTrigger !== "undefined") {
                ScrollTrigger.refresh(true);
                ScrollTrigger.update();
              }

              if (window.innerWidth >= DESKTOP_BP && window.updateNavColorFromSections) {
                window.updateNavColorFromSections();
              }

              clearJumpLockLater(1300);
            });
          });
        };

        if (isMobile) {
          setTimeout(doJump, 700);
        } else {
          doJump();
        }
      },
      true
    );
  });

  /* Global refresh */
  window.addEventListener("load", function () {
    if (window.innerWidth >= DESKTOP_BP && window.updateNavColorFromSections) {
      window.updateNavColorFromSections();
    }

    ScrollTrigger.refresh(true);
  });

  let resizeTimer;

  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);

    resizeTimer = setTimeout(function () {
      if (window.innerWidth >= DESKTOP_BP) {
        unlockScroll();
        window.updateNavColorFromSections();
      }

      ScrollTrigger.refresh(true);
    }, 200);
  });

  /* Lock scroll when mobile menu is open — tablet and below only */
  const menuOpen = document.querySelector('.menu_button.open');
  const menuClose = document.querySelector('.menu_button.close');

  function lockScroll() {
    if (window.innerWidth < DESKTOP_BP) {
      document.body.style.overflow = 'hidden';
      document.querySelector('.navbar').style.zIndex = '9000000';
    }
  }

  function unlockScroll() {
    document.body.style.overflow = '';
    document.querySelector('.navbar').style.zIndex = '800';
  }

  if (menuOpen) {
    menuOpen.addEventListener('click', lockScroll);
  }

  if (menuClose) {
    menuClose.addEventListener('click', unlockScroll);
  }

  document.querySelectorAll('.nav_link').forEach(function (link) {
    link.addEventListener('click', unlockScroll);
  });

});


/* ==== script-22.js ==== */

window.addEventListener('DOMContentLoaded', function () {
  if (typeof gsap === 'undefined' || typeof SplitType === 'undefined') return;

  var isMobile = window.innerWidth <= 768;
  var loaderDelay = isMobile ? 1 : 4.5;

  var logoPaths = Array.from(document.querySelectorAll('.loader_logo path'));
  var flexEl = document.querySelector('.flex-container');

  var animationStarted = false;
  var animationPrepared = false;
  var h1Split = null;

  if (logoPaths.length) {
    gsap.set(logoPaths, { y: -300 });
  }

  if (flexEl) {
    gsap.set(flexEl, { scale: 0 });
  }

  gsap.set('.timezone, .hero_button_wrapper', { y: 30, opacity: 0 });
  gsap.set('.nav_menu', { y: 20, opacity: 0 });
  gsap.set('.h1', { visibility: 'hidden' });

  if (logoPaths.length) {
    gsap.to(logoPaths, {
      y: 0,
      duration: 2,
      ease: 'power1.out',
      stagger: { each: 0.05, from: 'center' }
    });
  }

  function prepareAnimation() {
    if (animationPrepared) return;
    animationPrepared = true;

    requestAnimationFrame(function () {
      h1Split = new SplitType('.h1', {
        types: 'lines',
        lineClass: 'line'
      });

      if (h1Split.lines && h1Split.lines.length) {
        gsap.set(h1Split.lines, {
          opacity: 0,
          filter: 'blur(10px)',
          y: 15
        });
      }

      gsap.set('.h1', { visibility: 'visible' });
    });
  }

  function initAnimation() {
    if (animationStarted) return;
    animationStarted = true;

    requestAnimationFrame(function () {
      if (!animationPrepared) prepareAnimation();

      var lines = h1Split && h1Split.lines ? h1Split.lines : [];

      var tl = gsap.timeline();

      tl.to('.nav_menu', {
        y: 0,
        opacity: 1,
        duration: isMobile ? 0.6 : 0.3,
        ease: 'power1.out',
        clearProps: 'transform'
      }, 0);

      if (lines.length) {
        tl.to(lines, {
          opacity: 1,
          filter: 'blur(0px)',
          y: 0,
          duration: 0.6,
          ease: isMobile ? 'power3.out' : 'power1.out',
          stagger: { each: 0.10, from: 'start' }
        }, isMobile ? 0 : 0.2);
      }

      if (flexEl) {
        tl.to(flexEl, {
          scale: 1,
          duration: 0.8,
          ease: 'power1.out'
        }, isMobile ? 0 : 0.4);
      }

      tl.to('.timezone, .hero_button_wrapper', {
        y: 0,
        opacity: 1,
        duration: isMobile ? 0.5 : 0.6,
        ease: 'power1.out'
      }, isMobile ? 0 : 1);
    });
  }

  var startDelay = loaderDelay * 1000;

  var fallback = setTimeout(function () {
    prepareAnimation();
    setTimeout(initAnimation, startDelay);
  }, 150);

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      clearTimeout(fallback);
      prepareAnimation();
      setTimeout(initAnimation, startDelay);
    }).catch(function () {
      clearTimeout(fallback);
      prepareAnimation();
      setTimeout(initAnimation, startDelay);
    });
  } else {
    clearTimeout(fallback);
    prepareAnimation();
    setTimeout(initAnimation, startDelay);
  }
});


/* ==== script-24.js ==== */

document.addEventListener("DOMContentLoaded", function () {
  if (typeof CircleType === "undefined") return;

  document.querySelectorAll(".circle-cta").forEach(function (wrapper) {
    const circle = wrapper.querySelector(".circle");
    const text = wrapper.querySelector(".circle-text");

    if (!circle || !text) return;

    const circleType = new CircleType(text);

    function updateCircle() {
      const circleSize = circle.getBoundingClientRect().width;

      // Distance of the text from the centre of the circle
      const radius = circleSize * 0.9;

      circleType.radius(radius);
    }

    updateCircle();
    window.addEventListener("resize", updateCircle);
  });
});


/* ==== script-26.js ==== */

document.addEventListener('DOMContentLoaded', function () {
  if (typeof gsap === 'undefined' || typeof MorphSVGPlugin === 'undefined') return;

  gsap.registerPlugin(MorphSVGPlugin);

  const CENTER_X = 796;
  const CENTER_Y = 138;

  function buildTimeline() {
    const tl = gsap.timeline({
      onComplete: function () {
        gsap.set('#shape1', {
          rotation: 0,
          svgOrigin: CENTER_X + ' ' + CENTER_Y
        });

        buildTimeline();
      }
    });

    const step = function (shape, rotation) {
      return {
        duration: 1,
        morphSVG: { shape: shape, shapeIndex: 'auto' },
        rotation: rotation,
        svgOrigin: CENTER_X + ' ' + CENTER_Y,
        ease: 'power2.inOut'
      };
    };

    tl.to('#shape1', step('#shape2', 60))
      .to('#shape1', step('#shape3', 120))
      .to('#shape1', step('#shape4', 180))
      .to('#shape1', step('#shape5', 240))
      .to('#shape1', step('#shape6', 300))
      .to('#shape1', step('#shape7', 360))
      .to('#shape1', step('#shape1', 450));

    return tl;
  }

  if (document.querySelector('#shape1')) {
    buildTimeline();
  }
});


/* ==== script-27.js ==== */

function updatePolandTime() {
  const now = new Date();

  const time = now.toLocaleTimeString('en-GB', {
    timeZone: 'Europe/Warsaw',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw',
    timeZoneName: 'shortOffset',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const parts = formatter.formatToParts(now);
  const tzPart = parts.find(function (part) {
    return part.type === 'timeZoneName';
  });

  const gmt = tzPart ? tzPart.value.replace('UTC', 'GMT') : 'GMT+1';
  const content = 'local time<br>' + time + ' (' + gmt + ')';

  const el1 = document.getElementById('local-time');
  const el2 = document.getElementById('timezone');
  const el3 = document.getElementById('nav_time');

  if (el1) el1.innerHTML = content;
  if (el2) el2.innerHTML = content;
  if (el3) el3.innerHTML = content;
}

updatePolandTime();
setInterval(updatePolandTime, 1000);


/* ==== slater-main.js ==== */
!function(){function e(){const e=window.innerWidth;return e<=l?{key:"mobile",interaction:"drag",svgSelector:"#morphSvgMobile",otherSvgSelector:"#morphSvg",labelSelector:"#morphLabelMobile",otherLabelSelector:"#morphLabel",shapeSuffix:"-mobile",viewBox:"0 0 120 120",svgOrigin:"60 60",intrinsicSize:120,checkpoints:[{progress:0,baseId:"first",rotation:0},{progress:1/3,baseId:"second",rotation:90},{progress:2/3,baseId:"third",rotation:180},{progress:1,baseId:"fourth",rotation:270}]}:e<=a?{key:"tablet",interaction:"drag",svgSelector:"#morphSvg",otherSvgSelector:"#morphSvgMobile",labelSelector:"#morphLabelMobile",otherLabelSelector:"#morphLabel",shapeSuffix:"",viewBox:"0 0 220 220",svgOrigin:"110 110",intrinsicSize:220,checkpoints:[{progress:0,baseId:"first",rotation:0},{progress:.2,baseId:"second",rotation:90},{progress:.4,baseId:"third",rotation:180},{progress:.6,baseId:"fourth",rotation:270},{progress:.8,baseId:"fifth",rotation:360},{progress:1,baseId:"sixth",rotation:450}]}:{key:"desktop",interaction:"hover",svgSelector:"#morphSvg",otherSvgSelector:"#morphSvgMobile",labelSelector:"#morphLabel",otherLabelSelector:"#morphLabelMobile",shapeSuffix:"",viewBox:"0 0 220 220",svgOrigin:"110 110",intrinsicSize:220,checkpoints:[{progress:0,baseId:"first",rotation:0},{progress:.2,baseId:"second",rotation:90},{progress:.4,baseId:"third",rotation:180},{progress:.6,baseId:"fourth",rotation:270},{progress:.8,baseId:"fifth",rotation:360},{progress:1,baseId:"sixth",rotation:450}]}}function t(){if(document.querySelector("#morph-mode-styles"))return;const e=document.createElement("style");e.id="morph-mode-styles",e.textContent="\n      #morphSvg,\n      #morphSvgMobile,\n      #morphLabel,\n      #morphLabelMobile {\n        will-change: transform;\n      }\n\n      #morphLabel {\n        pointer-events: auto;\n        position: relative;\n        z-index: 3;\n      }\n\n      #morphSvg {\n        position: relative;\n        z-index: 1;\n      }\n\n      #morphLabelMobile {\n        pointer-events: none;\n      }\n\n      .trail-clone {\n        will-change: opacity;\n        z-index: 0;\n      }\n    ",document.head.appendChild(e)}function n(e,t){e&&(e.hidden=!1,e.removeAttribute("hidden"),e.style.setProperty("display",t,"important"),e.style.setProperty("visibility","visible","important"),e.style.setProperty("opacity","1","important"))}function o(e){e&&(e.hidden=!0,e.style.setProperty("display","none","important"),e.style.setProperty("visibility","hidden","important"),e.style.setProperty("opacity","0","important"))}function r(e){e&&(e.style.setProperty("display","inline-flex","important"),e.style.setProperty("align-items","center","important"),e.style.setProperty("justify-content","center","important"),e.style.setProperty("width","max-content","important"),e.style.setProperty("max-width","none","important"),e.style.setProperty("white-space","nowrap","important"),e.style.setProperty("margin","0","important"))}function i(e){const t=document.querySelector(e.svgSelector),i=document.querySelector(e.otherSvgSelector),s=document.querySelector(e.labelSelector),a=document.querySelector(e.otherLabelSelector);n(t,"block"),o(i),s&&(n(s,"inline-flex"),r(s)),a&&o(a)}function s(){function n(){const e=z.getBoundingClientRect();e.width>0&&(q.shapeSize=e.width)}function o(){if(!C)return q.labelOffsetX=0,void(q.labelOffsetY=0);r(C),gsap.set(z,{x:0,y:0}),gsap.set(C,{x:0,y:0});const e=z.getBoundingClientRect(),t=C.getBoundingClientRect(),n=e.left+e.width/2,o=e.top+e.height/2,i=t.left+t.width/2,s=t.top+t.height/2;q.labelOffsetX=n-i,q.labelOffsetY=o-s}function a(){const e=gsap.timeline({paused:!0});e.set(B,{rotation:0},0);for(let t=1;t<P.checkpoints.length;t++){const n=P.checkpoints[t-1],o=P.checkpoints[t];e.to(B,{morphSVG:{shape:"#"+o.shapeId,type:"rotational",origin:"50% 50%"},rotation:o.rotation,transformOrigin:"50% 50%",svgOrigin:I.svgOrigin,duration:o.progress-n.progress,ease:"linear"},n.progress)}return e}function l(e){const t=X.getBoundingClientRect(),n=q.shapeSize/2;let o=e-t.left;o=Math.max(n,Math.min(t.width-n,o));const r=t.width-q.shapeSize,i=r>0?(o-n)/r:0;return{progress:Math.max(0,Math.min(1,i)),centerX:o,leftX:o-n}}function g(e){const t=X.getBoundingClientRect(),n=q.shapeSize/2;return n+e*(t.width-q.shapeSize)-n}function h(e){const t=P.checkpoints[e],n=g(t.progress),o=q.originalPaths[t.shapeId];if(!o)return null;const r=document.createElementNS("http://www.w3.org/2000/svg","svg");r.setAttribute("width",q.shapeSize),r.setAttribute("height",q.shapeSize),r.setAttribute("viewBox",I.viewBox),r.setAttribute("class","trail-clone");const i=document.createElementNS("http://www.w3.org/2000/svg","path");return i.setAttribute("d",o),i.setAttribute("fill","none"),i.setAttribute("stroke","currentcolor"),i.setAttribute("stroke-width","1"),r.appendChild(i),r.style.position="absolute",r.style.left=n+"px",r.style.top="0",r.style.pointerEvents="none",r.style.transformOrigin="50% 50%",r.style.transform=`rotate(${t.rotation}deg)`,r.style.zIndex="0",X.appendChild(r),gsap.to(r,{opacity:0,duration:P.trailFadeBase+q.trails.size*P.trailFadeIncrement,ease:"power2.out",onComplete:()=>{r.parentNode&&r.parentNode.removeChild(r)}}),r}function f(e){e&&e.parentNode&&(gsap.killTweensOf(e),e.parentNode.removeChild(e))}function m(){q.trails.forEach(f),q.trails.clear()}function v(e,t){const n=.001,o=t>e;P.checkpoints.forEach(((r,i)=>{const s=r.progress;if(o&&e<s+n&&t>=s+n||!o&&e>s-n&&t<=s-n){q.trails.has(i)&&f(q.trails.get(i));const e=h(i);e&&q.trails.set(i,e)}}))}function b(e,t){t?(gsap.to(z,{x:e,duration:.1,ease:"none",overwrite:"auto"}),C&&gsap.to(C,{x:e+q.labelOffsetX,y:q.labelOffsetY,duration:.1,ease:"none",overwrite:"auto"})):(gsap.set(z,{x:e}),C&&gsap.set(C,{x:e+q.labelOffsetX,y:q.labelOffsetY}))}function y(e,t){const n=q.currentProgress;q.currentProgress=e.progress,d=e.progress,q.timeline&&q.timeline.progress(e.progress),b(e.leftX,t),v(n,q.currentProgress),q.previousProgress=q.currentProgress}function S(e){y(l(e.clientX),!0)}function w(e){const t=e.touches[0];if(!t)return;const n=z.getBoundingClientRect();t.clientX>=n.left&&t.clientX<=n.right&&t.clientY>=n.top&&t.clientY<=n.bottom&&(q.isDragging=!0,q.dragOffsetX=t.clientX-n.left,e.preventDefault())}function L(e){if(!q.isDragging)return;const t=e.touches[0];if(!t)return;const n=X.getBoundingClientRect(),o=t.clientX-n.left-q.dragOffsetX;y(l(n.left+o+q.shapeSize/2),!1),e.preventDefault()}function x(){q.isDragging=!1}function E(e){function t(e){if(!q.isDragging)return;const t=X.getBoundingClientRect(),n=e.clientX-t.left-q.dragOffsetX;y(l(t.left+n+q.shapeSize/2),!1)}function n(){q.isDragging=!1,document.removeEventListener("mousemove",t),document.removeEventListener("mouseup",n),A=null}if(0!==e.button)return;const o=z.getBoundingClientRect();e.clientX>=o.left&&e.clientX<=o.right&&e.clientY>=o.top&&e.clientY<=o.bottom&&(q.isDragging=!0,q.dragOffsetX=e.clientX-o.left,e.preventDefault(),document.addEventListener("mousemove",t),document.addEventListener("mouseup",n),A=function(){document.removeEventListener("mousemove",t),document.removeEventListener("mouseup",n)})}function O(){n(),o();b(g(q.currentProgress),!1),q.timeline&&q.timeline.progress(q.currentProgress)}function k(){if(e().key!==p)return u&&u(),void s();O()}t();const I=e();p=I.key,i(I);const P={trailFadeBase:.3,trailFadeIncrement:.4,checkpoints:I.checkpoints.map((e=>({...e,shapeId:e.baseId+I.shapeSuffix})))},X=document.querySelector(".track"),z=document.querySelector(I.svgSelector),B=z&&z.querySelector("#first"+I.shapeSuffix),C=document.querySelector(I.labelSelector),M=document.querySelector(".section.light.hover");if(!X||!z||!B)return void(u=null);let q={timeline:null,currentProgress:d,previousProgress:d,shapeSize:I.intrinsicSize,trails:new Map,originalPaths:{},labelOffsetX:0,labelOffsetY:0,isDragging:!1,dragOffsetX:0},A=null;P.checkpoints.forEach((e=>{const t=document.querySelector("#"+e.shapeId);t&&(q.originalPaths[e.shapeId]=t.getAttribute("d"))})),q.timeline=a(),gsap.set(z,{x:0,y:0,transformOrigin:"50% 50%"}),C&&gsap.set(C,{x:0,y:0}),q.timeline.progress(d),O(),"hover"===I.interaction?M&&M.addEventListener("mousemove",S):(X.addEventListener("touchstart",w,{passive:!1}),X.addEventListener("touchmove",L,{passive:!1}),X.addEventListener("touchend",x),X.addEventListener("touchcancel",x),c&&X.addEventListener("mousedown",E)),window.addEventListener("resize",k),u=function(){M&&M.removeEventListener("mousemove",S),X.removeEventListener("touchstart",w),X.removeEventListener("touchmove",L),X.removeEventListener("touchend",x),X.removeEventListener("touchcancel",x),X.removeEventListener("mousedown",E),A&&A(),window.removeEventListener("resize",k),m(),q.timeline&&q.timeline.kill(),gsap.killTweensOf(z),C&&gsap.killTweensOf(C)}}const a=991,l=767,c=window.matchMedia("(hover: hover) and (pointer: fine)").matches;let p=null,u=null,d=0;s()}();

/* ==== slater-detail.js ==== */
function bringToFront(t){window.topZ+=1,t.style.zIndex=window.topZ}function getNavBottom(){let t=0;for(const e of navEls){const i=e.getBoundingClientRect();i.height>0&&(t=Math.max(t,i.bottom))}return t}function seedPosition(t){const e=document.querySelector(t);if(!e||!e.parentElement)return;const i=e.style.left&&""!==e.style.left,n=e.style.top&&""!==e.style.top;if(i&&n)return;const r=e.parentElement.getBoundingClientRect(),o=e.getBoundingClientRect();i||(e.style.left=o.left-r.left+"px"),n||(e.style.top=o.top-r.top+"px")}function makeDraggable(t,e,i={}){function n(t){return t.touches&&t.touches.length?{x:t.touches[0].clientX,y:t.touches[0].clientY}:{x:t.clientX,y:t.clientY}}function r(t){m=!0,p.style.transition="none",bringToFront(p),u=p.style.overflow,p.style.overflow="hidden";const e=a.getBoundingClientRect(),i=p.getBoundingClientRect(),r=p.style.left&&""!==p.style.left,o=p.style.top&&""!==p.style.top;f=r?parseInt(p.style.left,10)||0:i.left-e.left,d=o?parseInt(p.style.top,10)||0:i.top-e.top,p.style.left=f+"px",p.style.top=d+"px";const s=n(t);g=s.x,y=s.y,document.body.style.userSelect="none"}function o(t){if(!m)return;t.preventDefault();const e=n(t);let i=f+(e.x-g),r=d+(e.y-y);p.style.left=i+"px",p.style.top=r+"px";const o=a.getBoundingClientRect(),s=p.getBoundingClientRect();s.left<o.left&&(i+=o.left-s.left),s.right>o.right&&(i-=s.right-o.right);const l=c?Math.max(o.top,getNavBottom()):o.top;s.top<l&&(r+=l-s.top),s.bottom>o.bottom&&(r-=s.bottom-o.bottom),p.style.left=i+"px",p.style.top=r+"px"}function s(){m&&(m=!1,document.body.style.userSelect="",p.style.overflow=u||"",u=null)}const p=document.querySelector(t),l=document.querySelector(e);if(!p||!l)return;const a=p.parentElement,c=!1!==i.clampToNav;l.style.touchAction="none";let g,y,f,d,u=null,m=!1;l.addEventListener("mousedown",r),document.addEventListener("mousemove",o),document.addEventListener("mouseup",s),l.addEventListener("touchstart",r,{passive:!1}),document.addEventListener("touchmove",o,{passive:!1}),document.addEventListener("touchend",s),document.addEventListener("touchcancel",s)}function setupPopup(t,e,i,n={}){function r(){return g&&window.pricingState?window.pricingState.isScaledDown?PRICING_SCALE:1:l}const o=document.querySelector(t),s=document.querySelector(e),p=document.querySelector(i);if(!s||!p)return;const l=n.openScale||1,a=n.startOpen||!1,c=n.flyToIcon||!1,g=n.scrollControlled||!1,y=c?0:.05;a&&!g?(bringToFront(s),s.style.display="block",s.style.visibility="visible",s.style.opacity="1",s.style.transform=`scale(${l})`,s.style.transformOrigin="center center",s.style.pointerEvents="all"):g||(s.style.visibility="hidden",s.style.display="block",s.style.pointerEvents="none",s.style.opacity="0"),o&&o.addEventListener("click",(function(){if(bringToFront(s),c){const t=s.parentElement.getBoundingClientRect(),e=o.getBoundingClientRect(),i=e.left+e.width/2-t.left,n=e.top+e.height/2-t.top,p=r();let l,a,c,y;if(1===p)l=0,a=0,c=0,y=0;else{const t=20,e=s.offsetHeight*(1-p)-20;l=t-s.offsetWidth/2*(1-p),a=e-s.offsetHeight/2*(1-p),c=20,y=-20}s.style.transition="none",s.style.left="0px",s.style.top="0px",s.style.transformOrigin="center center",s.style.transform=`translate(${i-s.offsetWidth/2}px, ${n-s.offsetHeight/2}px) scale(0)`,s.style.visibility="visible",s.offsetHeight,s.style.transition=`transform 0.5s ${EASE}, opacity 0.25s ease`,s.style.opacity="1",s.style.transform=`translate(${l}px, ${a}px) scale(${p})`,s.style.pointerEvents="all",g&&window.pricingState&&(window.pricingState.isMinimized=!1),s.addEventListener("transitionend",(function t(){s.removeEventListener("transitionend",t),s.style.transition="none",s.style.transformOrigin="bottom left",s.style.transform=`scale(${p})`,s.style.left=c+"px",s.style.top=y+"px"}))}else{s.style.transition="none",s.style.transform=`scale(${l})`,s.style.visibility="hidden",s.style.opacity="0",s.offsetHeight;const t=o.getBoundingClientRect(),e=s.getBoundingClientRect(),i=t.left+t.width/2-e.left,n=t.top+t.height/2-e.top;s.style.transformOrigin=`${i}px ${n}px`,s.style.transform=`scale(${y})`,s.style.visibility="visible",s.offsetHeight,s.style.transition=`transform 0.4s ${EASE}, opacity 0.25s ease`,s.style.transform=`scale(${l})`,s.style.opacity="1",s.style.pointerEvents="all"}seedPosition(e)})),p.addEventListener("click",(function(){if(c&&o){const t=s.getBoundingClientRect(),e=s.parentElement.getBoundingClientRect(),i=t.left-e.left,n=t.top-e.top,p=r(),l=i-s.offsetWidth/2*(1-p),a=n-s.offsetHeight/2*(1-p),c=o.getBoundingClientRect(),y=c.left+c.width/2-e.left,f=c.top+c.height/2-e.top;s.style.transition="none",s.style.left="0px",s.style.top="0px",s.style.transformOrigin="center center",s.style.transform=`translate(${l}px, ${a}px) scale(${p})`,s.offsetHeight,s.style.transition=`transform 0.5s ${EASE}, opacity 0.2s ease`,s.style.transform=`translate(${y-s.offsetWidth/2}px, ${f-s.offsetHeight/2}px) scale(0)`,s.style.pointerEvents="none",g&&window.pricingState&&(window.pricingState.isMinimized=!0)}else{let t="50%",e="50%";if(o){const i=o.getBoundingClientRect(),n=s.getBoundingClientRect();t=i.left+i.width/2-n.left+"px",e=i.top+i.height/2-n.top+"px"}s.style.transformOrigin=`${t} ${e}`,s.style.transition=`transform 0.3s ${EASE}, opacity 0.2s ease`,s.style.transform=`scale(${y})`,s.style.opacity="0",s.style.pointerEvents="none"}})),s.addEventListener("mousedown",(function(){bringToFront(s)}))}window.topZ||(window.topZ=1e5);const navEls=[document.querySelector(".nav_section"),document.querySelector(".navbar")].filter(Boolean);[".faq_wrapper",".testimonial_wrapper",".natalia_wrapper",".andrii_wrapper",".zefir_wrapper"].forEach(seedPosition),makeDraggable(".faq_wrapper",".faq_grabb"),makeDraggable(".testimonial_wrapper",".testimonial_grabb"),makeDraggable(".natalia_wrapper",".natalia_grabb"),makeDraggable(".andrii_wrapper",".andrii_grabb"),makeDraggable(".zefir_wrapper",".zefir_grabb"),makeDraggable(".pricing_wrapper",".pricing_grabb");const EASE="cubic-bezier(0.25,0.46,0.45,0.94)",PRICING_SCALE=.45,stickyWrapper=document.querySelector(".sticky_blur_wrapper"),pricingWrapper=document.querySelector(".pricing_wrapper"),pricingGrabb=document.querySelector(".pricing_grabb"),pricingBorders=document.querySelectorAll(".pricing_border");if(stickyWrapper&&pricingWrapper){pricingGrabb&&(pricingGrabb.style.opacity="0"),pricingBorders.forEach((t=>t.style.opacity="0")),window.pricingState={isMinimized:!1,isScaledDown:!1};let t=!1,e=!1;function setBadgeOpacity(t){pricingGrabb&&(pricingGrabb.style.transition=`opacity 0.5s ${EASE}`,pricingGrabb.style.opacity=t),pricingBorders.forEach((e=>{e.style.transition=`opacity 0.5s ${EASE}`,e.style.opacity=t}))}function updatePricing(){const e=stickyWrapper.getBoundingClientRect(),i=stickyWrapper.offsetHeight-window.innerHeight,n=(i>0?-e.top/i:0)>=.7;if(n!==t)if(t=n,window.pricingState.isScaledDown=n,n)window.pricingState.isMinimized||(pricingWrapper.style.transition=`transform 0.5s ${EASE}, left 0.5s ${EASE}, top 0.5s ${EASE}`,pricingWrapper.style.transformOrigin="bottom left",pricingWrapper.style.transform=`scale(${PRICING_SCALE})`,pricingWrapper.style.left="20px",pricingWrapper.style.top="-20px",pricingWrapper.style.pointerEvents="all",setBadgeOpacity("1"));else{window.pricingState.isMinimized=!1,bringToFront(pricingWrapper),setBadgeOpacity("0");if("hidden"===pricingWrapper.style.visibility||pricingWrapper.style.transform.includes("scale(0)"))pricingWrapper.style.transition="none",pricingWrapper.style.left="20px",pricingWrapper.style.top="-20px",pricingWrapper.style.visibility="visible",pricingWrapper.style.transformOrigin="bottom left",pricingWrapper.style.transform=`scale(${PRICING_SCALE})`,pricingWrapper.style.pointerEvents="all",pricingWrapper.offsetHeight,pricingWrapper.style.transition=`transform 0.5s ${EASE}, left 0.5s ${EASE}, top 0.5s ${EASE}`,pricingWrapper.style.transform="scale(1)",pricingWrapper.style.left="0px",pricingWrapper.style.top="0px";else{const t=pricingWrapper.getBoundingClientRect(),e=pricingWrapper.parentElement.getBoundingClientRect(),i=t.left-e.left,n=t.top-e.top,r=1-PRICING_SCALE,o=i/r,s=n/r;pricingWrapper.style.transition="none",pricingWrapper.style.left="0px",pricingWrapper.style.top="0px",pricingWrapper.style.transformOrigin=`${o}px ${s}px`,pricingWrapper.style.transform=`scale(${PRICING_SCALE})`,pricingWrapper.offsetHeight,pricingWrapper.style.transition=`transform 0.5s ${EASE}`,pricingWrapper.style.transform="scale(1)"}pricingWrapper.style.pointerEvents="all"}}window.addEventListener("scroll",(function(){e||(e=!0,requestAnimationFrame((function(){updatePricing(),e=!1})))}),{passive:!0})}setupPopup(".faq_icon",".faq_wrapper",".faq_close"),setupPopup(".testimonial_icon",".testimonial_wrapper",".testimonial_close"),setupPopup(".zefir_icon",".zefir_wrapper",".zefir_close"),setupPopup(".natalia_icon",".natalia_wrapper",".natalia_close"),setupPopup(".andrii_icon",".andrii_wrapper",".andrii_close"),setupPopup(".pricing_icon",".pricing_wrapper",".pricing_close",{openScale:PRICING_SCALE,flyToIcon:!0,scrollControlled:!0});