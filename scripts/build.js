#!/usr/bin/env node
/* =====================================================================
   간다GO · 서울 지역 안내 — 정적 사이트 빌드 스크립트
   data/*.json → dist/*.html + sitemap.xml + robots.txt
   ===================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data", "seoul");
const DIST = path.join(ROOT, "dist");
const SRC_CSS = path.join(ROOT, "src", "styles", "main.css");

const readJSON = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));
const site = readJSON("site.json");
const areas = readJSON("areas.json");
const districts = readJSON("districts.json");
const content = readJSON("content.json");
const useCases = readJSON("use-cases.json");
const checks = readJSON("checks.json");
const policies = readJSON("policies.json");
const lifeAreas = readJSON("life-areas.json");
const adminDongs = readJSON("admin-dongs.json");
const stations = readJSON("stations.json");
const stationByName = Object.fromEntries(stations.map((s) => [s.name, s]));

const districtBySlug = Object.fromEntries(districts.map((d) => [d.slug, d]));
const areaBySlug = Object.fromEntries(areas.map((a) => [a.slug, a]));
const useBySlug = Object.fromEntries(useCases.map((u) => [u.slug, u]));
const lifeBySlug = Object.fromEntries(lifeAreas.map((l) => [l.slug, l]));
const dongsByDistrict = {};
adminDongs.forEach((d) => {
  (dongsByDistrict[d.district] = dongsByDistrict[d.district] || []).push(d);
});
const dongsByLife = {};
adminDongs.forEach((d) => {
  if (d.lifeArea) (dongsByLife[d.lifeArea] = dongsByLife[d.lifeArea] || []).push(d);
});
const dongBySlug = Object.fromEntries(adminDongs.map((d) => [`${d.district}/${d.slug}`, d]));
const lifeByArea = {};
lifeAreas.forEach((l) => {
  (lifeByArea[l.area] = lifeByArea[l.area] || []).push(l);
});
const lifeByDistrict = {};
lifeAreas.forEach((l) => {
  (l.districts || []).forEach((d) => {
    (lifeByDistrict[d] = lifeByDistrict[d] || []).push(l);
  });
});

/* 도어웨이 방지: 본문이 얇으면 자동 noindex */
const MIN_INDEX_CHARS = 500;
const noindexLog = [];
function textLen(html) {
  return [...html.replace(/<[^>]+>/g, "").replace(/\s+/g, "")].length;
}

