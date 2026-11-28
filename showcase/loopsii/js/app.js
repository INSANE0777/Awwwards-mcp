/* Private study recreation of loopsii.com — original site logic re-implemented. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const u = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--u")) || 0.75;

  /* ---------- loader ---------- */
  document.body.classList.add("is-loading");
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------- lenis ---------- */
  let lenis = null;
  if (!reduced && window.Lenis) {
    lenis = new window.Lenis({ duration: 1.15, smoothWheel: true, wheelMultiplier: 1 });
    const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
  }
  $$('a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      const id = a.getAttribute("href");
      if (!id || id === "#") return;
      const target = $(id);
      if (!target) return;
      e.preventDefault();
      if (lenis) lenis.scrollTo(target, { offset: -80 });
      else target.scrollIntoView({ behavior: "smooth" });
    });
  });

  /* ---------- nav ---------- */
  const nav = $("#nav");
  const onNav = () => nav?.classList.toggle("is-scrolled", window.scrollY > 60);
  onNav();

  /* ---------- hero words ---------- */
  const words = $$("#heroWords span");
  if (words.length) {
    let wi = 0;
    const setWord = (n) => {
      words.forEach((w, i) => {
        w.classList.toggle("is-active", i === n);
        w.classList.toggle("is-prev", i === wi && i !== n);
      });
      wi = n;
    };
    setWord(0);
    if (!reduced) setInterval(() => setWord((wi + 1) % words.length), 2400);
  }

  /* ---------- hero shapes ---------- */
  const shapes = [
    [0, 0, "square", "var(--lime-light)"], [1, 0, "square", "var(--sky)"], [2, 0, "square", "var(--sage)"],
    [3, 0, "tri-br", "var(--coral)"], [4, 0, "square", "var(--lime-light)"], [5, 0, "square", "var(--sage)"],
    [6, 0, "square", "var(--lime-light)"], [7, 0, "diamond", "var(--coral)"], [8, 0, "square", "var(--apricot)"],
    [9, 0, "square", "var(--sky)"], [10, 0, "square", "var(--sage)"],
    [0, 1, "circle", "var(--lime-light)"], [1, 1, "arch", "var(--apricot)"], [2, 1, "tri-br", "var(--coral)"],
    [3, 1, "square", "var(--sky)"], [5, 1, "square", "var(--sky)"], [6, 1, "quarter", "var(--sage)"],
    [7, 1, "square", "var(--sage)"], [8, 1, "square", "var(--lime-light)"], [10, 1, "square", "var(--sky)"],
    [0, 2, "square", "var(--sage)"], [1, 2, "square", "var(--lime-light)"], [2, 2, "quarter", "var(--coral)"],
    [3, 2, "arch", "var(--sage)"], [4, 2, "square", "var(--sky)"], [5, 2, "square", "var(--sage)"],
    [6, 2, "square", "var(--lime-light)"], [7, 2, "diamond", "var(--apricot)"], [8, 2, "square", "var(--sky)"],
    [9, 2, "square", "var(--lime-light)"], [10, 2, "square", "var(--sage)"],
  ];
  const heroShapes = $("#heroShapes");
  if (heroShapes) {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 11; c++) {
      const cell = document.createElement("div");
      cell.className = "hero-cell";
      const item = shapes.find((s) => s[0] === c && s[1] === r);
      if (item) {
        const el = document.createElement("span");
        el.className = "shape " + item[2];
        el.style.setProperty("--c", item[3]);
        cell.appendChild(el);
      }
      heroShapes.appendChild(cell);
    }
    const loopCell = heroShapes.children[1 * 11 + 5];
    if (loopCell) {
      const loop = document.createElement("div");
      loop.className = "hero-loop";
      loop.innerHTML = '<div class="hero-mark-lottie" id="heroMarkLottie"></div>';
      loopCell.appendChild(loop);
    }
  }

  /* ---------- loader scene ---------- */
  {
    const loader = $("#loader");
    const loaderSheet = $(".loader-sheet");
    const loaderBox = $(".loader-box");
    const loaderDots = $$(".loader-dot");
    const loaderLinesX = $$(".loader-line-x");
    const loaderLinesY = $$(".loader-line-y");
    const loaderFrame = $(".loader-frame");
    const loaderCounter = $(".loader-counter");
    const loaderMark = $("#loaderMark");
    const loaderCount = $("#loaderCount");
    const heroHeading = $(".hero-heading");
    const heroSub = $(".hero-sub");
    const heroLabels = $$(".hero-label");
    const easeExpo = "cubic-bezier(.16,1,.3,1)";
    const easeSheet = "cubic-bezier(.76,0,.24,1)";
    let geo = null;

    const finishLoader = () => {
      loader?.classList.add("is-done");
      document.body.classList.remove("is-loading");
      document.body.classList.add("is-loaded");
      dispatchEvent(new Event("loopsii:loaded"));
    };
    const failsafe = setTimeout(finishLoader, 15000);

    const placeLoader = () => {
      const spacing = parseFloat(getComputedStyle(document.body).fontSize) / 16;
      const mobile = matchMedia("(max-width: 479px)").matches;
      const heroW = $(".hero")?.getBoundingClientRect().width || innerWidth;
      const n = Math.min((mobile ? 150 : 290) * spacing, heroW);
      const left = (innerWidth - n) / 2;
      const top = (innerHeight - n) / 2;
      Object.assign(loaderBox.style, { left: `${left}px`, top: `${top}px`, width: `${n}px`, height: `${n}px` });
      const cell = (heroShapes?.getBoundingClientRect().width || heroW) / 11;
      const mw = 0.36 * cell * 445 / 300;
      const mh = mw * 383 / 445;
      geo = { n, left, top, mleft: left + (n - mw) / 2, mtop: top + (n - mh) / 2, mw, mh };
      Object.assign(loaderMark.style, { left: `${geo.mleft}px`, top: `${geo.mtop}px`, width: `${mw}px`, height: `${mh}px` });
      const t = spacing * 40;
      const corners = [[t, t], [innerWidth - t, t], [innerWidth - t, innerHeight - t], [t, innerHeight - t]];
      const boxC = [[left, top], [left + n, top], [left + n, top + n], [left, top + n]];
      loaderDots.forEach((dot, i) => { dot.style.transform = `translate(${corners[i][0] - boxC[i][0]}px,${corners[i][1] - boxC[i][1]}px)`; });
      loaderLinesX.forEach((l) => { l.style.transform = "scaleX(0)"; });
      loaderLinesY.forEach((l) => { l.style.transform = "scaleY(0)"; });
    };

    const count = (duration = 3000, delay = 300) => new Promise((resolve) => {
      const start = performance.now() + delay;
      const tick = (now) => {
        const p = clamp((now - start) / duration);
        const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        loaderCount.textContent = String(Math.round(e * 100)).padStart(3, "0");
        if (p < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });

    const kit = (async () => {
      try {
        if (!window.lottie) return null;
        const mk = (container, path) => window.lottie.loadAnimation({ container, renderer: "svg", loop: false, autoplay: false, path });
        const left = $("#loaderLeft") && mk($("#loaderLeft"), "assets/lottie/logo-left.json");
        const right = $("#loaderRight") && mk($("#loaderRight"), "assets/lottie/logo-right.json");
        const hero = $("#heroMarkLottie") && mk($("#heroMarkLottie"), "assets/lottie/logo-loop.json");
        const anims = [left, right, hero].filter(Boolean);
        await Promise.all(anims.map((a) => new Promise((res) => {
          let done = false;
          const fin = () => { if (!done) { done = true; res(); } };
          a.addEventListener("DOMLoaded", fin);
          setTimeout(fin, 1400);
        })));
        left?.goToAndStop(21, true);
        right?.goToAndStop(21, true);
        hero?.goToAndStop(21, true);
        return { left, right, hero };
      } catch {
        return null;
      }
    })();

    const revealHero = () => {
      const shapes = $$(".hero-cell .shape");
      const band = $(".hero-shapes")?.getBoundingClientRect();
      if (band) {
        const cx = band.left + band.width / 2;
        const cy = band.top + band.height / 2;
        const max = Math.hypot(band.width / 2, band.height / 2);
        shapes.forEach((s) => {
          const r = s.getBoundingClientRect();
          const d = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
          s.animate([{ transform: "scale(0)" }, { transform: "scale(1)" }], {
            duration: 700, delay: Math.min(1, d / max) * 450, easing: "cubic-bezier(.34,1.56,.64,1)", fill: "both",
          });
        });
        $$(".hero-loop").forEach((l) => l.animate([{ scale: "0" }, { scale: "1" }], {
          duration: 700, delay: 100, easing: "cubic-bezier(.34,1.56,.64,1)", fill: "both",
        }));
      }
      heroLabels.forEach((l) => l.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 150, easing: "ease-out", fill: "both" }));
      setTimeout(() => {
        heroHeading?.animate([{ opacity: 0, clipPath: "inset(0 0 100% 0)" }, { opacity: 1, clipPath: "inset(0 0 0 0)" }], {
          duration: 900, easing: easeSheet, fill: "both",
        });
        heroSub?.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "translateY(0)" }], {
          duration: 650, delay: 120, easing: "ease-out", fill: "both",
        });
      }, 60);
    };

    const exit = async (anims) => {
      loader.classList.add("is-clear");
      const targetLoop = $(".hero-loop");
      const host = targetLoop?.parentElement?.getBoundingClientRect();
      const loopSize = targetLoop?.offsetWidth || geo.mw;
      const tw = loopSize * 0.36;
      const th = tw * 383 / 445;
      const cx = host ? host.left + host.width / 2 : geo.mleft + geo.mw / 2;
      const cy = host ? host.top + host.height / 2 : geo.mtop + geo.mh / 2;
      const tl = cx - tw / 2;
      const tt = cy - th / 2;
      const dx = tl + tw / 2 - (geo.mleft + geo.mw / 2);
      const dy = tt + th / 2 - (geo.mtop + geo.mh / 2);
      const sc = tw / geo.mw;
      loaderMark.animate([{ transform: "translate(0,0) scale(1)" }, { transform: `translate(${dx}px,${dy}px) scale(${sc})` }], {
        duration: 800, delay: 300, easing: easeExpo, fill: "both",
      });
      loaderCounter.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: "ease-in", fill: "both" });
      loaderFrame.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 500, delay: 300, fill: "both" });
      loaderBox.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 500, delay: 600, easing: "ease-out", fill: "both" });
      setTimeout(revealHero, 1000);
      loaderSheet.animate([{ transform: "translateY(0)" }, { transform: "translateY(-100%)" }], {
        duration: 1000, delay: 600, easing: easeExpo, fill: "both",
      });
      await delay(1500);
      loaderMark.style.opacity = "0";
      loaderBox.style.opacity = "0";
      await delay(120);
      clearTimeout(failsafe);
      finishLoader();
    };

    const enter = async () => {
      placeLoader();
      await Promise.race([document.fonts.ready, delay(900)]);
      const anims = await kit.catch(() => null);
      if (!anims) {
        loaderMark.innerHTML = '<img src="assets/favicon.svg" alt="" style="width:100%;height:100%;object-fit:contain">';
      }
      loader.classList.add("is-ready");
      const spacing = parseFloat(getComputedStyle(document.body).fontSize) / 16;
      const t = spacing * 40;
      const corners = [[t, t], [innerWidth - t, t], [innerWidth - t, innerHeight - t], [t, innerHeight - t]];
      const boxC = [[geo.left, geo.top], [geo.left + geo.n, geo.top], [geo.left + geo.n, geo.top + geo.n], [geo.left, geo.top + geo.n]];
      loaderDots.forEach((dot, i) => {
        const dx = corners[i][0] - boxC[i][0];
        const dy = corners[i][1] - boxC[i][1];
        dot.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: "translate(0,0)" }], {
          duration: 1400, delay: 100 + i * 40, easing: "cubic-bezier(.65,0,.35,1)", fill: "both",
        });
      });
      loaderLinesY.forEach((l) => l.animate([{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }], {
        duration: 1200, delay: 650, easing: "cubic-bezier(.33,1,.68,1)", fill: "both",
      }));
      loaderLinesX.forEach((l) => l.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], {
        duration: 1200, delay: 750, easing: "cubic-bezier(.33,1,.68,1)", fill: "both",
      }));
      loaderFrame.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: 1400, easing: "ease-out", fill: "both" });
      loaderCounter.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: 300, easing: "ease-out", fill: "both" });
      count();
      setTimeout(() => {
        loaderMark.animate(
          [{ opacity: 0, transform: "scale(.72)" }, { opacity: 1, transform: "scale(1)" }],
          { duration: 620, easing: "cubic-bezier(.34,1.56,.64,1)", fill: "both" }
        );
      }, 1100);
      await delay(3300);
      await delay(250);
      await exit(anims);
    };

    if (reduced) {
      const anims = (async () => { await kit; return null; })();
      placeLoader();
      loader.classList.add("is-ready");
      loaderCount.textContent = "100";
      loaderCounter.style.opacity = "1";
      loaderFrame.style.opacity = "1";
      loaderMark.style.opacity = "1";
      loaderDots.forEach((d) => { d.style.transform = "translate(0,0)"; });
      loaderLinesX.forEach((l) => { l.style.transform = "scaleX(1)"; });
      loaderLinesY.forEach((l) => { l.style.transform = "scaleY(1)"; });
      loaderMark.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, delay: 500, fill: "both" });
      loaderSheet.animate([{ transform: "translateY(0)" }, { transform: "translateY(-100%)" }], { duration: 400, delay: 300, easing: "ease-out", fill: "both" });
      setTimeout(() => {
        clearTimeout(failsafe);
        finishLoader();
        heroHeading?.style.setProperty("opacity", "1");
        heroSub?.style.setProperty("opacity", "1");
        $$(".hero-cell .shape").forEach((s) => (s.style.transform = "scale(1)"));
        $$(".hero-loop").forEach((s) => (s.style.transform = "scale(1)"));
        heroLabels.forEach((l) => (l.style.opacity = "1"));
      }, 800);
      anims.catch(() => {});
    } else {
      enter();
    }
  }

  /* ---------- pixel background ---------- */
  const pixel = $(".pixel-bg");
  if (pixel) {
    const tones = ["rgba(255,255,255,.22)", "rgba(255,255,255,.42)", "#cdf255", "#d9f66d", "rgba(255,255,255,0)", "#c8ee55"];
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 72; i++) {
      const cell = document.createElement("i");
      cell.style.background = tones[Math.floor(rnd() * tones.length)];
      pixel.appendChild(cell);
    }
  }

  /* ---------- distract tags ---------- */
  const tagsWrap = $("#distractTags");
  if (tagsWrap) {
    let seed = 13;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    $$(".tag", tagsWrap).forEach((t) => {
      t.style.setProperty("--tx", `${(rnd() * 60 - 30).toFixed(1)}vw`);
      t.style.setProperty("--ty", `${(rnd() * 70 + 40).toFixed(1)}vh`);
      t.style.setProperty("--tr", `${(rnd() * 24 - 12).toFixed(1)}deg`);
    });
  }

  /* ---------- stack swaps ---------- */
  const stackApps = $$(".stack-app");
  const totalEls = $$("[data-total]");
  const swapState = stackApps.map((el) => {
    let brands = [];
    try { brands = JSON.parse(el.dataset.brands || "[]"); } catch {}
    return { el, brands, i: 0 };
  });
  const updateTotals = () => {
    const total = swapState.reduce((sum, s) => sum + (s.brands[s.i]?.[1] ?? Number(s.el.dataset.price) ?? 0), 0);
    totalEls.forEach((el) => (el.textContent = String(total)));
  };
  const swapOne = () => {
    if (!swapState.length) return;
    const pick = swapState[Math.floor(Math.random() * swapState.length)];
    if (pick.brands.length < 2) return;
    pick.i = (pick.i + 1) % pick.brands.length;
    const [name, price] = pick.brands[pick.i];
    const nameEl = $(".app-name", pick.el);
    const priceEl = $(".app-price", pick.el);
    if (nameEl) nameEl.textContent = name;
    if (priceEl) priceEl.textContent = `$${price}/yr`;
    updateTotals();
  };
  updateTotals();
  if (!reduced) {
    let swapTimer = null;
    const startSwaps = () => { if (!swapTimer) swapTimer = setInterval(swapOne, 2600); };
    const stopSwaps = () => { if (swapTimer) { clearInterval(swapTimer); swapTimer = null; } };
    const stack = $("#why-loopsii");
    if (stack) {
      new IntersectionObserver((entries) => entries.forEach((e) => (e.isIntersecting ? startSwaps() : stopSwaps())), { threshold: 0.15 }).observe(stack);
    }
  }

  /* ---------- testimonials ---------- */
  const track = $("#testiTrack");
  const slides = $$(".testi-slide");
  const testiNum = $("#testiNum");
  const testiStatus = $("#testiStatus");
  let ti = 0;
  const layoutTestimonials = () => {
    if (!track || !slides.length) return;
    const stage = track.parentElement;
    const card = slides[0].getBoundingClientRect().width;
    const gap = parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap) || 0;
    const x = (stage.clientWidth - card) / 2 - ti * (card + gap);
    track.style.transform = `translateX(${x}px)`;
    slides.forEach((s, i) => {
      s.classList.toggle("is-active", i === ti);
      s.setAttribute("aria-hidden", i === ti ? "false" : "true");
    });
    if (testiNum) testiNum.textContent = String(ti + 1).padStart(2, "0");
    if (testiStatus) testiStatus.textContent = `${ti + 1} of ${slides.length}`;
  };
  $$(".testi-arrow").forEach((btn) => btn.addEventListener("click", () => {
    const dir = btn.dataset.dir === "next" ? 1 : -1;
    ti = (ti + dir + slides.length) % slides.length;
    layoutTestimonials();
  }));
  layoutTestimonials();
  addEventListener("resize", layoutTestimonials);

  /* ---------- pricing ---------- */
  const pricing = $("#pricing");
  const priceSwitch = $("#priceSwitch");
  const setPlan = (yearly) => {
    pricing?.classList.toggle("is-yearly", yearly);
    priceSwitch?.setAttribute("aria-checked", String(yearly));
    $$(".price-option", pricing).forEach((b) => b.classList.toggle("is-active", b.dataset.plan === (yearly ? "yearly" : "monthly")));
  };
  $$(".price-option").forEach((b) => b.addEventListener("click", () => setPlan(b.dataset.plan === "yearly")));
  priceSwitch?.addEventListener("click", () => setPlan(!pricing.classList.contains("is-yearly")));

  /* ---------- faq ---------- */
  $$(".faq-item").forEach((item) => {
    const q = $(".faq-q", item);
    q?.addEventListener("click", () => {
      const open = item.classList.contains("is-open");
      $$(".faq-item").forEach((other) => {
        other.classList.remove("is-open");
        $(".faq-q", other)?.setAttribute("aria-expanded", "false");
      });
      if (!open) {
        item.classList.add("is-open");
        q.setAttribute("aria-expanded", "true");
      }
    });
  });

  /* ---------- waitlist ---------- */
  const counter = $(".counter");
  let counted = false;
  const clock = $("#clockCanvas");
  const drawClock = () => {
    if (!clock) return;
    const ctx = clock.getContext("2d");
    const w = clock.width, h = clock.height, cx = w / 2, cy = h / 2, R = w * 0.47;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
    const palette = ["#c4f041", "#fa8e66", "#bce6fa", "#aac2aa", "#f3bd77", "#e0f661"];
    let seed = 21;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 90; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = Math.sqrt(rnd()) * R * 0.86;
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      ctx.save();
      ctx.translate(x, y); ctx.rotate(rnd() * Math.PI);
      ctx.fillStyle = palette[Math.floor(rnd() * palette.length)];
      if (rnd() > 0.5) ctx.fillRect(-6, -6, 12, 12);
      else { ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    ctx.strokeStyle = "#111";
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
      const r1 = R * (i % 5 === 0 ? 0.86 : 0.91);
      ctx.lineWidth = i % 5 === 0 ? 4 : 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a) * R * 0.96, cy + Math.sin(a) * R * 0.96);
      ctx.stroke();
    }
    const now = new Date();
    const hr = (now.getHours() % 12) + now.getMinutes() / 60;
    const mn = now.getMinutes() + now.getSeconds() / 60;
    const sc = now.getSeconds();
    const hand = (angle, len, width, color) => {
      ctx.save(); ctx.translate(cx, cy); ctx.rotate((angle * Math.PI) / 180);
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(0, R * 0.1); ctx.lineTo(0, -len); ctx.stroke(); ctx.restore();
    };
    hand((hr / 12) * 360, R * 0.52, 12, "#111");
    hand((mn / 60) * 360, R * 0.7, 8, "#111");
    hand((sc / 60) * 360, R * 0.83, 3, "#111");
    ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.fillStyle = "#111"; ctx.fill();
    ctx.restore();
  };
  drawClock();
  setInterval(drawClock, 1000);
  const wait = $(".waitlist");
  if (wait) {
    new IntersectionObserver((entries) => entries.forEach((e) => {
      if (!e.isIntersecting || counted || !counter) return;
      counted = true;
      const target = Number(counter.dataset.count || 160);
      const start = performance.now();
      const tick = (now) => {
        const p = clamp((now - start) / 1400);
        counter.textContent = String(Math.round(target * easeOut(p)));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }), { threshold: 0.4 }).observe(wait);
  }

  /* ---------- outro particles ---------- */
  const pc = $("#outroParticles");
  let particles = [];
  const resizeParticles = () => {
    if (!pc) return;
    const r = pc.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    pc.width = r.width * dpr; pc.height = r.height * dpr;
    const ctx = pc.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let seed = 33;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    particles = Array.from({ length: 150 }, () => ({ x: rnd() * r.width, y: rnd() * r.height, s: 1 + rnd() * 4, a: 0.25 + rnd() * 0.6, v: 0.08 + rnd() * 0.25 }));
  };
  const drawParticles = () => {
    if (!pc) return;
    const ctx = pc.getContext("2d");
    const r = pc.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);
    particles.forEach((p) => {
      ctx.fillStyle = `rgba(120, 170, 255, ${p.a})`;
      ctx.fillRect(p.x, p.y, p.s, p.s);
    });
  };
  if (pc) {
    resizeParticles(); drawParticles();
    addEventListener("resize", () => { resizeParticles(); drawParticles(); });
    if (!reduced) {
      let last = 0;
      const drift = (t) => {
        if (t - last > 40) {
          last = t;
          const r = pc.getBoundingClientRect();
          particles.forEach((p) => { p.y -= p.v; if (p.y < -6) p.y = r.height + 6; });
          drawParticles();
        }
        requestAnimationFrame(drift);
      };
      requestAnimationFrame(drift);
    }
  }

  /* ---------- cookies ---------- */
  const cookies = $("#cookies");
  if (localStorage.getItem("loopsii-study-cookies") === "1") cookies?.classList.add("is-hidden");
  $("#cookieOk")?.addEventListener("click", () => {
    cookies?.classList.add("is-hidden");
    localStorage.setItem("loopsii-study-cookies", "1");
  });

  /* ---------- scroll scenes ---------- */
  const intro = $("#intro"), introSticky = $(".intro-sticky");
  const distraction = $("#distraction"), distractTags = $("#distractTags");
  const appdemo = $("#appdemo"), appWin = $("[data-appwindow]"), appStage = $(".appdemo-stage");
  const roadmap = $("#roadmap"), roadCards = $$(".roadmap-card");
  const outro = $(".outro"), outroTitle = $("#outroTitle");
  const heroWordsEl = $("#heroWords");
  const appTitle = $(".appdemo-title");

  const measureAppTitle = () => {
    if (!appTitle) return;
    appTitle.style.setProperty("--ap", "1");
    appTitle.style.setProperty("--boost", "0");
    const range = document.createRange();
    range.selectNodeContents(appTitle);
    const w = range.getBoundingClientRect().width || 1;
    const boost = clamp(74 * ((window.innerWidth * 0.9) / w - 1), 0, 110);
    appTitle.style.setProperty("--boost", boost.toFixed(1));
    appTitle.style.setProperty("--ap", "0");
  };
  measureAppTitle();
  addEventListener("resize", measureAppTitle);
  if (document.fonts?.ready) document.fonts.ready.then(measureAppTitle);
  setTimeout(measureAppTitle, 1200);

  let ticking = false;
  const scene = () => {
    ticking = false;
    const vh = window.innerHeight;
    onNav();

    if (intro) {
      const r = intro.getBoundingClientRect();
      const p = clamp(-r.top / Math.max(1, r.height - vh));
      introSticky?.style.setProperty("--ip", String(clamp((p - 0.45) / 0.45)));
      const orbit = $(".orbit");
      if (orbit) orbit.style.transform = `rotate(${p * 10}deg) scale(${1 + p * 0.08})`;
    }
    if (distraction) {
      const r = distraction.getBoundingClientRect();
      const p = clamp(-r.top / Math.max(1, r.height - vh));
      distractTags?.classList.toggle("is-in", reduced || p > 0.16);
      const photo = $(".distract-photo");
      if (photo) photo.style.transform = `scale(${1.12 + p * 0.07})`;
    }
    if (appdemo) {
      const r = appdemo.getBoundingClientRect();
      const p = clamp(-r.top / Math.max(1, r.height - vh));
      if (appWin && appStage) {
        appStage.style.setProperty("--ay", `${lerp(60, -29, Math.pow(p, 1.85))}vh`);
        appStage.style.setProperty("--as", String(lerp(0.92, 1, Math.pow(p, 1.6))));
      }
      if (appTitle) {
        const ap = clamp((-r.top - vh * 0.45) / (vh * 0.65));
        appTitle.style.setProperty("--ap", ap.toFixed(3));
        appTitle.style.setProperty("--title-top", (46 - 30 * Math.pow(ap, 5)).toFixed(2));
      }
    }
    if (roadmap && roadCards.length) {
      const r = roadmap.getBoundingClientRect();
      const p = clamp(-r.top / Math.max(1, r.height - vh));
      const active = Math.round(p * (roadCards.length - 1));
      roadCards.forEach((card, i) => {
        const d = i - active;
        const ad = Math.abs(d);
        let x, y, rot, s, o;
        if (ad <= 1) {
          x = d * 913; y = ad * 184; rot = d * 26; s = 1 - ad * 0.1; o = 1;
        } else {
          x = Math.sign(d) * 1400; y = 420; rot = Math.sign(d) * 34; s = 0.86; o = 0;
        }
        card.style.setProperty("--x", x.toFixed(1));
        card.style.setProperty("--y", y.toFixed(1));
        card.style.setProperty("--r", rot.toFixed(2));
        card.style.setProperty("--s", s.toFixed(3));
        card.style.setProperty("--o", o.toFixed(2));
      });
    }
    if (outro) {
      const r = outro.getBoundingClientRect();
      const p = clamp((vh - r.top) / (vh + r.height));
      outroTitle?.style.setProperty("--px", p.toFixed(3));
    }
    if (heroWordsEl) {
      const sy = window.scrollY;
      heroWordsEl.style.transform = `translateY(${Math.min(sy * 0.06, 20)}px)`;
    }
  };
  const requestScene = () => { if (!ticking) { ticking = true; requestAnimationFrame(scene); } };
  addEventListener("scroll", requestScene, { passive: true });
  addEventListener("resize", requestScene);
  requestScene();
  setTimeout(requestScene, 1400);

  /* ---------- footer video ---------- */
  const video = $(".footer-video");
  if (video) {
    const play = () => { video.play().catch(() => {}); };
    play();
    const footer = $("#footer");
    if (footer) new IntersectionObserver((entries) => entries.forEach((e) => (e.isIntersecting ? play() : video.pause())), { threshold: 0.1 }).observe(footer);
  }
})();
