// N2 skeletons: per-section motion modules with the manifest's measured
// constants and a reduced-motion guard. They are inert until `--authored`
// wires them; no legacy page script is imported here.

import type { MotionManifest, MotionTrigger, SectionMotion } from "./motion-manifest.js";

export interface SkeletonFile {
  path: string;
  content: string;
}

// SectionNN → "NN" (keeps 3-digit section numbers distinct).
const sectionNN = (section: SectionMotion): string => section.component.slice("Section".length);

// Embedded literals neutralize "<" so captured selectors can never close a
// surrounding HTML script tag.
const jsonLiteral = (value: unknown): string => JSON.stringify(value).replace(/</g, "\\u003c");

const triggerLiteral = (t: MotionTrigger): string =>
  jsonLiteral({
    selector: t.selector,
    start: t.start,
    end: t.end,
    scrub: t.scrub,
    pin: t.pin,
    durationMs: t.durationMs,
    ease: t.ease,
  });

const triggerListOf = (triggers: MotionTrigger[]): string =>
  triggers.length ? `[\n${triggers.map((t) => `  ${triggerLiteral(t)},`).join("\n")}\n]` : "[]";

const triggerList = (section: SectionMotion): string => triggerListOf(section.triggers);

const wired = (manifest: MotionManifest): SectionMotion[] =>
  manifest.sections.filter((s) => s.triggers.length > 0);

const nextGuardHook = (): string => `"use client";

// Shared reduced-motion gate for the per-section hooks. Reduced motion keeps
// the captured static first frame: no tweens, no ScrollTriggers.
export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
`;

const nextSectionHook = (section: SectionMotion): string => {
  const nn = sectionNN(section);
  return `"use client";

import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { prefersReducedMotion } from "./useSectionMotion";

// Measured by analyze_scroll_map (motion.manifest.json); ranges are viewport pixels.
const TRIGGERS = ${triggerList(section)} as const;

export function useSection${nn}Motion(): void {
  useEffect(() => {
    if (prefersReducedMotion()) return; // prefers-reduced-motion: static first frame
    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      // TODO: author steps — one timeline per TRIGGERS entry (selector + range).
      void TRIGGERS;
      ScrollTrigger.refresh();
    });
    return () => ctx.revert();
  }, []);
}
`;
};

const nextPageHook = (manifest: MotionManifest): string => {
  if (manifest.pageTriggers.length === 0) {
    return `"use client";

import { useEffect } from "react";
import { prefersReducedMotion } from "./useSectionMotion";

// Page-level motion skeleton — no measured page triggers; author from motion.manifest.json hints.
export function usePageMotion(): void {
  useEffect(() => {
    if (prefersReducedMotion()) return; // prefers-reduced-motion: static first frame
    // TODO: author steps — page-level timeline for motion.manifest.json pageTriggers.
  }, []);
}
`;
  }
  return `"use client";

import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { prefersReducedMotion } from "./useSectionMotion";

// Page-level census triggers no section owned (page scrubs); ranges are viewport pixels.
const PAGE_TRIGGERS = ${triggerListOf(manifest.pageTriggers)} as const;
const PAGE_SELECTORS = ${jsonLiteral(manifest.pageAnimatedSelectors)} as const;

export function usePageMotion(): void {
  useEffect(() => {
    if (prefersReducedMotion()) return; // prefers-reduced-motion: static first frame
    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      // TODO: author steps — one page-level timeline per PAGE_TRIGGERS entry.
      void PAGE_TRIGGERS;
      void PAGE_SELECTORS;
      ScrollTrigger.refresh();
    });
    return () => ctx.revert();
  }, []);
}
`;
};

const nextMotionRoot = (sections: SectionMotion[]): string => {
  const imports = sections
    .map((s) => `import { useSection${sectionNN(s)}Motion } from "../hooks/useSection${sectionNN(s)}Motion";`)
    .join("\n");
  const calls = ["  usePageMotion();", ...sections.map((s) => `  useSection${sectionNN(s)}Motion();`)].join("\n");
  return `"use client";

import { usePageMotion } from "../hooks/usePageMotion";
${imports}

// Page motion mounts before the measured section hooks; each hook owns one
// gsap.context and reverts it on unmount.
export default function MotionRoot() {
${calls}
  return null;
}
`;
};