// 고유성·중복 검증용 유틸
const allTitles = [];
const allDescs = [];
function findDup(arr) {
  const seen = new Set(), dup = new Set();
  arr.forEach((x) => (seen.has(x) ? dup.add(x) : seen.add(x)));
  return [...dup];
}
function shingles(html, k = 5) {
  const words = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().split(" ");
  const s = new Set();
  for (let i = 0; i + k <= words.length; i++) s.add(words.slice(i, i + k).join(" "));
  return s;
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */
const esc = (s = "") =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const warnings = [];
function clamp80(desc, where) {
  const d = desc.trim();
  if ([...d].length > 80) {
    warnings.push(`⚠ description > 80자 (${[...d].length}): ${where} — "${d}"`);
    return [...d].slice(0, 79).join("").trim() + "…";
  }
  return d;
}

const abs = (p) => site.siteUrl.replace(/\/$/, "") + p;

function jsonld(obj) {
  return `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
}

const orgSchema = {
  "@type": "Organization",
  name: site.brand,
  url: site.siteUrl,
  telephone: site.phone,
  logo: abs(site.defaultOgImage),
  sameAs: [site.telegram.url],
  foundingDate: site.foundedYear,
  contactPoint: {
    "@type": "ContactPoint",
    telephone: site.phone,
    contactType: "reservations",
    areaServed: "KR",
    availableLanguage: ["ko"],
  },
};

function breadcrumbSchema(trail) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: trail.map((t, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: t.name,
      item: abs(t.path),
    })),
  };
}

function faqSchema(faq) {
  return {
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

function webPageSchema({ title, desc, url, image }) {
  return {
    "@type": "WebPage",
    name: title,
    description: desc,
    url: abs(url),
    inLanguage: "ko-KR",
    isPartOf: { "@type": "WebSite", name: site.brand, url: site.siteUrl },
    primaryImageOfPage: image
      ? { "@type": "ImageObject", url: abs(image), caption: title }
      : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* shared partials                                                    */
/* ------------------------------------------------------------------ */
const NAV = [
  { label: "서울 홈", path: "/" },
  { label: "생활권", path: "/#areas" },
  { label: "구별 안내", path: "/#districts" },
  { label: "지하철역", path: "/#stations" },
  { label: "이용 장소", path: "/use/home/" },
  { label: "예약 전 확인", path: "/check/address/" },
];

function header() {
  return `<header class="site-header"><div class="container site-header__inner">
    <a class="brand" href="/"><span class="brand__mark">${esc(site.brand)}</span><span class="brand__tag">서울 지역 안내</span></a>
    <nav class="site-nav" aria-label="주요 메뉴">
      ${NAV.map((n) => `<a href="${n.path}">${esc(n.label)}</a>`).join("")}
    </nav>
    <a class="header-phone" href="tel:${site.phone.replace(/-/g, "")}"><span>${esc(site.phoneLabel)}</span>${esc(site.phone)}</a>
  </div></header>`;
}

const TELEGRAM_ICON =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9.78 15.6 9.6 19.2c.36 0 .52-.16.71-.35l1.7-1.63 3.53 2.58c.65.36 1.11.17 1.28-.6l2.32-10.9c.21-.96-.35-1.34-.98-1.1L4.4 10.5c-.94.36-.92.88-.16 1.11l3.5 1.09 8.14-5.13c.38-.25.73-.11.44.15L9.78 15.6Z"/></svg>';

const PHONE_ICON =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.5.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.5.1.4 0 .8-.3 1L6.6 10.8Z"/></svg>';

const FAVICON = `<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="alternate" type="application/rss+xml" title="${esc(site.brand)} 최신 안내" href="/rss.xml">`;

const SITE_VERIFY = [
  site.naverVerification ? `<meta name="naver-site-verification" content="${esc(site.naverVerification)}">` : "",
  site.googleVerification ? `<meta name="google-site-verification" content="${esc(site.googleVerification)}">` : "",
]
  .filter(Boolean)
  .join("\n");

// 모바일 플로팅 전화 버튼(전 페이지, 항상 노출) — 탭 시 전화연결
function floatingCall() {
  return `<a class="fab-call" href="tel:${site.phone.replace(/-/g, "")}" aria-label="전화 예약 ${esc(site.phone)}">${PHONE_ICON}<span class="fab-call__label">전화예약</span></a>`;
}

// 히어로 우측 이미지(설정 시 전 페이지 공통 노출)
function heroMedia(eager) {
  if (!site.heroImage) return "";
  return `<div class="hero__media"><img src="${site.heroImage}" alt="${esc(site.heroImageAlt || site.brand)}" width="640" height="480" ${eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"'} decoding="async"></div>`;
}

// 히어로 래퍼: 좌측 내용 + 우측 이미지(2단)
function hero(innerHtml, eager) {
  return `<section class="hero hero--split"><div class="container hero__grid"><div class="hero__inner">${innerHtml}</div>${heroMedia(eager)}</div></section>`;
}

function inquiryButtons() {
  return site.inquiries
    .map(
      (i) =>
        `<a class="btn btn--inquiry" href="${site.telegram.url}" target="_blank" rel="noopener" data-inquiry="${i.key}">${TELEGRAM_ICON}${esc(i.label)}</a>`
    )
    .join("");
}

function footer() {
  const guLinks = districts
    .slice(0, 8)
    .map((d) => `<li><a href="/${d.slug}/">${esc(d.name)} 생활권 안내</a></li>`)
    .join("");
  const areaLinks = areas
    .map((a) => `<li><a href="/area/${a.slug}/">${esc(a.name)} 안내</a></li>`)
    .join("");
  const useLinks = useCases
    .map((u) => `<li><a href="/use/${u.slug}/">${esc(u.name)}</a></li>`)
    .join("");
  const policyLinks = [
    ...checks.map((c) => `<li><a href="/check/${c.slug}/">${esc(c.name)}</a></li>`),
    ...policies.map((p) => `<li><a href="/policy/${p.slug}/">${esc(p.name)}</a></li>`),
  ].join("");
  const stationLinks = stations
    .slice(0, 8)
    .map((s) => `<li><a href="/station/${s.slug}/">${esc(s.name)}</a></li>`)
    .join("");
  return `<footer class="site-footer"><div class="container">
    <div class="footer-cta">
      <div class="footer-cta__text">
        <h2>웹사이트 제작 · 제휴가 필요하신가요?</h2>
        <p>텔레그램으로 편하게 문의해 주세요. ${esc(site.telegram.handle)}</p>
      </div>
      <div class="footer-cta__buttons">${inquiryButtons()}</div>
    </div>
    <div class="footer-grid">
      <div class="footer-brand">
        <div class="footer-brand__name"><span class="brand__mark">${esc(site.brand)}</span></div>
        <dl class="footer-info">
          <dt>상호</dt><dd>${esc(site.brand)}</dd>
          <dt>${esc(site.phoneLabel)}</dt><dd><a href="tel:${site.phone.replace(/-/g, "")}">${esc(site.phone)}</a></dd>
          <dt>문의</dt><dd><a href="${site.telegram.url}" target="_blank" rel="noopener">텔레그램 ${esc(site.telegram.handle)}</a></dd>
        </dl>
      </div>
      <div class="footer-col"><h3>5대 생활권</h3><ul>${areaLinks}</ul></div>
      <div class="footer-col"><h3>구별 안내</h3><ul>${guLinks}<li><a href="/#districts">전체 25개 구 보기</a></li></ul></div>
      <div class="footer-col"><h3>지하철역</h3><ul>${stationLinks}<li><a href="/#stations">주요 역 전체 보기</a></li></ul></div>
      <div class="footer-col"><h3>이용 장소</h3><ul>${useLinks}</ul></div>
      <div class="footer-col"><h3>예약 전 확인 · 운영 기준</h3><ul>${policyLinks}</ul></div>
    </div>
    <div class="footer-legal">
      <span>© ${site.foundedYear}– ${esc(site.brand)}. 불법·선정적 서비스는 제공·안내하지 않습니다.</span>
      <span>본 사이트는 방문 이용 기준과 지역 정보를 안내합니다.</span>
    </div>
  </div></footer>`;
}

function whoHowWhy(subject) {
  return `<div class="whw">
    <div><h3>Who · 누가</h3><p>${esc(site.editorial.author)}이 작성하고 ${esc(site.editorial.reviewer)}이 검수합니다.</p></div>
    <div><h3>How · 어떻게</h3><p>${esc(subject)}의 생활권·역세권·이용 장소 기준을 실제 방문 관점에서 정리했습니다.</p></div>
    <div><h3>Why · 왜</h3><p>서울은 같은 구 안에서도 생활권이 달라, 예약 전 확인 기준을 명확히 안내하기 위해 만들었습니다.</p></div>
  </div>`;
}

function faqBlock() {
  return `<div class="faq">${content.faq
    .map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`)
    .join("")}</div>`;
}

function checklistBlock() {
  return `<ul class="checklist">${content.checklist.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>`;
}

// 역명 목록 → 역 전용 페이지 링크(있을 때) 또는 태그
function stationTags(names) {
  return names
    .map((n) =>
      stationByName[n]
        ? `<a href="/station/${stationByName[n].slug}/">${esc(n)}</a>`
        : `<span class="tag">${esc(n)}</span>`
    )
    .join("");
}

// 롱테일 내부링크: 지역명 + 주제로 이용/확인 허브에 연결(유형별로 다르게)
const LONGTAIL = {
  business: [["/use/business-district/", "업무지구 방문 이용 기준"], ["/use/officetel/", "오피스텔 방문 확인사항"]],
  downtown: [["/use/business-district/", "도심 업무지구 이용 기준"], ["/use/hotel/", "호텔·숙소 이용 기준"]],
  industrial: [["/use/business-district/", "업무지구 방문 이용 기준"], ["/check/building-access/", "건물 출입 방식 확인"]],
  lodging: [["/use/hotel/", "호텔·숙소 이용 기준"], ["/check/building-access/", "건물 출입 방식 확인"]],
  nightlife: [["/use/hotel/", "호텔·숙소 이용 기준"], ["/use/night/", "야간 예약 이용 안내"]],
  university: [["/use/officetel/", "오피스텔 방문 확인사항"], ["/check/building-access/", "건물 출입 방식 확인"]],
  residential: [["/use/officetel/", "오피스텔 방문 확인사항"], ["/check/time/", "예약 가능 시간 확인"]],
  transit: [["/use/station-area/", "역세권 방문 이용 안내"], ["/check/travel-fee/", "추가 이동비 기준 확인"]],
  commercial: [["/use/station-area/", "역세권 방문 이용 안내"], ["/check/building-access/", "건물 출입 방식 확인"]],
  culture: [["/use/station-area/", "역세권 방문 이용 안내"], ["/use/night/", "야간 예약 이용 안내"]],
};
function longtailLinks(name, type) {
  const items = [
    ["/use/home/", "자택 방문 이용 안내"],
    ...(LONGTAIL[type] || LONGTAIL.residential),
    ["/check/address/", "예약 전 방문 주소 확인"],
  ];
  return `<nav class="linklist" style="margin-top:1rem" aria-label="함께 보면 좋은 안내">${items
    .map(([u, t]) => `<a href="${u}">${esc(name)} ${esc(t)}</a>`)
    .join("")}</nav>`;
}
function guType(d) {
  const f = d.focus || "";
  if (/업무|산업/.test(f)) return "business";
  if (/숙소|관광|외국인/.test(f)) return "lodging";
  if (/대학/.test(f)) return "university";
  if (/상권/.test(f)) return "commercial";
  return "residential";
}

const won = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function stars(n) {
  return `<span class="stars" aria-label="별점 ${n}점 만점에 5점">${"★".repeat(n)}<span class="stars__off">${"★".repeat(5 - n)}</span></span>`;
}

// 후기/평점 구조화 데이터 — 후기가 실제로 노출되는 메인 페이지에만 부착
function reviewSchema() {
  const rv = content.reviews || [];
  if (!rv.length) return null;
  const avg = (rv.reduce((s, r) => s + r.rating, 0) / rv.length).toFixed(1);
  return {
    "@type": "Service",
    name: `${site.brand} 서울 방문 케어`,
    serviceType: "방문 케어",
    provider: { "@type": "Organization", name: site.brand, url: site.siteUrl },
    areaServed: { "@type": "City", name: "서울" },
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: avg,
      reviewCount: rv.length,
      bestRating: "5",
      worstRating: "1",
    },
    review: rv.map((r) => ({
      "@type": "Review",
      author: { "@type": "Person", name: r.name },
      datePublished: r.date,
      reviewRating: { "@type": "Rating", ratingValue: String(r.rating), bestRating: "5", worstRating: "1" },
      reviewBody: r.text,
    })),
  };
}

function reviewsSection() {
  const rv = content.reviews || [];
  if (!rv.length) return "";
  const avg = (rv.reduce((s, r) => s + r.rating, 0) / rv.length).toFixed(1);
  const cards = rv
    .map(
      (r) => `<figure class="review">
        <div class="review__head">${stars(r.rating)}<span class="review__date">${esc(r.date)}</span></div>
        <blockquote class="review__text">${esc(r.text)}</blockquote>
        <figcaption class="review__by">${esc(r.name)} 고객님</figcaption>
      </figure>`
    )
    .join("");
  return `<section class="section" id="reviews"><div class="container">
    <span class="eyebrow">이용 후기</span>
    <h2>고객님들이 남겨주신 이용 후기</h2>
    <p class="lead" style="margin-top:.5rem">고객이 직접 남긴 후기를 가감 없이 보여 드립니다. 평균 별점 ${avg} / 5 · 후기 ${rv.length}건</p>
    <div class="review-grid" style="margin-top:1.75rem">${cards}</div>
  </div></section>`;
}

function pricingSection() {
  const { title, subtitle, note, courses } = content.pricing;
  const cards = courses
    .map((c) => {
      const featured = c.featured ? " price-card--featured" : "";
      const badge = c.badge ? `<span class="price-card__badge">${esc(c.badge)}</span>` : "";
      const btn = c.featured ? "btn--inquiry" : "btn--ghost";
      return `<div class="price-card${featured}">
        ${badge}
        <h3 class="price-card__name">${esc(c.name)}</h3>
        <p class="price-card__price"><strong>${won(c.price)}</strong><span>원</span></p>
        <p class="price-card__dur">${esc(c.duration)}</p>
        <p class="price-card__desc">${esc(c.desc)}</p>
        <a class="btn ${btn} price-card__btn" href="${site.telegram.url}" target="_blank" rel="noopener">예약 문의</a>
      </div>`;
    })
    .join("");
  return `<section class="section pricing" id="pricing" aria-label="이용 코스와 요금"><div class="container">
    <div class="pricing__head">
      <h2>${esc(title)}</h2>
      <p>${esc(subtitle)}</p>
    </div>
    <div class="price-grid">${cards}</div>
    <p class="pricing__note">${esc(note)} <a href="${site.telegram.url}" target="_blank" rel="noopener">상세 요금 안내 보기 →</a></p>
  </div></section>`;
}

function pricingSchema() {
  return {
    "@type": "Service",
    name: `${site.brand} 방문 케어 코스`,
    serviceType: "방문 케어",
    provider: { "@type": "Organization", name: site.brand, url: site.siteUrl },
    areaServed: { "@type": "City", name: "서울" },
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "이용 코스와 요금",
      itemListElement: content.pricing.courses.map((c) => ({
        "@type": "Offer",
        name: c.name,
        price: c.price,
        priceCurrency: "KRW",
        description: c.desc,
        availability: "https://schema.org/InStock",
      })),
    },
  };
}

/* ------------------------------------------------------------------ */
/* layout                                                             */
/* ------------------------------------------------------------------ */
function layout({ title, desc, url, image, breadcrumb, extraSchema = [], body, includeFaqSchema, forceIndex }) {
  // 도어웨이 방지: 본문이 얇으면 색인 제외
  const thin = textLen(body) < MIN_INDEX_CHARS;
  const noindex = thin && !forceIndex;
  if (noindex) noindexLog.push(`${url} (본문 ${textLen(body)}자)`);
  allTitles.push(title);
  allDescs.push(desc);

  const graph = [orgSchema, webPageSchema({ title, desc, url, image }), pricingSchema()];
  if (breadcrumb) graph.push(breadcrumbSchema(breadcrumb));
  if (includeFaqSchema) graph.push(faqSchema(content.faq));
  graph.push(...extraSchema);
  const ld = jsonld({ "@context": "https://schema.org", "@graph": graph });
  const ogImg = abs(image || site.defaultOgImage);
  layout._noindex = noindex;
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0a0d14">
<meta name="color-scheme" content="dark">
${SITE_VERIFY}
${FAVICON}
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${abs(url)}">
<meta name="robots" content="${noindex ? "noindex, follow" : "index, follow"}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(site.brand)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${abs(url)}">
<meta property="og:image" content="${ogImg}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${ogImg}">
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="stylesheet" href="/assets/main.css">
${ld}
</head>
<body>
<a class="skip-link" href="#main">본문 바로가기</a>
${header()}
<main id="main">
${body}
${pricingSection()}
</main>
${footer()}
${floatingCall()}
</body>
</html>`;
}

function breadcrumbNav(trail) {
  return `<nav class="breadcrumb" aria-label="이동 경로"><div class="container"><ol>${trail
    .map((t, i) =>
      i === trail.length - 1
        ? `<li aria-current="page">${esc(t.name)}</li>`
        : `<li><a href="${t.path}">${esc(t.name)}</a></li>`
    )
    .join("")}</ol></div></nav>`;
}

/* ------------------------------------------------------------------ */
/* page: main /                                                 */
/* ------------------------------------------------------------------ */
function mainPage() {
  const url = "/";
  const title = "서울 출장마사지｜강남·잠실·홍대·여의도·성수 생활권 지역 안내";
  const desc = clamp80(
    "서울 5대 생활권과 25개 구, 자택·호텔·오피스텔 방문 이용 기준을 안내합니다.",
    "main"
  );

  const areaCards = areas
    .map(
      (a) => `<a class="card" href="/area/${a.slug}/">
        <span class="card__title">${esc(a.name)}</span>
        <p class="card__meta">${esc(a.summary)}</p>
        <span class="card__tags">${a.lifeAreas.slice(0, 3).map((l) => `<span class="tag">${esc(l)}</span>`).join("")}</span>
      </a>`
    )
    .join("");

  const guCards = districts
    .map(
      (d) => `<a class="card" href="/${d.slug}/">
        <span class="card__title">${esc(d.name)}</span>
        <p class="card__meta">${esc(d.lifeAreas.slice(0, 3).join(" · "))}</p>
        <span class="card__tags">${d.stations.slice(0, 2).map((s) => `<span class="tag">${esc(s)}</span>`).join("")}</span>
      </a>`
    )
    .join("");

  const useCards = content.useCases
    .map(
      (u) => `<div class="card"><span class="card__title">${esc(u.label)}</span><p class="card__meta">${esc(u.desc)}</p></div>`
    )
    .join("");

  const body = `
${breadcrumbNav([{ name: "서울", path: "/" }])}
<section class="hero hero--split"><div class="container hero__grid">
  <div class="hero__inner">
    <span class="eyebrow">서울 지역 안내</span>
    <h1>서울 출장마사지 · 생활권별 방문 가능 지역 안내</h1>
    <p>강남, 잠실, 홍대, 여의도, 성수, 용산, 목동, 마곡 등 서울 주요 생활권과 자택·호텔·오피스텔 이용 전 확인사항을 안내합니다.</p>
    <div class="hero__cta">
      <a class="btn btn--primary btn--lg" href="#areas">생활권 보기</a>
      <a class="btn btn--ghost btn--lg" href="#districts">구별 안내</a>
      <a class="btn btn--ghost btn--lg" href="#checklist">예약 전 확인</a>
    </div>
  </div>
  ${
    site.heroImage
      ? `<div class="hero__media"><img src="${site.heroImage}" alt="${esc(site.heroImageAlt || site.brand)}" width="640" height="480" loading="eager" decoding="async"></div>`
      : ""
  }
</div></section>

<section class="section"><div class="container prose">
  <h2>서울은 구 이름만으로 판단하기 어렵습니다</h2>
  <p>서울은 25개 구가 촘촘하게 연결된 도시입니다. 같은 구 안에서도 업무지구, 주거지, 숙소 인접권, 대학가, 환승역 생활권이 다르게 나뉩니다. 강남구는 강남역·역삼, 삼성·선릉처럼 업무지구와 오피스텔 비중이 높고, 마포구는 홍대·합정, 공덕·마포, 상암처럼 숙소·상권·업무지구가 나뉩니다. 이 사이트는 서울을 구, 생활권, 지하철역, 이용 장소 기준으로 함께 안내합니다.</p>
</div></section>

<section class="section alt" id="areas"><div class="container">
  <span class="eyebrow">5대 생활권</span>
  <h2>서울 생활권별로 빠르게 찾기</h2>
  <div class="grid grid--3" style="margin-top:1.5rem">${areaCards}</div>
</div></section>

<section class="section" id="districts"><div class="container">
  <span class="eyebrow">25개 구</span>
  <h2>서울 구별 지역 안내</h2>
  <div class="grid grid--4" style="margin-top:1.5rem">${guCards}</div>
</div></section>

<section class="section alt" id="stations"><div class="container">
  <span class="eyebrow">지하철역</span>
  <h2>주요 지하철역 역세권 안내</h2>
  <p class="lead" style="margin-top:.5rem">환승역은 역명 기준 한 페이지로 안내합니다. 가까운 역을 눌러 역세권 이용 기준을 확인하세요.</p>
  <nav class="linklist" style="margin-top:1.5rem" aria-label="주요 지하철역">${stations
    .map((s) => `<a href="/station/${s.slug}/">${esc(s.name)}</a>`)
    .join("")}</nav>
</div></section>

<section class="section" id="usecases"><div class="container">
  <span class="eyebrow">이용 장소</span>
  <h2>이용 장소에 따라 확인할 내용이 다릅니다</h2>
  <div class="grid grid--3" style="margin-top:1.5rem">${useCards}</div>
</div></section>

<section class="section alt" id="guides"><div class="container">
  <span class="eyebrow">자주 찾는 안내</span>
  <h2>상황별 방문 안내 바로가기</h2>
  <nav class="linklist" style="margin-top:1.5rem" aria-label="상황별 안내">
    <a href="/station/gangnam-station/">강남역 역세권 방문 이용 안내</a>
    <a href="/station/hongik-univ-station/">홍대입구역 숙소 인접 역세권 안내</a>
    <a href="/life/yeouido-yeongdeungpo/">여의도 업무지구 오피스텔 방문 안내</a>
    <a href="/life/jamsil-songpa/">잠실 대단지 방문 확인사항</a>
    <a href="/life/seongsu-wangsimni/">성수 상권 방문 이용 안내</a>
    <a href="/use/hotel/">호텔·숙소 출장마사지 이용 기준</a>
    <a href="/use/officetel/">오피스텔 방문 확인사항</a>
    <a href="/use/night/">야간 예약 이용 안내</a>
    <a href="/check/address/">예약 전 방문 주소 확인</a>
    <a href="/check/building-access/">건물 출입 방식 확인</a>
  </nav>
</div></section>

${reviewsSection()}

<section class="section" id="checklist"><div class="container">
  <span class="eyebrow">예약 전 확인</span>
  <h2>예약 전 확인해야 할 내용</h2>
  <div style="margin-top:1.5rem;max-width:720px">${checklistBlock()}</div>
  <div class="notice" style="margin-top:1.5rem">불법·선정적 서비스는 제공하거나 안내하지 않으며, 실제 방문 주소와 건물 출입 방식을 함께 확인합니다.</div>
</div></section>

<section class="section alt"><div class="container">
  <span class="eyebrow">자주 묻는 질문</span>
  <h2>자주 묻는 질문</h2>
  <div style="margin-top:1.5rem;max-width:760px">${faqBlock()}</div>
</div></section>

<section class="section"><div class="container">
  <h2>서울 지역 안내 기준</h2>
  <div style="margin-top:1.5rem">${whoHowWhy("서울 전 지역")}</div>
</div></section>
`;

  return layout({
    title,
    desc,
    url,
    breadcrumb: [{ name: "서울", path: "/" }],
    body,
    includeFaqSchema: true,
    extraSchema: [reviewSchema()].filter(Boolean),
  });
}

/* ------------------------------------------------------------------ */
/* page: area /area/<slug>/                                     */
/* ------------------------------------------------------------------ */
function areaPage(a) {
  const url = `/area/${a.slug}/`;
  const title = `${a.name} 출장마사지 · 포함 구와 생활권 안내 | ${site.brand}`;
  const desc = clamp80(`${a.name} 안내 · 포함 구와 대표 생활권, 방문 이용 기준을 정리했습니다.`, url);
  const trail = [
    { name: "서울", path: "/" },
    { name: a.name, path: url },
  ];

  const guCards = a.districts
    .map((slug) => {
      const d = districtBySlug[slug];
      return `<a class="card" href="/${d.slug}/"><span class="card__title">${esc(d.name)}</span><p class="card__meta">${esc(d.lifeAreas.slice(0, 3).join(" · "))}</p></a>`;
    })
    .join("");

  const otherAreas = areas
    .filter((x) => x.slug !== a.slug)
    .map((x) => `<a href="/area/${x.slug}/">${esc(x.name)} 생활권 안내</a>`)
    .join("");

  const body = `
${breadcrumbNav(trail)}
${hero(`
  <span class="eyebrow">서울 5대 생활권</span>
  <h1>${esc(a.name)} 생활권 안내</h1>
  <p>${esc(a.summary)}</p>
`)}

<section class="section"><div class="container prose">
  <h2>${esc(a.name)} 개요</h2>
  <p>${esc(a.intro)}</p>

  <h2>포함 구</h2>
  <div class="grid grid--3" style="margin:1.25rem 0 0">${guCards}</div>

  <h2>대표 생활권 상세 안내</h2>
  <div class="grid grid--3" style="margin-top:1rem">${(lifeByArea[a.slug] || [])
    .map(
      (l) =>
        `<a class="card" href="/life/${l.slug}/"><span class="card__title">${esc(l.name)}</span><p class="card__meta">${esc(l.character.split(".")[0])}.</p></a>`
    )
    .join("")}</div>

  <h2>대표 지하철역</h2>
  <ul class="linklist" style="margin-top:1rem">${stationTags(a.stations)}</ul>

  <h2>이용 장소별 안내</h2>
  <div class="grid grid--3" style="margin-top:1rem">${useCases
    .slice(0, 6)
    .map((u) => `<a class="card" href="/use/${u.slug}/"><span class="card__title">${esc(u.name)}</span><p class="card__meta">${esc(u.intro.split(".")[0])}.</p></a>`)
    .join("")}</div>

  <h2>예약 전 확인</h2>
  <div style="margin-top:1rem;max-width:720px">${checklistBlock()}</div>

  <h2>자주 묻는 질문</h2>
  <div style="margin-top:1rem;max-width:760px">${faqBlock()}</div>

  <h2>${esc(a.name)} 안내 기준</h2>
  <div style="margin-top:1rem">${whoHowWhy(a.name)}</div>

  <h2>다른 생활권 보기</h2>
  <nav class="linklist" style="margin-top:1rem" aria-label="다른 생활권">${otherAreas}</nav>
</div></section>
`;

  return layout({ title, desc, url, breadcrumb: trail, body, includeFaqSchema: true });
}

/* ------------------------------------------------------------------ */
/* page: district /<gu>/                                        */
/* ------------------------------------------------------------------ */
function districtPage(d) {
  const url = `/${d.slug}/`;
  const area = areaBySlug[d.area];
  const title = `${d.name} 출장마사지 · 생활권별 예약 안내 | ${site.brand}`;
  const desc = clamp80(`${d.name} 생활권 안내 · 대표 생활권·가까운 역·예약 전 확인사항 정리.`, url);
  const trail = [
    { name: "서울", path: "/" },
    { name: area.name, path: `/area/${area.slug}/` },
    { name: d.name, path: url },
  ];

  const nearbyGu = (d.nearby || [])
    .map((slug) => districtBySlug[slug])
    .filter(Boolean)
    .map((n) => `<a href="/${n.slug}/">${esc(n.name)} 생활권 안내</a>`)
    .join("");

  const body = `
${breadcrumbNav(trail)}
${hero(`
  <span class="eyebrow">${esc(area.name)}</span>
  <h1>${esc(d.name)} 출장마사지 · 생활권별 예약 안내</h1>
  <p>${esc(d.focus)}. 대표 생활권과 가까운 역, 이용 장소 기준을 함께 확인하세요.</p>
  <div class="hero__cta">
    <a class="btn btn--primary" href="#checklist">예약 전 확인</a>
    <a class="btn btn--ghost" href="/area/${area.slug}/">${esc(area.name)} 보기</a>
  </div>
`)}

<section class="section"><div class="container prose">
  <h2>${esc(d.name)} 지역 개요</h2>
  <p>${esc(d.intro)}</p>

  <h2>대표 생활권</h2>
  ${
    (lifeByDistrict[d.slug] || []).length
      ? `<div class="grid grid--3" style="margin-top:1rem">${(lifeByDistrict[d.slug] || [])
          .map(
            (l) =>
              `<a class="card" href="/life/${l.slug}/"><span class="card__title">${esc(l.name)}</span><p class="card__meta">${esc(l.character.split(".")[0])}.</p></a>`
          )
          .join("")}</div>`
      : `<ul class="linklist" style="margin-top:1rem">${d.lifeAreas.map((l) => `<span class="tag">${esc(l)}</span>`).join("")}</ul>`
  }

  <h2>대표 행정동</h2>
  <ul class="linklist" style="margin-top:1rem">${(() => {
    const pageByName = Object.fromEntries((dongsByDistrict[d.slug] || []).map((x) => [x.name, x]));
    return d.adminDongs
      .map((x) =>
        pageByName[x]
          ? `<a href="/${d.slug}/${pageByName[x].slug}/">${esc(x)}</a>`
          : `<span class="tag">${esc(x)}</span>`
      )
      .join("");
  })()}</ul>

  <h2>가까운 지하철역</h2>
  <ul class="linklist" style="margin-top:1rem">${stationTags(d.stations)}</ul>

  <h2>이용 장소별 기준</h2>
  <div class="grid grid--2" style="margin-top:1rem">
    <a class="card" href="/use/home/"><span class="card__title">자택 이용</span><p class="card__meta">공동현관과 건물 출입 방식, 방문 가능 시간대를 미리 확인합니다.</p></a>
    <a class="card" href="/use/hotel/"><span class="card__title">호텔·숙소 이용</span><p class="card__meta">숙소 정책과 객실 출입 가능 여부를 먼저 확인합니다.</p></a>
    <a class="card" href="/use/officetel/"><span class="card__title">오피스텔 이용</span><p class="card__meta">공동현관, 엘리베이터, 관리 규정을 확인합니다.</p></a>
    <a class="card" href="/use/station-area/"><span class="card__title">역세권 이용</span><p class="card__meta">${esc(d.name)}의 가까운 역과 정확한 건물 주소를 함께 확인합니다.</p></a>
  </div>

  <h2 id="checklist">예약 전 체크리스트</h2>
  <div style="margin-top:1rem;max-width:720px">${checklistBlock()}</div>
  <div class="notice" style="margin-top:1.25rem">개인정보는 예약 확인과 연락에 필요한 최소 정보만 안내하며, 불법·선정적 서비스는 제공하거나 안내하지 않습니다.</div>

  <h2>자주 묻는 질문</h2>
  <div style="margin-top:1rem;max-width:760px">${faqBlock()}</div>

  <h2>${esc(d.name)} 안내 기준</h2>
  <div style="margin-top:1rem">${whoHowWhy(d.name)}</div>

  <h2>${esc(d.name)}과 함께 보면 좋은 안내</h2>
  ${longtailLinks(d.name, guType(d))}

  <h2>관련 지역 보기</h2>
  <nav class="linklist" style="margin-top:1rem" aria-label="관련 지역">
    <a href="/">서울 전체 지역 안내</a>
    <a href="/area/${area.slug}/">${esc(area.name)} 생활권 안내</a>
    ${nearbyGu}
    <a href="/check/address/">방문 주소 확인</a>
    <a href="/check/building-access/">건물 출입 방식 확인</a>
  </nav>
</div></section>
`;

  return layout({ title, desc, url, breadcrumb: trail, body, includeFaqSchema: true });
}

/* ------------------------------------------------------------------ */
/* page: life-area /life/<slug>/                                */
/* ------------------------------------------------------------------ */
function lifePage(l) {
  const url = `/life/${l.slug}/`;
  const area = areaBySlug[l.area];
  const parentGus = (l.districts || []).map((s) => districtBySlug[s]).filter(Boolean);
  const title = `${l.name} 출장마사지 생활권 안내 | ${site.brand}`;
  const desc = clamp80(`${l.name} 생활권 안내 · 가까운 역과 이용 장소, 예약 전 확인사항을 정리했습니다.`, url);
  const trail = [
    { name: "서울", path: "/" },
    { name: area.name, path: `/area/${area.slug}/` },
    { name: l.name, path: url },
  ];

  const typeGuide = {
    business: "업무지구 성격이 강해 건물 보안 게이트, 방문증, 엘리베이터 인증 등 출입 절차를 미리 확인하는 것이 좋습니다.",
    residential: "주거 생활권으로 공동현관 방식과 동·호수, 방문 가능 시간대를 정확히 안내하면 이동이 원활합니다.",
    commercial: "상권과 오피스텔이 섞여 있어 도로명 주소와 건물명, 층·호실을 함께 확인하는 것이 좋습니다.",
    nightlife: "숙소와 상권이 밀집해 숙소 방문 정책과 야간 예약 가능 시간을 함께 확인하는 것이 좋습니다.",
    university: "대학가 원룸·오피스텔이 많아 비슷한 건물이 이어지므로 건물명과 호수, 공동현관 방식을 정확히 확인해야 합니다.",
    downtown: "도심 업무지구로 오피스 보안과 호텔 방문 정책이 함께 있어 방문 유형에 따라 확인 사항이 다릅니다.",
    transit: "환승 거점이라 출구별 도보 거리 차이가 크므로 가까운 출구와 정확한 건물 주소를 함께 확인하는 것이 좋습니다.",
    lodging: "호텔·숙소 비중이 높아 객실 출입 가능 여부와 로비 확인 절차를 먼저 확인하는 것이 좋습니다.",
  };

  const siblings = (lifeByArea[l.area] || [])
    .filter((x) => x.slug !== l.slug)
    .slice(0, 4)
    .map((x) => `<a href="/life/${x.slug}/">${esc(x.name)} 생활권 안내</a>`)
    .join("");

  const body = `
${breadcrumbNav(trail)}
${hero(`
  <span class="eyebrow">${esc(area.name)} · 생활권</span>
  <h1>${esc(l.name)} 출장마사지 생활권 안내</h1>
  <p>${esc(l.character.split(".")[0])}.</p>
  <div class="hero__cta">
    ${parentGus[0] ? `<a class="btn btn--ghost" href="/${parentGus[0].slug}/">${esc(parentGus[0].name)} 안내</a>` : ""}
    <a class="btn btn--primary" href="#checklist">예약 전 확인</a>
  </div>
`)}

<section class="section"><div class="container prose">
  <h2>${esc(l.name)} 생활권 개요</h2>
  <p>${esc(l.character)}</p>

  <h2>포함 행정구</h2>
  <nav class="linklist" style="margin-top:1rem" aria-label="포함 구">${parentGus
    .map((g) => `<a href="/${g.slug}/">${esc(g.name)} 생활권 안내</a>`)
    .join("")}</nav>

  <h2>가까운 지하철역</h2>
  <ul class="linklist" style="margin-top:1rem">${stationTags(l.stations)}</ul>

  <h2>포함 행정동</h2>
  <ul class="linklist" style="margin-top:1rem">${l.dongs.map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</ul>

  <h2>${esc(l.name)} 이용 시 확인할 점</h2>
  <p>${esc(typeGuide[l.type] || typeGuide.residential)}</p>
  <div class="grid grid--3" style="margin-top:1rem">
    <a class="card" href="/use/home/"><span class="card__title">자택 이용</span><p class="card__meta">공동현관과 건물 출입 방식을 미리 확인합니다.</p></a>
    <a class="card" href="/use/officetel/"><span class="card__title">오피스텔 이용</span><p class="card__meta">공동현관·엘리베이터 인증과 관리 규정을 확인합니다.</p></a>
    <a class="card" href="/use/hotel/"><span class="card__title">호텔·숙소 이용</span><p class="card__meta">숙소 방문 정책과 객실 출입 여부를 확인합니다.</p></a>
  </div>

  <h2 id="checklist">예약 전 체크리스트</h2>
  <div style="margin-top:1rem;max-width:720px">${checklistBlock()}</div>
  <div class="notice" style="margin-top:1.25rem">개인정보는 예약 확인과 연락에 필요한 최소 정보만 안내하며, 불법·선정적 서비스는 제공하거나 안내하지 않습니다.</div>

  <h2>자주 묻는 질문</h2>
  <div style="margin-top:1rem;max-width:760px">${faqBlock()}</div>

  <h2>${esc(l.name)} 안내 기준</h2>
  <div style="margin-top:1rem">${whoHowWhy(l.name)}</div>

  ${
    (dongsByLife[l.slug] || []).length
      ? `<h2>${esc(l.name)} 주요 행정동</h2>
  <nav class="linklist" style="margin-top:1rem" aria-label="주요 행정동">${(dongsByLife[l.slug] || [])
          .map((dg) => `<a href="/${dg.district}/${dg.slug}/">${esc(dg.name)}</a>`)
          .join("")}</nav>`
      : ""
  }

  <h2>${esc(l.name)}과 함께 보면 좋은 안내</h2>
  ${longtailLinks(l.name, l.type)}

  <h2>인접 생활권 보기</h2>
  <nav class="linklist" style="margin-top:1rem" aria-label="인접 생활권">
    <a href="/area/${area.slug}/">${esc(area.name)} 전체 보기</a>
    ${siblings}
  </nav>
</div></section>
`;
  return layout({ title, desc, url, breadcrumb: trail, body, includeFaqSchema: true });
}

/* ------------------------------------------------------------------ */
/* page: use-case /use/<slug>/                                  */
/* ------------------------------------------------------------------ */
function usePage(u) {
  const url = `/use/${u.slug}/`;
  const title = `${u.h1} | ${site.brand}`;
  const desc = clamp80(`${u.name} 전 확인할 점과 서울 지역별 기준을 안내합니다.`, url);
  const trail = [
    { name: "서울", path: "/" },
    { name: "이용 장소", path: "/use/home/" },
    { name: u.name, path: url },
  ];
  const related = (u.relatedUse || [])
    .map((s) => useBySlug[s])
    .filter(Boolean)
    .map((x) => `<a href="/use/${x.slug}/">${esc(x.name)} 안내</a>`)
    .join("");

  const body = `
${breadcrumbNav(trail)}
${hero(`
  <span class="eyebrow">이용 장소 안내</span>
  <h1>${esc(u.h1)}</h1>
  <p>${esc(u.intro.split(".")[0])}.</p>
`)}

<section class="section"><div class="container prose">
  <h2>${esc(u.name)}, 왜 확인이 필요한가요?</h2>
  <p>${esc(u.intro)}</p>

  <h2>예약 전 확인 항목</h2>
  <ul class="checklist" style="margin-top:1rem;max-width:720px">${u.checks.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>

  <h2>서울 전 지역 공통 체크리스트</h2>
  <div style="margin-top:1rem;max-width:720px">${checklistBlock()}</div>
  <div class="notice" style="margin-top:1.25rem">불법·선정적 서비스는 제공하거나 안내하지 않으며, 실제 방문 주소와 출입 방식을 함께 확인합니다.</div>

  <h2>자주 묻는 질문</h2>
  <div style="margin-top:1rem;max-width:760px">${faqBlock()}</div>

  <h2>관련 이용 안내</h2>
  <nav class="linklist" style="margin-top:1rem" aria-label="관련 이용 안내">
    ${related}
    <a href="/check/address/">방문 주소 확인</a>
    <a href="/">서울 전체 지역 안내</a>
  </nav>
</div></section>
`;
  return layout({ title, desc, url, breadcrumb: trail, body, includeFaqSchema: true, forceIndex: true });
}

/* ------------------------------------------------------------------ */
/* page: check /check/<slug>/                                   */
/* ------------------------------------------------------------------ */
function checkPage(c) {
  const url = `/check/${c.slug}/`;
  const title = `${c.h1} | ${site.brand}`;
  const desc = clamp80(`${c.name} · 서울 예약 전 확인해야 할 기준을 안내합니다.`, url);
  const trail = [
    { name: "서울", path: "/" },
    { name: "예약 전 확인", path: "/check/address/" },
    { name: c.name, path: url },
  ];
  const others = checks
    .filter((x) => x.slug !== c.slug)
    .slice(0, 4)
    .map((x) => `<a href="/check/${x.slug}/">${esc(x.name)}</a>`)
    .join("");

  const body = `
${breadcrumbNav(trail)}
${hero(`
  <span class="eyebrow">예약 전 확인</span>
  <h1>${esc(c.h1)}</h1>
  <p>${esc(c.intro.split(".")[0])}.</p>
`)}

<section class="section"><div class="container prose">
  <h2>${esc(c.name)}가 왜 중요한가요?</h2>
  <p>${esc(c.intro)}</p>

  <h2>확인 방법</h2>
  <ul class="checklist" style="margin-top:1rem;max-width:720px">${c.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>

  <h2>서울 전 지역 공통 체크리스트</h2>
  <div style="margin-top:1rem;max-width:720px">${checklistBlock()}</div>

  <h2>자주 묻는 질문</h2>
  <div style="margin-top:1rem;max-width:760px">${faqBlock()}</div>

  <h2>다른 확인 항목</h2>
  <nav class="linklist" style="margin-top:1rem" aria-label="다른 확인 항목">
    ${others}
    <a href="/policy/privacy/">개인정보 처리방침</a>
    <a href="/policy/service-policy/">불법·선정적 서비스 불가 안내</a>
  </nav>
</div></section>
`;
  return layout({ title, desc, url, breadcrumb: trail, body, includeFaqSchema: true, forceIndex: true });
}

/* ------------------------------------------------------------------ */
/* page: policy /policy/<slug>/                                 */
/* ------------------------------------------------------------------ */
function policyPage(p) {
  const url = `/policy/${p.slug}/`;
  const title = `${p.h1} | ${site.brand}`;
  const desc = clamp80(p.desc, url);
  const trail = [
    { name: "서울", path: "/" },
    { name: "운영 기준", path: "/policy/privacy/" },
    { name: p.name, path: url },
  ];
  const others = policies
    .filter((x) => x.slug !== p.slug)
    .map((x) => `<a href="/policy/${x.slug}/">${esc(x.name)}</a>`)
    .join("");

  const body = `
${breadcrumbNav(trail)}
${hero(`
  <span class="eyebrow">운영 기준</span>
  <h1>${esc(p.h1)}</h1>
  <p>${esc(p.desc)}</p>
`)}

<section class="section"><div class="container prose">
  ${p.sections.map((s) => `<h2>${esc(s.h)}</h2><p>${esc(s.p)}</p>`).join("")}

  <h2>관련 안내</h2>
  <nav class="linklist" style="margin-top:1rem" aria-label="관련 안내">
    ${others}
    <a href="/">서울 전체 지역 안내</a>
  </nav>
</div></section>
`;
  return layout({ title, desc, url, breadcrumb: trail, body, forceIndex: true });
}

/* ------------------------------------------------------------------ */
/* page: admin-dong /<gu>/<dong>/                               */
/* ------------------------------------------------------------------ */
const BUILDING_GUIDE = {
  business: "업무지구 성격이 강해 건물 보안 게이트·방문증·엘리베이터 인증 등 출입 절차를 미리 확인하는 것이 좋습니다.",
  residential: "주거지가 중심이라 공동현관 방식과 동·호수, 방문 가능 시간대를 정확히 안내하면 이동이 원활합니다.",
  commercial: "상권과 오피스텔이 섞여 있어 도로명 주소와 건물명, 층·호실을 함께 확인하는 것이 좋습니다.",
  nightlife: "숙소·상권이 밀집해 숙소 방문 정책과 야간 예약 가능 시간을 함께 확인하는 것이 좋습니다.",
  university: "대학가 원룸·오피스텔이 많아 비슷한 건물이 이어지므로 건물명과 호수, 공동현관 방식을 정확히 확인해야 합니다.",
  lodging: "호텔·숙소 비중이 높아 객실 출입 가능 여부와 로비 확인 절차를 먼저 확인하는 것이 좋습니다.",
  transit: "여러 노선이 만나는 환승 거점이라 출구별 도보 거리 차이가 크므로 가까운 출구와 정확한 건물 주소를 함께 확인하는 것이 좋습니다.",
  downtown: "도심 업무·상권이 밀집해 오피스 보안 절차와 상가 출입 방식이 함께 있어 방문 유형에 따라 확인 사항이 다릅니다.",
  industrial: "산업·유통 시설이 많아 단지·동 번호와 출입 게이트, 방문 가능 시간대를 미리 확인하는 것이 좋습니다.",
  culture: "문화·상권 시설과 주거가 섞여 있어 방문지 유형과 정확한 건물 주소를 함께 확인하는 것이 좋습니다.",
};

const TYPE_LABEL = {
  business: "업무지구", residential: "주거 생활권", commercial: "상권 생활권", nightlife: "숙소·상권",
  university: "대학가", lodging: "호텔·숙소", transit: "역세권", downtown: "도심", industrial: "산업권", culture: "문화·상권",
};

const TYPE_CHECKS = {
  business: ["건물 보안 게이트·방문증 절차를 확인했나요?", "정확한 층·호실을 안내했나요?", "야간·주말 출입구가 별도인가요?"],
  residential: ["공동현관 출입 방식을 확인했나요?", "동·호수와 출입구 위치를 안내했나요?", "방문 가능 시간대를 확인했나요?"],
  commercial: ["방문지가 상가인지 주거인지 확인했나요?", "상호와 층수를 함께 안내했나요?", "차량 접근·주차 여부를 확인했나요?"],
  nightlife: ["숙소 방문 정책을 확인했나요?", "객실 출입이 가능한 형태인가요?", "야간 예약 가능 시간을 확인했나요?"],
  university: ["건물명과 호수를 정확히 확인했나요?", "공동현관 출입 방식을 확인했나요?", "유사 건물 여부를 도로명 주소로 확인했나요?"],
  lodging: ["숙소의 외부인 방문 정책을 확인했나요?", "객실 출입 가능 여부를 확인했나요?", "로비·프런트 확인 절차가 있나요?"],
  transit: ["가까운 출구 번호를 확인했나요?", "역명이 아닌 건물 주소를 안내했나요?", "환승 혼잡 시간대를 고려했나요?"],
  downtown: ["오피스 보안·방문증 절차를 확인했나요?", "상가·주거 여부를 구분했나요?", "가까운 차량 진입로를 확인했나요?"],
  industrial: ["단지·동 번호를 확인했나요?", "출입 게이트·방문 시간대를 확인했나요?", "대형 차량 접근 경로를 확인했나요?"],
  culture: ["방문지 유형(상가·주거)을 확인했나요?", "정확한 건물 주소를 안내했나요?", "행사·공연 시간대 혼잡을 고려했나요?"],
};

const dongAudit = [];

function adminDongPage(dong) {
  const gu = districtBySlug[dong.district];
  const area = areaBySlug[gu.area];
  const life = dong.lifeArea ? lifeBySlug[dong.lifeArea] : null;
  const url = `/${gu.slug}/${dong.slug}/`;
  const label = TYPE_LABEL[dong.type] || "생활권";
  const [s1, s2] = dong.stations;
  const title = `${dong.name} 출장마사지 · ${gu.name} ${label} 방문 안내 | ${site.brand}`;
  const desc = clamp80(`${dong.name} 방문 안내 · ${s1}${s2 ? "·" + s2 : ""} 인근 ${label}, 예약 전 확인사항 정리.`, url);
  const trail = [
    { name: "서울", path: "/" },
    { name: area.name, path: `/area/${area.slug}/` },
    { name: gu.name, path: `/${gu.slug}/` },
    { name: dong.name, path: url },
  ];

  const siblings = (dongsByDistrict[dong.district] || [])
    .filter((x) => x.slug !== dong.slug)
    .slice(0, 5)
    .map((x) => `<a href="/${gu.slug}/${x.slug}/">${esc(x.name)}</a>`)
    .join("");

  const body = `
${breadcrumbNav(trail)}
${hero(`
  <span class="eyebrow">${esc(gu.name)} · 행정동</span>
  <h1>${esc(dong.name)} 출장마사지 · ${esc(gu.name)} 방문 안내</h1>
  <p>${esc(dong.character.split(".")[0])}.</p>
  <div class="hero__cta">
    <a class="btn btn--ghost" href="/${gu.slug}/">${esc(gu.name)} 안내</a>
    ${life ? `<a class="btn btn--ghost" href="/life/${life.slug}/">${esc(life.name)} 생활권</a>` : ""}
    <a class="btn btn--primary" href="#checklist">예약 전 확인</a>
  </div>
`)}

<section class="section"><div class="container prose">
  <h2>${esc(dong.name)} 위치와 성격</h2>
  <p>${esc(dong.character)}</p>

  <h2>상위 지역 연결</h2>
  <nav class="linklist" style="margin-top:1rem" aria-label="상위 지역">
    <a href="/${gu.slug}/">${esc(gu.name)} 생활권 안내</a>
    <a href="/area/${area.slug}/">${esc(area.name)} 안내</a>
    ${life ? `<a href="/life/${life.slug}/">${esc(life.name)} 생활권 안내</a>` : ""}
  </nav>

  <h2>가까운 지하철역</h2>
  <ul class="linklist" style="margin-top:1rem">${stationTags(dong.stations)}</ul>

  <h2>${esc(dong.name)}에서 특히 확인할 점</h2>
  <p>${esc(BUILDING_GUIDE[dong.type] || BUILDING_GUIDE.residential)}</p>
  <p>${esc(dong.point)}</p>
  <div class="grid grid--3" style="margin-top:1rem">
    <a class="card" href="/use/home/"><span class="card__title">자택 이용</span><p class="card__meta">공동현관과 건물 출입 방식을 미리 확인합니다.</p></a>
    <a class="card" href="/use/officetel/"><span class="card__title">오피스텔 이용</span><p class="card__meta">공동현관·엘리베이터 인증과 관리 규정을 확인합니다.</p></a>
    <a class="card" href="/use/station-area/"><span class="card__title">역세권 이용</span><p class="card__meta">가까운 역과 정확한 건물 주소를 함께 확인합니다.</p></a>
  </div>

  <h2 id="checklist">${esc(dong.name)} 예약 전 확인</h2>
  <ul class="checklist" style="margin-top:1rem;max-width:720px">${(TYPE_CHECKS[dong.type] || TYPE_CHECKS.residential)
    .map((c) => `<li>${esc(c)}</li>`)
    .join("")}</ul>
  <div class="notice" style="margin-top:1.25rem">개인정보는 예약 확인과 연락에 필요한 최소 정보만 안내하며, 불법·선정적 서비스는 제공하거나 안내하지 않습니다.</div>

  <h2>${esc(dong.name)} 안내 기준</h2>
  <div style="margin-top:1rem">${whoHowWhy(`${gu.name} ${dong.name}`)}</div>

  <h2>${esc(dong.name)}과 함께 보면 좋은 안내</h2>
  ${longtailLinks(dong.name, dong.type)}

  <h2>${esc(gu.name)} 인접 행정동</h2>
  <nav class="linklist" style="margin-top:1rem" aria-label="인접 행정동">
    ${siblings}
    <a href="/check/address/">방문 주소 확인</a>
  </nav>
</div></section>
`;
  dongAudit.push({ district: dong.district, url, title, desc, text: textLen(body), body });
  return layout({ title, desc, url, breadcrumb: trail, body });
}

/* ------------------------------------------------------------------ */
/* page: station /station/<slug>/                                     */
/* ------------------------------------------------------------------ */
const stationAudit = [];
function stationPage(st) {
  const url = `/station/${st.slug}/`;
  const life = st.lifeArea ? lifeBySlug[st.lifeArea] : null;
  const gu = st.gu ? districtBySlug[st.gu] : null;
  const area = gu ? areaBySlug[gu.area] : null;
  const label = TYPE_LABEL[st.type] || "역세권";
  const title = `${st.name} 출장마사지 · ${st.name}세권 예약 안내 | ${site.brand}`;
  const desc = clamp80(`${st.name} 역세권 안내 · ${st.lines.join("·")} ${label}, 예약 전 확인사항 정리.`, url);
  const trail = [
    { name: "서울", path: "/" },
    ...(area ? [{ name: area.name, path: `/area/${area.slug}/` }] : []),
    { name: st.name, path: url },
  ];

  const others = stations
    .filter((x) => x.slug !== st.slug && x.type === st.type)
    .slice(0, 4)
    .map((x) => `<a href="/station/${x.slug}/">${esc(x.name)}</a>`)
    .join("");

  const body = `
${breadcrumbNav(trail)}
${hero(`
  <span class="eyebrow">지하철역 · 역세권</span>
  <h1>${esc(st.name)} 출장마사지 · ${esc(st.name)}세권 예약 안내</h1>
  <p>${esc(st.character.split(".")[0])}.</p>
  <div class="hero__cta">
    ${life ? `<a class="btn btn--ghost" href="/life/${life.slug}/">${esc(life.name)} 생활권</a>` : ""}
    ${gu ? `<a class="btn btn--ghost" href="/${gu.slug}/">${esc(gu.name)} 안내</a>` : ""}
    <a class="btn btn--primary" href="#checklist">예약 전 확인</a>
  </div>
`)}

<section class="section"><div class="container prose">
  <h2>${esc(st.name)} 역세권 개요</h2>
  <p>${esc(st.character)}</p>

  <h2>운행 노선</h2>
  <ul class="linklist" style="margin-top:1rem">${st.lines.map((l) => `<span class="tag">${esc(l)}</span>`).join("")}</ul>

  <h2>가까운 지역</h2>
  <nav class="linklist" style="margin-top:1rem" aria-label="가까운 지역">
    ${life ? `<a href="/life/${life.slug}/">${esc(life.name)} 생활권 안내</a>` : ""}
    ${gu ? `<a href="/${gu.slug}/">${esc(gu.name)} 생활권 안내</a>` : ""}
    ${area ? `<a href="/area/${area.slug}/">${esc(area.name)} 안내</a>` : ""}
  </nav>

  <h2>${esc(st.name)}에서 확인할 점</h2>
  <p>${esc(BUILDING_GUIDE[st.type] || BUILDING_GUIDE.transit)}</p>
  <p>${esc(st.point)}</p>
  <div class="notice" style="margin-top:1rem">${esc(st.name)}은 역명 기준 한 페이지로만 안내합니다. 같은 역의 출구별·노선별 페이지를 따로 만들지 않아 중복을 줄이고, 실제 방문은 정확한 건물 주소로 확인합니다.</div>

  <h2>이용 장소별 안내</h2>
  <div class="grid grid--3" style="margin-top:1rem">
    <a class="card" href="/use/station-area/"><span class="card__title">역세권 이용</span><p class="card__meta">가까운 역과 정확한 건물 주소를 함께 확인합니다.</p></a>
    <a class="card" href="/use/hotel/"><span class="card__title">호텔·숙소 이용</span><p class="card__meta">숙소 방문 정책과 객실 출입 여부를 확인합니다.</p></a>
    <a class="card" href="/use/officetel/"><span class="card__title">오피스텔 이용</span><p class="card__meta">공동현관·엘리베이터 인증과 관리 규정을 확인합니다.</p></a>
  </div>

  <h2 id="checklist">${esc(st.name)} 예약 전 확인</h2>
  <ul class="checklist" style="margin-top:1rem;max-width:720px">${(TYPE_CHECKS[st.type] || TYPE_CHECKS.transit)
    .map((c) => `<li>${esc(c)}</li>`)
    .join("")}</ul>
  <div class="notice" style="margin-top:1.25rem">개인정보는 예약 확인과 연락에 필요한 최소 정보만 안내하며, 불법·선정적 서비스는 제공하거나 안내하지 않습니다.</div>

  <h2>${esc(st.name)} 역세권과 함께 보면 좋은 안내</h2>
  ${longtailLinks(st.name, st.type)}

  <h2>다른 주요 역</h2>
  <nav class="linklist" style="margin-top:1rem" aria-label="다른 역">
    ${others}
    <a href="/use/station-area/">역세권 이용 안내</a>
  </nav>
</div></section>
`;
  stationAudit.push({ url, body });
  return layout({ title, desc, url, breadcrumb: trail, body });
}

/* ------------------------------------------------------------------ */
/* write helpers                                                      */
/* ------------------------------------------------------------------ */
function writePage(relDir, html) {
  const dir = path.join(DIST, relDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), html);
}

