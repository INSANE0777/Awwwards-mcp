/* Pomegranate — study recreation motion + Rive wiring.
   Measured from the reference: anime.js v4 elastic word reveals, scroll-synced phones,
   lazy Rive canvases (State Machine / Artboard defaults, Fit.Cover). */

(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hasAnime = typeof anime !== "undefined";

  /* ---------- word splitting ---------- */
  function splitWords(el) {
    if (!el || el.dataset.split === "1") return [];
    const words = el.textContent.trim().split(/\s+/);
    el.textContent = "";
    const spans = [];
    words.forEach((word, i) => {
      const span = document.createElement("span");
      span.className = "--type-word";
      span.textContent = word;
      el.appendChild(span);
      if (i < words.length - 1) el.appendChild(document.createTextNode(" "));
      spans.push(span);
    });
    el.dataset.split = "1";
    return spans;
  }

  /* ---------- reveal (heading words / body copy / tag) ---------- */
  function onceInView(el, cb) {
    if (!("IntersectionObserver" in window)) { cb(); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) { io.disconnect(); cb(); }
      });
    }, { rootMargin: "0px 0px -10% 0px" });
    io.observe(el);
  }

  function reveal(scope, { onScroll = true, start = 0 } = {}) {
    const heading = scope.querySelector('[data-reveal="heading"]');
    const text = scope.querySelector('[data-reveal="text"]');
    const tag = scope.querySelector('[data-reveal="tag"]');

    if (!hasAnime || reduce) {
      scope.querySelectorAll("[data-reveal]").forEach((el) => {
        el.style.opacity = "1";
        el.style.transform = "none";
      });
      return;
    }

    // Animations are created paused so the from-state is applied at load, then played once
    // when the block enters view. Playing once guarantees copy never stays half-faded.
    const animateOnce = (targets, options) => {
      const anim = anime.animate(targets, { ...options, autoplay: false });
      if (onScroll) onceInView(scope, () => anim.play());
      else anim.play();
      return anim;
    };

    if (tag) {
      animateOnce(tag, {
        scaleX: [0.66, 1],
        opacity: [0, 1],
        duration: 1200,
        delay: 80,
        ease: "outElastic(1, .5)",
      });
    }

    if (heading) {
      const words = splitWords(heading);
      animateOnce(words, {
        scaleY: { from: 0.8 },
        opacity: { from: 0, duration: 75, ease: "linear" },
        duration: 1800,
        delay: anime.stagger(60, { start: onScroll ? 0 : 500 + start }),
        ease: "outElastic(1.3, 0.4)",
      });
    }

    if (text) {
      animateOnce(text, {
        opacity: { from: 0 },
        duration: 300,
        ease: "linear",
        delay: onScroll ? 200 : 800 + start,
      });
    }
  }

  /* ---------- hero + feature reveals ---------- */
  document.querySelectorAll(".hero-card").forEach((el) => reveal(el, { onScroll: false }));
  document.querySelectorAll(".block-feature").forEach((el) => reveal(el, { onScroll: true }));

  /* ---------- phones: rise into place, scroll-synced ---------- */
  if (hasAnime && !reduce) {
    document.querySelectorAll("[data-phones]").forEach((phones) => {
      const items = phones.querySelectorAll(".part-phones_item");
      anime.animate(items, {
        y: ["100%", "0%"],
        ease: "outExpo",
        delay: anime.stagger(50),
        autoplay: anime.onScroll({ target: phones, sync: 0.5 }),
      });
    });
  }

  /* ---------- header: settle in ---------- */
  const header = document.querySelector(".part-header");
  const headerParts = header ? header.querySelectorAll(".part-header_left, .part-header_right") : [];

  if (hasAnime && !reduce && headerParts.length) {
    anime.animate(headerParts, {
      scale: [0.33, 1],
      opacity: [0, 1],
      duration: 800,
      ease: "outElastic(1, .8)",
      delay: anime.stagger(200, { start: 1000 }),
    });
  }

  /* ---------- menu ---------- */
  const menu = document.getElementById("site-menu");
  const toggle = document.querySelector("[data-menu-toggle]");
  const closeBtn = document.querySelector("[data-menu-close]");

  function openMenu() {
    if (!menu) return;
    menu.hidden = false;
    document.body.style.overflow = "hidden";
    toggle?.setAttribute("aria-expanded", "true");
    const items = menu.querySelectorAll(".part-menu_link");
    if (hasAnime && !reduce) {
      anime.animate(items, {
        scale: [0.9, 1],
        opacity: [0, 1],
        duration: 700,
        delay: anime.stagger(25, { start: 25 }),
        ease: "outElastic(1, .8)",
      });
    }
    closeBtn?.focus({ preventScroll: true });
  }

  function closeMenu() {
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    document.body.style.overflow = "";
    toggle?.setAttribute("aria-expanded", "false");
    toggle?.focus({ preventScroll: true });
  }

  toggle?.addEventListener("click", openMenu);
  closeBtn?.addEventListener("click", closeMenu);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });

  /* ---------- Rive illustrations ---------- */
  const riveEls = Array.from(document.querySelectorAll(".ui-rive[data-rive]"));
  const riveInstances = [];
  if (riveEls.length && typeof rive !== "undefined") {
    const riveData = window.POM_RIVE_DATA; // generated data URLs so file:// works too
    if (rive.RuntimeLoader?.setWasmUrl) {
      rive.RuntimeLoader.setWasmUrl(riveData?.wasm || "vendor/rive/rive.wasm");
    }

    riveEls.forEach((el, index) => {
      const w = Number(el.dataset.w) || 800;
      const h = Number(el.dataset.h) || 500;
      el.style.setProperty("--rw", w + "px");
      el.style.setProperty("--rh", h + "px");

      const canvas = document.createElement("canvas");
      el.appendChild(canvas);

      let started = false;
      const start = () => {
        if (started) return;
        started = true;
        setTimeout(() => initRive(el, canvas, index), 800 + index * 100);
      };

      if ("IntersectionObserver" in window) {
        const io = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting) {
                start();
                io.disconnect();
              }
            });
          },
          { rootMargin: "0px 0px -15% 0px" }
        );
        io.observe(el);
      } else {
        start();
      }
    });

    // keep the 2x drawing surface the reference uses after breakpoint changes
    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        riveInstances.forEach((instance) => instance.resizeDrawingSurfaceToCanvas(2));
      }, 200);
    });
  }

  function initRive(el, canvas, index) {
    const src = window.POM_RIVE_DATA?.assets?.[el.dataset.rive] || el.dataset.rive;
    const instance = new rive.Rive({
      src,
      canvas,
      autoplay: true,
      layout: new rive.Layout({ fit: rive.Fit.Cover, alignment: rive.Alignment.Center }),
      onLoad() {
        // 2x bitmap like the reference (1740x916 for the 870x458 artboard)
        instance.resizeDrawingSurfaceToCanvas(2);
        el.classList.add("is-ready");
        riveInstances.push(instance);
        if (reduce) setTimeout(() => instance.pause(), 1400);
      },
      onLoadError(err) {
        console.warn("[rive] could not load", el.dataset.rive, err);
        el.classList.add("is-ready");
      },
    });
    void index;
  }
})();
