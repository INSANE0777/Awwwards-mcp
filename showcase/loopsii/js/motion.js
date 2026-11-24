/* Scroll and section motion that runs on top of the base page. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const u = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--u")) || 0.75;
  if (!reduced) document.documentElement.classList.add("motion");

  /* ---------- split word reveals ---------- */
  const splitWords = (el) => {
    if (!el || el.dataset.split === "1") return;
    const walk = (node) => {
      [...node.childNodes].forEach((child) => {
        if (child.nodeType === 3) {
          const parts = child.textContent.split(/(\s+)/);
          if (!parts.some((p) => p.trim())) return;
          const frag = document.createDocumentFragment();
          parts.forEach((part) => {
            if (!part.trim()) { frag.appendChild(document.createTextNode(part)); return; }
            const outer = document.createElement("span");
            outer.className = "w";
            const inner = document.createElement("span");
            inner.textContent = part;
            outer.appendChild(inner);
            frag.appendChild(outer);
          });
          child.replaceWith(frag);
        } else if (child.nodeType === 1 && child.tagName !== "BR" && !child.classList.contains("w")) {
          walk(child);
        }
      });
    };
    walk(el);
    el.classList.add("split");
    $$(".w", el).forEach((w, i) => w.style.setProperty("--i", i));
    el.dataset.split = "1";
  };

  const initSplits = () => {
    if (reduced) return;
    const introH2 = $(".intro-head h2");
    const targets = $$("main section h2, .stack-cta h3, .feat-aside h3, .folders-card h2, .intro-note")
      .filter((el) => el !== introH2 && !el.closest(".hero, .outro, .appdemo, .hl-card, .folders-tile"));
    targets.forEach((el) => {
      splitWords(el);
      const io = new IntersectionObserver(([entry]) => {
        if (!entry.isIntersecting) return;
        el.classList.add("is-in");
        io.disconnect();
      }, { threshold: 0.15, rootMargin: "0px 0px -8% 0px" });
      io.observe(el);
    });
  };

  /* ---------- hero shape field ---------- */
  (() => {
    const host = $("#heroShapes");
    if (!host) return;
    const ROWS = 3;
    const COLS = 21;
    const LOOP = { row: 1, col: 10 };
    const TYPES = [
      ["square", "var(--lime-light)"], ["square", "var(--sky)"], ["square", "var(--sage)"],
      ["circle", "var(--lime-light)"], ["circle", "var(--apricot)"], ["diamond", "var(--coral)"],
      ["tri-br", "var(--coral)"], ["tri-tl", "var(--sky)"], ["tri-bl", "var(--sage)"], ["tri-tr", "var(--apricot)"],
      ["quarter", "var(--sage)"], ["quarter-bl", "var(--sky)"], ["quarter-tl", "var(--coral)"], ["quarter-tr", "var(--lime-light)"],
      ["arch", "var(--apricot)"], ["arch", "var(--sage)"], ["scoop", "var(--sky)"], ["scoop-tl", "var(--coral)"],
    ];
    let seed = 20261121;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const fill = new Map();
    const cells = [];
    let step = 0;
    let timer = null;
    let compactTimer = null;
    let compact = false;
    let running = false;

    const place = (cell) => {
      cell.el.style.setProperty("--col", cell.col);
      cell.el.style.setProperty("--row", cell.row);
    };

    const morph = (cell) => {
      if (!cell.shape) return;
      const type = TYPES[Math.floor(Math.random() * TYPES.length)];
      cell.shape.className = "shape " + type[0];
      cell.shape.style.setProperty("--c", type[1]);
      cell.shape.animate(
        [{ transform: "scale(.55) rotate(-10deg)", opacity: .45 }, { transform: "scale(1) rotate(0)", opacity: 1 }],
        { duration: 430, easing: "cubic-bezier(.34,1.56,.64,1)" }
      );
    };

    const build = () => {
      host.textContent = "";
      cells.length = 0;
      fill.clear();
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          if (row === LOOP.row && col === LOOP.col) continue;
          const cell = document.createElement("div");
          cell.className = "hero-cell";
          cell.dataset.row = row;
          cell.dataset.col = col;
          cell.style.setProperty("--col", col);
          cell.style.setProperty("--row", row);
          const visible = col >= 5 && col <= 15;
          if (rand() < (visible ? .92 : .55)) {
            const type = TYPES[Math.floor(rand() * TYPES.length)];
            const shape = document.createElement("span");
            shape.className = "shape " + type[0];
            shape.style.setProperty("--c", type[1]);
            cell.appendChild(shape);
            const record = { el: cell, shape, col, row };
            cells.push(record);
            fill.set(`${row}:${col}`, record);
          }
          host.appendChild(cell);
        }
      }
      const loop = document.createElement("div");
      loop.className = "hero-loop";
      loop.style.setProperty("--col", LOOP.col);
      loop.style.setProperty("--row", LOOP.row);
      loop.innerHTML = '<div class="hero-mark-lottie" id="heroMarkLottie"></div>';
      host.appendChild(loop);
      if (window.lottie) {
        const anim = window.lottie.loadAnimation({
          container: $("#heroMarkLottie"), renderer: "svg", loop: false, autoplay: false, path: "assets/lottie/logo-loop.json",
        });
        anim.addEventListener("DOMLoaded", () => anim.goToAndStop(21, true));
      }
      size();
    };

    const size = () => {
      if (!host.clientWidth) return;
      const cell = host.clientWidth / 11;
      host.style.setProperty("--cell", `${cell}px`);
      host.style.setProperty("--field-y", `${Math.max(0, (host.clientHeight - cell * 3) / 2)}px`);
    };

    const move = () => {
      const filled = cells.filter((c) => c.shape);
      for (let k = 0; k < 2; k++) {
        const cell = filled[Math.floor(Math.random() * filled.length)];
        if (!cell) continue;
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].sort(() => Math.random() - .5);
        for (const [dc, dr] of dirs) {
          const col = cell.col + dc;
          const row = cell.row + dr;
          if (col < 0 || col >= COLS || row < 0 || row >= ROWS) continue;
          if (row === LOOP.row && col === LOOP.col) continue;
          if (fill.has(`${row}:${col}`)) continue;
          fill.delete(`${cell.row}:${cell.col}`);
          cell.col = col;
          cell.row = row;
          fill.set(`${row}:${col}`, cell);
          place(cell);
          morph(cell);
          break;
        }
      }
      step++;
      if (step % 7 === 0) compactField();
    };

    const compactField = () => {
      if (compact) return;
      compact = true;
      cells.forEach((cell) => {
        if (!cell.shape) return;
        cell.baseCol = cell.col;
        cell.el.style.setProperty("--col", (10 + (cell.col - 10) * .42).toFixed(2));
      });
      clearTimeout(compactTimer);
      compactTimer = setTimeout(() => {
        cells.forEach((cell) => {
          if (!cell.shape || cell.baseCol == null) return;
          cell.el.style.setProperty("--col", cell.baseCol);
        });
        compact = false;
      }, 1500);
    };

    const start = () => {
      if (reduced || running) return;
      running = true;
      clearInterval(timer);
      timer = setInterval(() => { if (!compact) move(); }, 720);
    };
    const stop = () => {
      running = false;
      clearInterval(timer);
      clearTimeout(compactTimer);
    };

    build();
    addEventListener("resize", size);
    if (window.ResizeObserver) new ResizeObserver(size).observe(host);
    if (!reduced && "IntersectionObserver" in window) {
      new IntersectionObserver(([entry]) => (entry.isIntersecting ? start() : stop()), { threshold: 0 }).observe(host);
    }
    addEventListener("loopsii:loaded", start, { once: true });
    if (document.body.classList.contains("is-loaded")) start();
  })();

  /* ---------- intro logo travel + orbit ---------- */
  const intro = $("#intro");
  const introStage = $(".intro-stage");
  const introWrap = $(".intro-logo-wrap");
  const introLogo = $(".intro-logo");
  const introH2 = $(".intro-head h2");
  const heroLoop = $(".hero-loop");
  let orbit = null;

  if (introH2 && !reduced) splitWords(introH2);

  const loadIntroMark = () => {
    const host = $("#introMarkLottie");
    if (!host) return;
    if (!window.lottie) {
      host.innerHTML = '<img src="assets/favicon.svg" alt="" style="width:100%;height:100%;object-fit:contain">';
      return;
    }
    const anim = window.lottie.loadAnimation({
      container: host, renderer: "svg", loop: false, autoplay: false, path: "assets/lottie/logo-loop.json",
    });
    anim.addEventListener("DOMLoaded", () => anim.goToAndStop(21, true));
  };

  const updateTravel = () => {
    if (reduced || !introLogo || !introWrap || !intro || !heroLoop) return;
    const sectionTop = intro.getBoundingClientRect().top;
    const wrap = introWrap.getBoundingClientRect();
    const span = Math.max(1, innerHeight * .6);
    const p = clamp((span - sectionTop) / span);
    intro.classList.toggle("is-in", p > .82);
    if (p > .6) introH2?.classList.add("is-in");
    if (p >= .999) {
      introLogo.style.position = "";
      introLogo.style.left = "";
      introLogo.style.top = "";
      introLogo.style.width = "";
      introLogo.style.height = "";
      introLogo.classList.remove("is-traveling");
      if (heroLoop) heroLoop.style.opacity = "1";
      return;
    }
    const host = heroLoop.parentElement.getBoundingClientRect();
    const heroSize = heroLoop.offsetWidth || host.width / 11;
    heroLoop.style.opacity = "0";
    const startLeft = host.left + host.width / 2 - heroSize / 2;
    const startTop = host.top + host.height / 2 - heroSize / 2;
    const size = lerp(heroSize, wrap.width, p);
    const left = lerp(startLeft, wrap.left, p);
    const top = lerp(startTop, wrap.top - sectionTop, p);
    introLogo.classList.add("is-traveling");
    Object.assign(introLogo.style, {
      position: "fixed", left: `${left}px`, top: `${top}px`, width: `${size}px`, height: `${size}px`, margin: "0", transform: "none",
    });
  };

  const initOrbit = () => {
    if (!introStage) return;
    const items = $$(".orbit-item", introStage);
    if (!items.length) return;
    if (reduced) { intro?.classList.add("is-in"); return; }
    const measure = () => {
      const host = items[0]?.parentElement;
      if (!host) return;
      const hb = host.getBoundingClientRect();
      const cx = hb.left + hb.width / 2;
      const cy = hb.top + hb.height / 2;
      orbit = { angle: 0, items: items.map((item, i) => {
        item.style.setProperty("--i", i);
        const l = (parseFloat(item.style.getPropertyValue("--l")) || 0) * u();
        const t = (parseFloat(item.style.getPropertyValue("--t")) || 0) * u();
        const w = parseFloat(getComputedStyle(item).width) || 0;
        const h = parseFloat(getComputedStyle(item).height) || 0;
        const ix = hb.left + l + w / 2 - cx;
        const iy = hb.top + t + h / 2 - cy;
        return { item, radius: Math.hypot(ix, iy), base: Math.atan2(iy, ix) };
      }) };
    };
    const render = () => {
      if (!orbit) return;
      orbit.angle += .0022;
      orbit.items.forEach(({ item, radius, base, w, h }) => {
        const a = base + orbit.angle;
        const cx = Math.cos(a) * radius;
        const cy = Math.sin(a) * radius;
        item.style.setProperty("--ox", `${(cx - (Math.cos(base) * radius)).toFixed(1)}px`);
        item.style.setProperty("--oy", `${(cy - (Math.sin(base) * radius)).toFixed(1)}px`);
      });
    };
    let active = false;
    const tick = () => {
      if (!active) return;
      render();
      requestAnimationFrame(tick);
    };
    new IntersectionObserver(([entry]) => {
      active = entry.isIntersecting;
      if (active) {
        measure();
        requestAnimationFrame(tick);
      }
    }, { threshold: .1 }).observe(introStage);
    addEventListener("resize", measure);
    measure();
  };

  loadIntroMark();
  initOrbit();
  let queuedTravel = false;
  const onScrollTravel = () => {
    if (queuedTravel) return;
    queuedTravel = true;
    requestAnimationFrame(() => { queuedTravel = false; updateTravel(); });
  };
  addEventListener("scroll", onScrollTravel, { passive: true });
  addEventListener("resize", updateTravel);
  addEventListener("loopsii:loaded", updateTravel);
  if (document.fonts?.ready) document.fonts.ready.then(updateTravel);
  setTimeout(updateTravel, 1200);
  updateTravel();

  /* ---------- stack ---------- */
  const initStack = () => {
    const stack = $("#why-loopsii");
    if (!stack) return;
    const grid = $(".stack-grid", stack);
    const linesHost = $(".stack-lines", stack);
    const cards = $$(".stack-app", stack);
    const stats = $$(".stack-stat", stack);
    const loop = $(".stack-loop", stack);
    cards.forEach((el, i) => el.style.setProperty("--i", i % 6));
    stats.forEach((el, i) => el.style.setProperty("--i", i));
    $$(".loop-pill", stack).forEach((el, i) => el.style.setProperty("--i", i));

    if (grid && linesHost) {
      linesHost.innerHTML = "";
      for (let i = 0; i < 8; i++) {
        const v = document.createElement("i");
        v.className = "stack-vline";
        v.style.left = `${(i / 8) * 100}%`;
        linesHost.appendChild(v);
      }
      for (let i = 1; i < 9; i++) {
        const h = document.createElement("i");
        h.className = "stack-hline";
        h.style.top = `${(i / 9) * 100}%`;
        linesHost.appendChild(h);
      }
      const lineIO = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          e.target.classList.add("is-in");
          lineIO.unobserve(e.target);
        });
      }, { rootMargin: "0px 0px -8% 0px", threshold: 0 });
      $$(".stack-vline, .stack-hline", linesHost).forEach((l) => {
        if (reduced) l.classList.add("is-in");
        else lineIO.observe(l);
      });
    }

    const cardIO = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add("is-in");
        cardIO.unobserve(e.target);
      });
    }, { rootMargin: "0px 0px -10% 0px", threshold: .12 });
    cards.forEach((c) => {
      if (reduced) c.classList.add("is-in");
      else cardIO.observe(c);
    });

    const count = (el, to, from = 0) => {
      if (!el) return;
      const start = performance.now();
      const run = (now) => {
        const p = easeOut(clamp((now - start) / 1400));
        el.textContent = Math.round(lerp(from, to, p)).toLocaleString("en-US");
        if (p < 1) requestAnimationFrame(run);
      };
      requestAnimationFrame(run);
    };
    let counted = false;
    const statIO = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add("is-in");
        statIO.unobserve(e.target);
        if (counted) return;
        counted = true;
        const total = cards.reduce((sum, el) => sum + (Number(el.dataset.price) || 0), 0);
        $$("[data-total]", stack).forEach((el) => count(el, total));
      });
    }, { threshold: .3 });
    stats.forEach((s) => {
      if (reduced) s.classList.add("is-in");
      else statIO.observe(s);
    });

    const sectionIO = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      stack.classList.add("is-in");
      sectionIO.disconnect();
    }, { threshold: .04 });
    sectionIO.observe(stack);

    const pills = $$(".loop-pill", stack).map((el) => ({
      el,
      lx: parseFloat(el.style.getPropertyValue("--lx")) || 0,
      ly: parseFloat(el.style.getPropertyValue("--ly")) || 0,
    }));
    let orbitActive = false;
    let angle = 0;
    const tick = () => {
      if (!orbitActive) return;
      angle += .22 * (Math.PI / 180);
      pills.forEach(({ el, lx, ly }) => {
        const r = Math.hypot(lx, ly);
        const a = Math.atan2(ly, lx) + angle;
        el.style.setProperty("--lx", (Math.cos(a) * r).toFixed(1));
        el.style.setProperty("--ly", (Math.sin(a) * r).toFixed(1));
      });
      requestAnimationFrame(tick);
    };
    if (loop) {
      const loopIO = new IntersectionObserver(([entry]) => {
        const on = entry.isIntersecting;
        if (on) loop.classList.add("is-in");
        if (!reduced) {
          if (on && !orbitActive) {
            orbitActive = true;
            requestAnimationFrame(tick);
          }
          if (!on) orbitActive = false;
        }
      }, { threshold: .12 });
      loopIO.observe(loop);
    }

    const tailIO = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add("is-in");
        tailIO.unobserve(e.target);
      });
    }, { threshold: .15 });
    $$(".stack-side, .stack-badge, .stack-stem, .stack-hubcard", stack).forEach((el) => {
      if (reduced) el.classList.add("is-in");
      else tailIO.observe(el);
    });
  };

  /* ---------- highlights + gauge ---------- */
  const initHighlights = () => {
    const cards = $$(".hl-card");
    cards.forEach((card) => {
      const io = new IntersectionObserver(([entry]) => {
        if (!entry.isIntersecting) return;
        card.classList.add("is-in");
        io.disconnect();
      }, { threshold: .2 });
      io.observe(card);
    });
    const gauge = $(".viz-gauge");
    if (gauge && !reduced) {
      const paths = $$(".gauge-svg path.gauge-seg", gauge);
      const center = $(".gauge-center p", gauge);
      const pct = $(".gauge-center span", gauge);
      const legend = $$(".gauge-legend b", gauge);
      const targets = [38, 20, 13, 11.5];
      const kvals = [3.8, 2, 1.3, 1.15];
      let done = false;
      const draw = (p) => {
        const e = easeOut(p);
        const vals = targets.map((v) => v * e);
        let offset = 0;
        vals.forEach((v, i) => {
          if (!paths[i]) return;
          paths[i].setAttribute("stroke-dasharray", `${v} 100`);
          paths[i].setAttribute("stroke-dashoffset", String(-offset));
          offset += v;
        });
        if (center) center.innerHTML = `<sup>$</sup>${Math.round(7100 * e).toLocaleString("en-US")}`;
        if (pct) pct.textContent = `${Math.round(71 * e)}% of $10,000 goal`;
        legend.slice(0, 4).forEach((el, i) => {
          el.textContent = `$${(kvals[i] * e).toFixed(2)}k`;
        });
        if (legend[4]) legend[4].textContent = "$1.75k";
      };
      const io = new IntersectionObserver(([entry]) => {
        if (!entry.isIntersecting || done) return;
        done = true;
        const start = performance.now();
        const run = (now) => {
          const p = clamp((now - start) / 2400);
          draw(p);
          if (p < 1) requestAnimationFrame(run);
        };
        requestAnimationFrame(run);
        io.disconnect();
      }, { threshold: .35 });
      io.observe(gauge);
      draw(0);
    } else if (gauge) {
      const paths = $$(".gauge-svg path.gauge-seg", gauge);
      const vals = [38, 20, 13, 11.5];
      let offset = 0;
      paths.forEach((p, i) => {
        p.setAttribute("stroke-dasharray", `${vals[i]} 100`);
        p.setAttribute("stroke-dashoffset", String(-offset));
        offset += vals[i];
      });
      const center = $(".gauge-center p", gauge);
      const pct = $(".gauge-center span", gauge);
      if (center) center.innerHTML = "<sup>$</sup>7,100";
      if (pct) pct.textContent = "71% of $10,000 goal";
      const legend = $$(".gauge-legend b", gauge);
      ["$3.80k", "$2.00k", "$1.30k", "$1.15k", "$1.75k"].forEach((t, i) => { if (legend[i]) legend[i].textContent = t; });
    }
  };

  const updateCards = () => {
    const cards = $$(".hl-card");
    cards.forEach((card, i) => {
      const next = cards[i + 1];
      if (!next) return;
      const r = card.getBoundingClientRect();
      const n = next.getBoundingClientRect();
      const d = clamp((r.top + r.height - n.top) / Math.max(1, r.height));
      card.style.setProperty("--hs", (1 - d * .18).toFixed(3));
      card.style.setProperty("--hr", `${(-8 * d).toFixed(2)}deg`);
    });
  };
  let queuedCards = false;
  const onScrollCards = () => {
    if (queuedCards) return;
    queuedCards = true;
    requestAnimationFrame(() => { queuedCards = false; updateCards(); });
  };
  addEventListener("scroll", onScrollCards, { passive: true });
  addEventListener("resize", updateCards);
  updateCards();

  /* ---------- features + folders ---------- */
  const initCards = () => {
    $$(".feat-grid").forEach((grid) => {
      $$(".feat-card", grid).forEach((card, i) => {
        card.style.setProperty("--i", i);
        const io = new IntersectionObserver(([entry]) => {
          if (!entry.isIntersecting) return;
          card.classList.add("is-in");
          io.disconnect();
        }, { rootMargin: "400px 0px 400px 0px", threshold: .01 });
        io.observe(card);
      });
    });
    const folders = $(".folders");
    if (folders) {
      $$(".folder", folders).forEach((f, i) => f.style.setProperty("--i", i));
      const io = new IntersectionObserver(([entry]) => {
        if (!entry.isIntersecting) return;
        folders.classList.add("is-in");
        io.disconnect();
      }, { threshold: .15 });
      io.observe(folders);
    }
  };

  /* ---------- feature icon timelines ---------- */
  const initFeatureIcons = () => {
    const svgs = $$(".feat-icon svg[data-icon]");
    if (!svgs.length) return;
    const clamp01 = (v) => Math.min(1, Math.max(0, v));
    const smooth = (p) => { const t = clamp01(p); return t * t * (3 - 2 * t); };
    const lerpN = (a, b, p) => a + (b - a) * p;
    const read = (el) => {
      const d = el.dataset;
      return { el, x: +d.x || 0, y: +d.y || 0, r: +d.r || 0, sx: d.sx == null ? 1 : +d.sx, sy: d.sy == null ? 1 : +d.sy };
    };
    const paint = (g) => g.el.setAttribute("transform", `translate(${g.x} ${g.y}) rotate(${g.r}) scale(${g.sx} ${g.sy})`);
    const one = (svg, name) => {
      const el = svg.querySelector(`[data-l="${name}"]`);
      return el ? read(el) : null;
    };
    const many = (svg, sel) => [...svg.querySelectorAll(sel)].map(read);
    const phase = (t, dur) => (t % dur) / dur;
    const spin = (svg, t) => {
      const g = one(svg, "Vector");
      if (!g) return;
      g.r = (t * 69) % 360;
      paint(g);
    };
    const slideX = (svg, t, name, from, to, dur) => {
      const g = one(svg, name);
      if (!g) return;
      g.x = lerpN(from, to, smooth(phase(t, dur)));
      paint(g);
    };
    const slideY = (svg, t, name, from, to, dur) => {
      const g = one(svg, name);
      if (!g) return;
      g.y = lerpN(from, to, smooth(phase(t, dur)));
      paint(g);
    };
    const pulse = (svg, t) => {
      const el = svg.querySelector("[data-l]");
      if (!el) return;
      const g = read(el);
      g.y += Math.sin(t * 1.6) * 2;
      g.r = Math.sin(t * 1.1) * 2;
      paint(g);
    };
    const timelines = {
      reusable: spin,
      "final-invoice": spin,
      "follow-ups": spin,
      agreements: pulse,
      "todays-plate": pulse,
      deliverables: pulse,
      "deposit-invoice": (svg, t) => {
        const arr = many(svg, '[clip-path] [data-l^="Vector"]').sort((a, b) => a.x - b.x);
        const xs = [0, 36, 90, 160, 255, 349, 420, 474];
        const sc = [.97, 1.83, 2.38, 3.18, 4.19, 3.18, 2.38, 1.83];
        const p = smooth(clamp01((t % 1.7667) / 1));
        arr.forEach((g, i) => {
          const k = i % 8;
          g.x = -589 + 509 * Math.floor(i / 8) + lerpN(xs[k], xs[(k + 4) % 8], p);
          g.y = 121.04;
          g.r = 0;
          g.sy = 1;
          g.sx = lerpN(sc[k], sc[(k + 4) % 8], p);
          paint(g);
        });
      },
      "client-portal": (svg, t) => slideX(svg, t, "Null 7", 294.65, 398.8, 1.1),
      gantt: (svg, t) => slideX(svg, t, "Null 8", -29.42, 4.01, .55),
      "qa-change-log": (svg, t) => slideX(svg, t, "Null 12", 130.05, 646.19, 17.2),
      "handoff-docs": (svg, t) => slideY(svg, t, "Null 9", 1, -138.5, 1.767),
      "earnings-forecast": (svg, t) => slideY(svg, t, "Null 11", -60.36, 60, 1.033),
      "capacity-check": (svg, t) => slideX(svg, t, "Null 10", 0, 254.67, 1.733),
      "meetings-hub": (svg, t) => {
        const a = one(svg, "Shape Layer 2");
        const b = one(svg, "Shape Layer 3");
        const c = one(svg, "Shape Layer 4");
        const p = smooth(phase(t, 2.3));
        if (a) { a.x = lerpN(55, 168.8, p); paint(a); }
        if (b) { b.x = lerpN(168.8, 272.54, p); paint(b); }
        if (c) { c.x = lerpN(-51.73, 55, p); paint(c); }
      },
      "ai-meeting": (svg, t) => {
        const g = one(svg, "Shape Layer 2");
        if (!g) return;
        const p = t % 1.766;
        g.r = p < .9 ? 90 * smooth(p / .6) : 90 + 90 * smooth((p - .9) / .6);
        paint(g);
      },
      "time-tracking": (svg, t) => {
        const g = one(svg, "Time tracking");
        if (!g) return;
        const p = t % 1.733;
        const marks = [7, 14, 22, 29, 37, 44];
        let r = 0;
        marks.forEach((m, i) => { if (p * 30 >= m) r = (i + 1) * 28; });
        g.r = r;
        paint(g);
      },
      dictation: (svg, t) => {
        const bars = [...svg.querySelectorAll("[data-bar]")];
        const heights = [48, 88, 120, 76, 40, 56, 34];
        bars.forEach((b, i) => {
          const target = heights[i % heights.length];
          const h = 22 + (target - 22) * (0.5 + 0.5 * Math.sin(2 * Math.PI * (t * (i % 2 ? 2 : 1) + i * 0.23)));
          b.setAttribute("height", h.toFixed(2));
          b.setAttribute("y", ((120 - h) / 2).toFixed(2));
        });
      },
      pipeline: (svg, t) => {
        const spots = [
          ["l top", 0, 1],
          ["r top", 151, 1],
          ["l bottom", 0, 153],
          ["r bottom", 151, 153],
        ];
        const p = smooth(phase(t, 1.8));
        spots.forEach(([name, tx, ty]) => {
          const g = one(svg, name);
          if (!g) return;
          g.x = lerpN(g.x, tx, p);
          g.y = lerpN(g.y, ty, p);
          paint(g);
        });
      },
      "retro-notes": (svg, t) => {
        const cards = many(svg, '[clip-path] [data-l]').slice(0, 5);
        cards.forEach((g, i) => {
          g.x += Math.sin(t * .9 + i * 1.7) * .35;
          g.y = 48.27 + Math.sin(t * .7 + i) * 8;
          paint(g);
        });
      },
    };
    const active = new Map();
    if (reduced) {
      svgs.forEach((svg) => (timelines[svg.dataset.icon] || pulse)(svg, 0));
      return;
    }
    const tick = (now) => {
      active.forEach((start, svg) => {
        const t = (now - start) / 1000;
        const fn = timelines[svg.dataset.icon] || pulse;
        fn(svg, t);
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          if (!active.has(entry.target)) active.set(entry.target, performance.now());
        } else {
          active.delete(entry.target);
        }
      });
    }, { rootMargin: "50px 0px" });
    svgs.forEach((svg) => io.observe(svg));
  };

  /* ---------- go ---------- */
  initSplits();
  initStack();
  initHighlights();
  initCards();
  initFeatureIcons();
  updateCards();
})();
