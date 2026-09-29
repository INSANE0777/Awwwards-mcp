export interface SiteSummary {
  id: number;
  slug: string;
  title: string;
  createdAt: number; // unix seconds
  tags: string[];
  thumbnailPath: string; // e.g. "submissions/2026/08/xxx.jpg"
  liveUrl: string | null;
  detailPath: string; // e.g. "/sites/l-i-s-a"
  awards: string[]; // e.g. ["Site of the Day", "Developer Award"]
}

export interface SiteDetails {
  slug: string;
  title: string | null;
  description: string | null; // curated ">Description</h2>" section; og:description meta as fallback
  palette: string[]; // hex codes, uppercase, e.g. "#000000"
  technologies: string[];
  elements: string[];
  awards: { title: string; date: string }[];
  // true on Nominee submissions. awwwards.com publishes no jury score, color
  // palette, technologies or description section for a nominee, so an empty
  // design parse there is real content, not parser drift.
  nominee: boolean;
  score: number | null; // displayed overall jury score, null when absent
  // Per-dimension jury scores from the layout-overall chartbar block
  // (Design / Usability / Creativity / Content). Undefined when the page has
  // no jury chartbar or the dimension labels drifted from the known four.
  juryDimensions?: {
    design: number;
    usability: number;
    creativity: number;
    content: number;
  };
  ogImage: string | null;
  liveUrl: string | null;
}

export interface Categories {
  colors: string[]; // hex codes, uppercase
  filters: string[]; // tag/technology slugs, e.g. "3d", "webgl"
}

export interface ElementMedia {
  title: string;
  mediaPath: string; // e.g. "element/2026/08/<hash>.mp4" or ".jpg"
}

export interface GalleryItem {
  slug: string; // e.g. "about-page-realevate"
  title: string | null; // e.g. "About Page"
  author: string | null; // "from X" attribution, e.g. "Realevate"
  builtWith: string[]; // "This element was built with" tag list
  related: string[]; // related-element permalink slugs on the page
  mediaPath: string | null; // assets.awwwards.com path (reuse elementUrl for full URL)
  mediaType: "video" | "image" | null; // .mp4 → video, .jpg → image
  category: string | null; // e.g. "micro-interactions"; null when page has no /elements/<cat>/ breadcrumb
  siteSlug: string | null; // Task 5: attribution /sites/<slug> href — pairing key to the sites table
}

// Motion DNA result (Task 7): reduced view of a runtime page scan for the
// gallery/motion tooling. Aggregated by reduceScan from a MotionScan
// (src/motion-dna.ts) captured with MOTION_SNIPPET via page.evaluate.
export interface MotionDna {
  url: string;
  stack: {
    libs: string[];
    render: string[];
    scrollModel: "lenis" | "locomotive" | "native" | "unknown";
  };
  scroll: {
    triggerCount: number;
    scrubCount: number;
    pinCount: number;
    scrubRatio: number; // scrubCount / triggerCount; 0 when no triggers
    sample: {
      start: string | null;
      end: string | null;
      scrub: boolean;
      pin: boolean;
      duration: number | null; // seconds (gsap convention)
      ease: string | null;
    }[];
  };
  easingVocab: { token: string; bezier: number[] | null; uses: number }[];
  durationVocab: { p25: number; median: number; p75: number } | null; // milliseconds
  capturedAt: number; // Date.now() at capture
}

// Stored version of a gallery item (Cache / elements table). GalleryItem is
// what the parsers emit; cacheUpdaters add cid/source/fetchedAt.
export interface ElementRecord {
  slug: string;
  title: string;
  cid: string; // normalized category id (Task 5 fills the taxonomy; raw title until then)
  category: string;
  author: string;
  builtWith: string[];
  related: string[];
  mediaPath: string;
  mediaType: "video" | "image" | null;
  /** Tier A source="gallery" | Tier B source="site" (from a site detail's Elements section) */
  source: "gallery" | "site";
  projectId: string | null;
  // Task 5 pairing: owning site, resolved at index time from the attribution
  // href, else at read time by author → sites.title match. "realevate".
  siteSlug: string | null;
  fetchedAt: number;
}