const urls = [];
// html은 layout()이 생성하면서 layout._noindex를 설정한다. noindex 페이지는 sitemap에서 제외.
function emit(relDir, url, html) {
  writePage(relDir, html);
  if (!layout._noindex) urls.push(url);
}

/* ------------------------------------------------------------------ */
/* build                                                              */
/* ------------------------------------------------------------------ */
function build() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(path.join(DIST, "assets"), { recursive: true });
  // src/assets/* → dist/assets/ (히어로 이미지 등 정적 파일)
  const srcAssets = path.join(ROOT, "src", "assets");
  if (fs.existsSync(srcAssets)) fs.cpSync(srcAssets, path.join(DIST, "assets"), { recursive: true });
  fs.copyFileSync(SRC_CSS, path.join(DIST, "assets", "main.css"));

  // 파비콘/아이콘을 루트로 복사(/favicon.ico 관례)
  ["favicon.ico", "favicon.svg", "apple-touch-icon.png"].forEach((f) => {
    const src = path.join(srcAssets, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(DIST, f));
  });
  fs.writeFileSync(
    path.join(DIST, "site.webmanifest"),
    JSON.stringify({
      name: site.brand,
      short_name: site.brand,
      icons: [
        { src: "/favicon.svg", type: "image/svg+xml", sizes: "any" },
        { src: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" },
      ],
      theme_color: "#0a0d14",
      background_color: "#0a0d14",
      display: "standalone",
    })
  );

  // 브랜드 404 (Netlify가 publish/404.html을 자동 서빙)
  fs.writeFileSync(
    path.join(DIST, "404.html"),
    `<!doctype html><html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0a0d14"><meta name="color-scheme" content="dark">
${FAVICON}
<title>페이지를 찾을 수 없습니다 | ${esc(site.brand)}</title>
<meta name="robots" content="noindex, follow">
<link rel="stylesheet" href="/assets/main.css">
</head><body>
${header()}
<main id="main"><section class="section"><div class="container prose" style="text-align:center;max-width:640px">
<span class="eyebrow">404</span>
<h1>페이지를 찾을 수 없습니다</h1>
<p>주소가 바뀌었거나 존재하지 않는 페이지입니다. 아래에서 원하는 지역을 다시 찾아보세요.</p>
<nav class="linklist" style="justify-content:center;margin-top:1.5rem" aria-label="바로가기">
<a href="/">서울 전체 지역 안내</a>
<a href="/#areas">5대 생활권</a>
<a href="/#districts">25개 구</a>
<a href="/use/home/">이용 장소</a>
<a href="/check/address/">예약 전 확인</a>
</nav>
</div></section></main>
${footer()}
${floatingCall()}
</body></html>`
  );

  emit(".", "/", mainPage());

  areas.forEach((a) => emit(path.join("area", a.slug), `/area/${a.slug}/`, areaPage(a)));
  districts.forEach((d) => emit(d.slug, `/${d.slug}/`, districtPage(d)));
  adminDongs.forEach((dg) =>
    emit(path.join(dg.district, dg.slug), `/${dg.district}/${dg.slug}/`, adminDongPage(dg))
  );
  lifeAreas.forEach((l) => emit(path.join("life", l.slug), `/life/${l.slug}/`, lifePage(l)));
  stations.forEach((st) => emit(path.join("station", st.slug), `/station/${st.slug}/`, stationPage(st)));
  useCases.forEach((u) => emit(path.join("use", u.slug), `/use/${u.slug}/`, usePage(u)));
  checks.forEach((c) => emit(path.join("check", c.slug), `/check/${c.slug}/`, checkPage(c)));
  policies.forEach((p) => emit(path.join("policy", p.slug), `/policy/${p.slug}/`, policyPage(p)));

  // ── 검증: 완전성 + 고유성 + 중복(near-duplicate) ──────────────────
  const audit = [];
  // 1) 완전성: districts.json 대표 행정동이 모두 페이지로 존재하는가
  const missing = [];
  districts.forEach((d) => {
    const names = new Set((dongsByDistrict[d.slug] || []).map((x) => x.name));
    (d.adminDongs || []).forEach((n) => {
      if (!names.has(n)) missing.push(`${d.name} › ${n}`);
    });
  });
  audit.push(missing.length ? `  ✗ 누락 행정동 ${missing.length}개: ${missing.join(", ")}` : `  ✓ 대표 행정동 전수 생성(구별 누락 0)`);

  // 2) 고유성: 타이틀·디스크립션 중복 검사(전 페이지 대상)
  const titleDup = findDup(allTitles);
  const descDup = findDup(allDescs);
  audit.push(titleDup.length ? `  ✗ 타이틀 중복 ${titleDup.length}: ${titleDup.join(" / ")}` : `  ✓ 타이틀 고유(중복 0, ${allTitles.length}p)`);
  audit.push(descDup.length ? `  ✗ 디스크립션 중복 ${descDup.length}: ${descDup.join(" / ")}` : `  ✓ 디스크립션 고유(중복 0, ${allDescs.length}p)`);

  // 3) 중복 본문: 같은 구 내 행정동 페이지 쌍의 최대 Jaccard(5-word shingle)
  let maxJ = 0, maxPair = "";
  const byDist = {};
  dongAudit.forEach((a) => (byDist[a.district] = byDist[a.district] || []).push(a));
  for (const dist of Object.keys(byDist)) {
    const arr = byDist[dist].map((a) => ({ url: a.url, sh: shingles(a.body) }));
    for (let i = 0; i < arr.length; i++)
      for (let j = i + 1; j < arr.length; j++) {
        const J = jaccard(arr[i].sh, arr[j].sh);
        if (J > maxJ) { maxJ = J; maxPair = `${arr[i].url} ~ ${arr[j].url}`; }
      }
  }
  audit.push(`  ${maxJ < 0.6 ? "✓" : "⚠"} 행정동 본문 최대 유사도(Jaccard) ${maxJ.toFixed(2)} ${maxPair ? "(" + maxPair + ")" : ""}`);

  // 3b) 역 페이지 본문 near-duplicate
  let sMax = 0, sPair = "";
  const sArr = stationAudit.map((a) => ({ url: a.url, sh: shingles(a.body) }));
  for (let i = 0; i < sArr.length; i++)
    for (let j = i + 1; j < sArr.length; j++) {
      const J = jaccard(sArr[i].sh, sArr[j].sh);
      if (J > sMax) { sMax = J; sPair = `${sArr[i].url} ~ ${sArr[j].url}`; }
    }
  audit.push(`  ${sMax < 0.6 ? "✓" : "⚠"} 지하철역 본문 최대 유사도(Jaccard) ${sMax.toFixed(2)} ${sPair ? "(" + sPair + ")" : ""}`);

  // sitemap.xml
  const NOW = new Date();
  const today = NOW.toISOString().slice(0, 10);
  const rfc822 = NOW.toUTCString();

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
    .map(
      (u) =>
        `  <url><loc>${abs(u)}</loc><lastmod>${today}</lastmod><changefreq>${u === "/" ? "daily" : "weekly"}</changefreq><priority>${u === "/" ? "1.0" : "0.8"}</priority></url>`
    )
    .join("\n")}