export function nextMotionSkeletons(manifest: MotionManifest): SkeletonFile[] {
  const files: SkeletonFile[] = [
    { path: "hooks/useSectionMotion.ts", content: nextGuardHook() },
    { path: "hooks/usePageMotion.ts", content: nextPageHook(manifest) },
  ];
  for (const section of manifest.sections) {
    if (section.triggers.length === 0) continue;
    const nn = sectionNN(section);
    files.push({ path: `hooks/useSection${nn}Motion.ts`, content: nextSectionHook(section) });
  }
  const sections = wired(manifest);
  if (sections.length > 0 || manifest.pageTriggers.length > 0) {
    files.push({ path: "components/MotionRoot.tsx", content: nextMotionRoot(sections) });
  }
  return files;
}

const webSectionModule = (section: SectionMotion): string => {
  if (section.triggers.length === 0) {
    return `// ${section.component} motion skeleton — no measured triggers; author from motion.manifest.json hints.
const TRIGGERS = [];

export function init${section.component}() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return () => {};
  // TODO: author steps for this section (see motion.manifest.json).
  void TRIGGERS;
  return () => {};
}
`;
  }
  return `// ${section.component} motion skeleton — measured by analyze_scroll_map; inert until authored.
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

const TRIGGERS = ${triggerList(section)};

export function init${section.component}() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return () => {};
  gsap.registerPlugin(ScrollTrigger);
  const ctx = gsap.context(() => {
    // TODO: author steps — one timeline per TRIGGERS entry (selector + range).
    for (const trigger of TRIGGERS) void trigger;
    ScrollTrigger.refresh();
  });
  return () => ctx.revert();
}
`;
};

const webPageModule = (manifest: MotionManifest): string => {
  if (manifest.pageTriggers.length === 0) {
    return `// Page motion skeleton — no measured page triggers; author from motion.manifest.json hints.
const PAGE_TRIGGERS = [];

export function initPageMotion() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return () => {};
  // TODO: author steps for page-level motion (see motion.manifest.json pageTriggers).
  void PAGE_TRIGGERS;
  return () => {};
}
`;
  }
  return `// Page motion skeleton — census triggers with no section owner (page scrubs); inert until authored.
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

const PAGE_TRIGGERS = ${triggerListOf(manifest.pageTriggers)};
const PAGE_SELECTORS = ${jsonLiteral(manifest.pageAnimatedSelectors)};

export function initPageMotion() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return () => {};
  gsap.registerPlugin(ScrollTrigger);
  const ctx = gsap.context(() => {
    // TODO: author steps — one page-level timeline per PAGE_TRIGGERS entry.
    for (const trigger of PAGE_TRIGGERS) void trigger;
    void PAGE_SELECTORS;
    ScrollTrigger.refresh();
  });
  return () => ctx.revert();
}
`;
};

const webRegistry = (sections: SectionMotion[]): string => {
  const imports = sections
    .map((s) => `import { init${s.component} } from "./section${sectionNN(s)}.js";`)
    .join("\n");
  const inits = sections.map((s) => `init${s.component}`).join(", ");
  return `// Ordered registry: page motion first, then sections in document order; each returns a cleanup.
import { initPageMotion } from "./page.js";
${imports}

const SECTIONS = [initPageMotion${inits ? `, ${inits}` : ""}];

export function initAnimations() {
  const cleanups = SECTIONS.map((init) => init());
  return () => cleanups.forEach((cleanup) => cleanup());
}
`;
};

export function webMotionSkeletons(manifest: MotionManifest): SkeletonFile[] {
  const files: SkeletonFile[] = [
    { path: "src/animations/page.js", content: webPageModule(manifest) },
    ...manifest.sections.map((section) => ({
      path: `src/animations/section${sectionNN(section)}.js`,
      content: webSectionModule(section),
    })),
  ];
  files.push({ path: "src/animations/registry.js", content: webRegistry(manifest.sections) });
  return files;
}

export const motionHasTriggers = (manifest: MotionManifest): boolean =>
  manifest.pageTriggers.length > 0 || manifest.sections.some((s) => s.triggers.length > 0);