</urlset>`;
  fs.writeFileSync(path.join(DIST, "sitemap.xml"), sitemap);

  // RSS 2.0 피드 — 색인 발견 촉진(네이버 서치어드바이저 RSS 제출용). 핵심 페이지 중심.
  const feedItems = [
    { u: "/", t: `${site.brand} 서울 출장마사지 생활권 지역 안내`, d: "서울 5대 생활권과 25개 구, 자택·호텔·오피스텔 방문 이용 기준 안내" },
    ...areas.map((a) => ({ u: `/area/${a.slug}/`, t: `${a.name} 생활권 안내`, d: a.summary })),
    ...districts.map((d) => ({ u: `/${d.slug}/`, t: `${d.name} 출장마사지 생활권별 예약 안내`, d: `${d.name} 대표 생활권·가까운 역·예약 전 확인` })),
    ...stations.map((s) => ({ u: `/station/${s.slug}/`, t: `${s.name} 출장마사지 역세권 예약 안내`, d: `${s.name} ${s.lines.join("·")} 역세권 이용 안내` })),
    ...lifeAreas.map((l) => ({ u: `/life/${l.slug}/`, t: `${l.name} 출장마사지 생활권 안내`, d: l.character.split(".")[0] + "." })),
    ...useCases.map((u) => ({ u: `/use/${u.slug}/`, t: u.h1, d: u.intro.split(".")[0] + "." })),
    ...checks.map((c) => ({ u: `/check/${c.slug}/`, t: c.h1, d: c.intro.split(".")[0] + "." })),
  ];
  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${esc(site.brand)} · 서울 지역 안내</title>
<link>${site.siteUrl}/</link>
<atom:link href="${abs("/rss.xml")}" rel="self" type="application/rss+xml"/>
<description>서울 5대 생활권·25개 구·행정동·역세권 방문 이용 안내</description>
<language>ko</language>
<lastBuildDate>${rfc822}</lastBuildDate>
${feedItems
    .map(
      (it) =>
        `<item><title>${esc(it.t)}</title><link>${abs(it.u)}</link><guid isPermaLink="true">${abs(it.u)}</guid><pubDate>${rfc822}</pubDate><description>${esc(it.d || "")}</description></item>`
    )
    .join("\n")}
</channel>
</rss>`;
  fs.writeFileSync(path.join(DIST, "rss.xml"), rss);

  // robots.txt — 전 봇 허용 + 네이버(Yeti)/구글/빙 명시 + 사이트맵
  fs.writeFileSync(
    path.join(DIST, "robots.txt"),
    [
      "User-agent: *",
      "Allow: /",
      "",
      "User-agent: Yeti", // 네이버
      "Allow: /",
      "",
      "User-agent: Googlebot",
      "Allow: /",
      "",
      "User-agent: Bingbot",
      "Allow: /",
      "",
      `Sitemap: ${abs("/sitemap.xml")}`,
      "",
    ].join("\n")
  );

  console.log(`✔ 빌드 완료: 색인 ${urls.length}개 (+ 루트 리다이렉트)`);
  console.log(
    `  · 메인 1 · 생활권(권역) ${areas.length} · 구 ${districts.length} · 행정동 ${adminDongs.length} · 생활권(동네) ${lifeAreas.length} · 지하철역 ${stations.length} · 이용 장소 ${useCases.length} · 예약 전 확인 ${checks.length} · 운영 기준 ${policies.length}`
  );
  console.log(
    warnings.length ? "\n" + warnings.join("\n") : "  · 모든 meta description 80자 이내 ✓"
  );
  console.log(
    noindexLog.length
      ? `  · 도어웨이 방지 noindex ${noindexLog.length}개: ${noindexLog.join(", ")}`
      : "  · thin-content noindex 대상 없음 ✓"
  );
  console.log("── 검증 ──");
  console.log(audit.join("\n"));
}

build();
