#!/usr/bin/env node
/* =====================================================================
   간다GO · 서울 지역 안내 — 정적 사이트 빌드 스크립트
   data/seoul/*.json → dist/*.html + sitemap.xml + robots.txt
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

const districtBySlug = Object.fromEntries(districts.map((d) => [d.slug, d]));
const areaBySlug = Object.fromEntries(areas.map((a) => [a.slug, a]));
const useBySlug = Object.fromEntries(useCases.map((u) => [u.slug, u]));
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
  { label: "서울 홈", path: "/seoul/" },
  { label: "생활권", path: "/seoul/#areas" },
  { label: "구별 안내", path: "/seoul/#districts" },
  { label: "이용 장소", path: "/seoul/use/home/" },
  { label: "예약 전 확인", path: "/seoul/check/address/" },
];

function header() {
  return `<header class="site-header"><div class="container site-header__inner">
    <a class="brand" href="/seoul/"><span class="brand__mark">${esc(site.brand)}</span><span class="brand__tag">서울 지역 안내</span></a>
    <nav class="site-nav" aria-label="주요 메뉴">
      ${NAV.map((n) => `<a href="${n.path}">${esc(n.label)}</a>`).join("")}
    </nav>
    <a class="header-phone" href="tel:${site.phone.replace(/-/g, "")}"><span>${esc(site.phoneLabel)}</span>${esc(site.phone)}</a>
  </div></header>`;
}

const TELEGRAM_ICON =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9.78 15.6 9.6 19.2c.36 0 .52-.16.71-.35l1.7-1.63 3.53 2.58c.65.36 1.11.17 1.28-.6l2.32-10.9c.21-.96-.35-1.34-.98-1.1L4.4 10.5c-.94.36-.92.88-.16 1.11l3.5 1.09 8.14-5.13c.38-.25.73-.11.44.15L9.78 15.6Z"/></svg>';

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
    .map((d) => `<li><a href="/seoul/${d.slug}/">${esc(d.name)} 생활권 안내</a></li>`)
    .join("");
  const areaLinks = areas
    .map((a) => `<li><a href="/seoul/area/${a.slug}/">${esc(a.name)} 안내</a></li>`)
    .join("");
  const useLinks = useCases
    .map((u) => `<li><a href="/seoul/use/${u.slug}/">${esc(u.name)}</a></li>`)
    .join("");
  const policyLinks = [
    ...checks.map((c) => `<li><a href="/seoul/check/${c.slug}/">${esc(c.name)}</a></li>`),
    ...policies.map((p) => `<li><a href="/seoul/policy/${p.slug}/">${esc(p.name)}</a></li>`),
  ].join("");
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
      <div class="footer-col"><h3>구별 안내</h3><ul>${guLinks}<li><a href="/seoul/#districts">전체 25개 구 보기</a></li></ul></div>
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

const won = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

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
/* page: main /seoul/                                                 */
/* ------------------------------------------------------------------ */
function mainPage() {
  const url = "/seoul/";
  const title = "서울 출장마사지｜강남·잠실·홍대·여의도·성수 생활권 지역 안내";
  const desc = clamp80(
    "서울 5대 생활권과 25개 구, 자택·호텔·오피스텔 방문 이용 기준을 안내합니다.",
    "main"
  );

  const areaCards = areas
    .map(
      (a) => `<a class="card" href="/seoul/area/${a.slug}/">
        <span class="card__title">${esc(a.name)}</span>
        <p class="card__meta">${esc(a.summary)}</p>
        <span class="card__tags">${a.lifeAreas.slice(0, 3).map((l) => `<span class="tag">${esc(l)}</span>`).join("")}</span>
      </a>`
    )
    .join("");

  const guCards = districts
    .map(
      (d) => `<a class="card" href="/seoul/${d.slug}/">
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
${breadcrumbNav([{ name: "서울", path: "/seoul/" }])}
<section class="hero"><div class="container hero__inner">
  <span class="eyebrow">서울 지역 안내</span>
  <h1>서울 출장마사지 · 생활권별 방문 가능 지역 안내</h1>
  <p>강남, 잠실, 홍대, 여의도, 성수, 용산, 목동, 마곡 등 서울 주요 생활권과 자택·호텔·오피스텔 이용 전 확인사항을 안내합니다.</p>
  <div class="hero__cta">
    <a class="btn btn--primary btn--lg" href="#areas">생활권 보기</a>
    <a class="btn btn--ghost btn--lg" href="#districts">구별 안내</a>
    <a class="btn btn--ghost btn--lg" href="#checklist">예약 전 확인</a>
  </div>
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

<section class="section alt" id="usecases"><div class="container">
  <span class="eyebrow">이용 장소</span>
  <h2>이용 장소에 따라 확인할 내용이 다릅니다</h2>
  <div class="grid grid--3" style="margin-top:1.5rem">${useCards}</div>
</div></section>

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
    breadcrumb: [{ name: "서울", path: "/seoul/" }],
    body,
    includeFaqSchema: true,
  });
}

/* ------------------------------------------------------------------ */
/* page: area /seoul/area/<slug>/                                     */
/* ------------------------------------------------------------------ */
function areaPage(a) {
  const url = `/seoul/area/${a.slug}/`;
  const title = `${a.name} 출장마사지 · 포함 구와 생활권 안내 | ${site.brand}`;
  const desc = clamp80(`${a.name} 안내 · 포함 구와 대표 생활권, 방문 이용 기준을 정리했습니다.`, url);
  const trail = [
    { name: "서울", path: "/seoul/" },
    { name: a.name, path: url },
  ];

  const guCards = a.districts
    .map((slug) => {
      const d = districtBySlug[slug];
      return `<a class="card" href="/seoul/${d.slug}/"><span class="card__title">${esc(d.name)}</span><p class="card__meta">${esc(d.lifeAreas.slice(0, 3).join(" · "))}</p></a>`;
    })
    .join("");

  const otherAreas = areas
    .filter((x) => x.slug !== a.slug)
    .map((x) => `<a href="/seoul/area/${x.slug}/">${esc(x.name)} 생활권 안내</a>`)
    .join("");

  const body = `
${breadcrumbNav(trail)}
<section class="hero"><div class="container hero__inner">
  <span class="eyebrow">서울 5대 생활권</span>
  <h1>${esc(a.name)} 생활권 안내</h1>
  <p>${esc(a.summary)}</p>
</div></section>

<section class="section"><div class="container prose">
  <h2>${esc(a.name)} 개요</h2>
  <p>${esc(a.intro)}</p>

  <h2>포함 구</h2>
  <div class="grid grid--3" style="margin:1.25rem 0 0">${guCards}</div>

  <h2>대표 생활권 상세 안내</h2>
  <div class="grid grid--3" style="margin-top:1rem">${(lifeByArea[a.slug] || [])
    .map(
      (l) =>
        `<a class="card" href="/seoul/life/${l.slug}/"><span class="card__title">${esc(l.name)}</span><p class="card__meta">${esc(l.character.split(".")[0])}.</p></a>`
    )
    .join("")}</div>

  <h2>대표 지하철역</h2>
  <ul class="linklist" style="margin-top:1rem">${a.stations.map((s) => `<span class="tag">${esc(s)}</span>`).join("")}</ul>

  <h2>이용 장소별 안내</h2>
  <div class="grid grid--3" style="margin-top:1rem">${useCases
    .slice(0, 6)
    .map((u) => `<a class="card" href="/seoul/use/${u.slug}/"><span class="card__title">${esc(u.name)}</span><p class="card__meta">${esc(u.intro.split(".")[0])}.</p></a>`)
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
/* page: district /seoul/<gu>/                                        */
/* ------------------------------------------------------------------ */
function districtPage(d) {
  const url = `/seoul/${d.slug}/`;
  const area = areaBySlug[d.area];
  const title = `${d.name} 출장마사지 · 생활권별 예약 안내 | ${site.brand}`;
  const desc = clamp80(`${d.name} 생활권 안내 · 대표 생활권·가까운 역·예약 전 확인사항 정리.`, url);
  const trail = [
    { name: "서울", path: "/seoul/" },
    { name: area.name, path: `/seoul/area/${area.slug}/` },
    { name: d.name, path: url },
  ];

  const nearbyGu = (d.nearby || [])
    .map((slug) => districtBySlug[slug])
    .filter(Boolean)
    .map((n) => `<a href="/seoul/${n.slug}/">${esc(n.name)} 생활권 안내</a>`)
    .join("");

  const body = `
${breadcrumbNav(trail)}
<section class="hero"><div class="container hero__inner">
  <span class="eyebrow">${esc(area.name)}</span>
  <h1>${esc(d.name)} 출장마사지 · 생활권별 예약 안내</h1>
  <p>${esc(d.focus)}. 대표 생활권과 가까운 역, 이용 장소 기준을 함께 확인하세요.</p>
  <div class="hero__cta">
    <a class="btn btn--primary" href="#checklist">예약 전 확인</a>
    <a class="btn btn--ghost" href="/seoul/area/${area.slug}/">${esc(area.name)} 보기</a>
  </div>
</div></section>

<section class="section"><div class="container prose">
  <h2>${esc(d.name)} 지역 개요</h2>
  <p>${esc(d.intro)}</p>

  <h2>대표 생활권</h2>
  ${
    (lifeByDistrict[d.slug] || []).length
      ? `<div class="grid grid--3" style="margin-top:1rem">${(lifeByDistrict[d.slug] || [])
          .map(
            (l) =>
              `<a class="card" href="/seoul/life/${l.slug}/"><span class="card__title">${esc(l.name)}</span><p class="card__meta">${esc(l.character.split(".")[0])}.</p></a>`
          )
          .join("")}</div>`
      : `<ul class="linklist" style="margin-top:1rem">${d.lifeAreas.map((l) => `<span class="tag">${esc(l)}</span>`).join("")}</ul>`
  }

  <h2>대표 행정동</h2>
  <ul class="linklist" style="margin-top:1rem">${d.adminDongs.map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</ul>

  <h2>가까운 지하철역</h2>
  <ul class="linklist" style="margin-top:1rem">${d.stations.map((s) => `<span class="tag">${esc(s)}</span>`).join("")}</ul>

  <h2>이용 장소별 기준</h2>
  <div class="grid grid--2" style="margin-top:1rem">
    <a class="card" href="/seoul/use/home/"><span class="card__title">자택 이용</span><p class="card__meta">공동현관과 건물 출입 방식, 방문 가능 시간대를 미리 확인합니다.</p></a>
    <a class="card" href="/seoul/use/hotel/"><span class="card__title">호텔·숙소 이용</span><p class="card__meta">숙소 정책과 객실 출입 가능 여부를 먼저 확인합니다.</p></a>
    <a class="card" href="/seoul/use/officetel/"><span class="card__title">오피스텔 이용</span><p class="card__meta">공동현관, 엘리베이터, 관리 규정을 확인합니다.</p></a>
    <a class="card" href="/seoul/use/station-area/"><span class="card__title">역세권 이용</span><p class="card__meta">${esc(d.name)}의 가까운 역과 정확한 건물 주소를 함께 확인합니다.</p></a>
  </div>

  <h2 id="checklist">예약 전 체크리스트</h2>
  <div style="margin-top:1rem;max-width:720px">${checklistBlock()}</div>
  <div class="notice" style="margin-top:1.25rem">개인정보는 예약 확인과 연락에 필요한 최소 정보만 안내하며, 불법·선정적 서비스는 제공하거나 안내하지 않습니다.</div>

  <h2>자주 묻는 질문</h2>
  <div style="margin-top:1rem;max-width:760px">${faqBlock()}</div>

  <h2>${esc(d.name)} 안내 기준</h2>
  <div style="margin-top:1rem">${whoHowWhy(d.name)}</div>

  <h2>관련 지역 보기</h2>
  <nav class="linklist" style="margin-top:1rem" aria-label="관련 지역">
    <a href="/seoul/">서울 전체 지역 안내</a>
    <a href="/seoul/area/${area.slug}/">${esc(area.name)} 생활권 안내</a>
    ${nearbyGu}
    <a href="/seoul/check/address/">방문 주소 확인</a>
    <a href="/seoul/check/building-access/">건물 출입 방식 확인</a>
  </nav>
</div></section>
`;

  return layout({ title, desc, url, breadcrumb: trail, body, includeFaqSchema: true });
}

/* ------------------------------------------------------------------ */
/* page: life-area /seoul/life/<slug>/                                */
/* ------------------------------------------------------------------ */
function lifePage(l) {
  const url = `/seoul/life/${l.slug}/`;
  const area = areaBySlug[l.area];
  const parentGus = (l.districts || []).map((s) => districtBySlug[s]).filter(Boolean);
  const title = `${l.name} 출장마사지 생활권 안내 | ${site.brand}`;
  const desc = clamp80(`${l.name} 생활권 안내 · 가까운 역과 이용 장소, 예약 전 확인사항을 정리했습니다.`, url);
  const trail = [
    { name: "서울", path: "/seoul/" },
    { name: area.name, path: `/seoul/area/${area.slug}/` },
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
    .map((x) => `<a href="/seoul/life/${x.slug}/">${esc(x.name)} 생활권 안내</a>`)
    .join("");

  const body = `
${breadcrumbNav(trail)}
<section class="hero"><div class="container hero__inner">
  <span class="eyebrow">${esc(area.name)} · 생활권</span>
  <h1>${esc(l.name)} 출장마사지 생활권 안내</h1>
  <p>${esc(l.character.split(".")[0])}.</p>
  <div class="hero__cta">
    ${parentGus[0] ? `<a class="btn btn--ghost" href="/seoul/${parentGus[0].slug}/">${esc(parentGus[0].name)} 안내</a>` : ""}
    <a class="btn btn--primary" href="#checklist">예약 전 확인</a>
  </div>
</div></section>

<section class="section"><div class="container prose">
  <h2>${esc(l.name)} 생활권 개요</h2>
  <p>${esc(l.character)}</p>

  <h2>포함 행정구</h2>
  <nav class="linklist" style="margin-top:1rem" aria-label="포함 구">${parentGus
    .map((g) => `<a href="/seoul/${g.slug}/">${esc(g.name)} 생활권 안내</a>`)
    .join("")}</nav>

  <h2>가까운 지하철역</h2>
  <ul class="linklist" style="margin-top:1rem">${l.stations.map((s) => `<span class="tag">${esc(s)}</span>`).join("")}</ul>

  <h2>포함 행정동</h2>
  <ul class="linklist" style="margin-top:1rem">${l.dongs.map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</ul>

  <h2>${esc(l.name)} 이용 시 확인할 점</h2>
  <p>${esc(typeGuide[l.type] || typeGuide.residential)}</p>
  <div class="grid grid--3" style="margin-top:1rem">
    <a class="card" href="/seoul/use/home/"><span class="card__title">자택 이용</span><p class="card__meta">공동현관과 건물 출입 방식을 미리 확인합니다.</p></a>
    <a class="card" href="/seoul/use/officetel/"><span class="card__title">오피스텔 이용</span><p class="card__meta">공동현관·엘리베이터 인증과 관리 규정을 확인합니다.</p></a>
    <a class="card" href="/seoul/use/hotel/"><span class="card__title">호텔·숙소 이용</span><p class="card__meta">숙소 방문 정책과 객실 출입 여부를 확인합니다.</p></a>
  </div>

  <h2 id="checklist">예약 전 체크리스트</h2>
  <div style="margin-top:1rem;max-width:720px">${checklistBlock()}</div>
  <div class="notice" style="margin-top:1.25rem">개인정보는 예약 확인과 연락에 필요한 최소 정보만 안내하며, 불법·선정적 서비스는 제공하거나 안내하지 않습니다.</div>

  <h2>자주 묻는 질문</h2>
  <div style="margin-top:1rem;max-width:760px">${faqBlock()}</div>

  <h2>${esc(l.name)} 안내 기준</h2>
  <div style="margin-top:1rem">${whoHowWhy(l.name)}</div>

  <h2>인접 생활권 보기</h2>
  <nav class="linklist" style="margin-top:1rem" aria-label="인접 생활권">
    <a href="/seoul/area/${area.slug}/">${esc(area.name)} 전체 보기</a>
    ${siblings}
  </nav>
</div></section>
`;
  return layout({ title, desc, url, breadcrumb: trail, body, includeFaqSchema: true });
}

/* ------------------------------------------------------------------ */
/* page: use-case /seoul/use/<slug>/                                  */
/* ------------------------------------------------------------------ */
function usePage(u) {
  const url = `/seoul/use/${u.slug}/`;
  const title = `${u.h1} | ${site.brand}`;
  const desc = clamp80(`${u.name} 전 확인할 점과 서울 지역별 기준을 안내합니다.`, url);
  const trail = [
    { name: "서울", path: "/seoul/" },
    { name: "이용 장소", path: "/seoul/use/home/" },
    { name: u.name, path: url },
  ];
  const related = (u.relatedUse || [])
    .map((s) => useBySlug[s])
    .filter(Boolean)
    .map((x) => `<a href="/seoul/use/${x.slug}/">${esc(x.name)} 안내</a>`)
    .join("");

  const body = `
${breadcrumbNav(trail)}
<section class="hero"><div class="container hero__inner">
  <span class="eyebrow">이용 장소 안내</span>
  <h1>${esc(u.h1)}</h1>
  <p>${esc(u.intro.split(".")[0])}.</p>
</div></section>

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
    <a href="/seoul/check/address/">방문 주소 확인</a>
    <a href="/seoul/">서울 전체 지역 안내</a>
  </nav>
</div></section>
`;
  return layout({ title, desc, url, breadcrumb: trail, body, includeFaqSchema: true, forceIndex: true });
}

/* ------------------------------------------------------------------ */
/* page: check /seoul/check/<slug>/                                   */
/* ------------------------------------------------------------------ */
function checkPage(c) {
  const url = `/seoul/check/${c.slug}/`;
  const title = `${c.h1} | ${site.brand}`;
  const desc = clamp80(`${c.name} · 서울 예약 전 확인해야 할 기준을 안내합니다.`, url);
  const trail = [
    { name: "서울", path: "/seoul/" },
    { name: "예약 전 확인", path: "/seoul/check/address/" },
    { name: c.name, path: url },
  ];
  const others = checks
    .filter((x) => x.slug !== c.slug)
    .slice(0, 4)
    .map((x) => `<a href="/seoul/check/${x.slug}/">${esc(x.name)}</a>`)
    .join("");

  const body = `
${breadcrumbNav(trail)}
<section class="hero"><div class="container hero__inner">
  <span class="eyebrow">예약 전 확인</span>
  <h1>${esc(c.h1)}</h1>
  <p>${esc(c.intro.split(".")[0])}.</p>
</div></section>

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
    <a href="/seoul/policy/privacy/">개인정보 처리방침</a>
    <a href="/seoul/policy/service-policy/">불법·선정적 서비스 불가 안내</a>
  </nav>
</div></section>
`;
  return layout({ title, desc, url, breadcrumb: trail, body, includeFaqSchema: true, forceIndex: true });
}

/* ------------------------------------------------------------------ */
/* page: policy /seoul/policy/<slug>/                                 */
/* ------------------------------------------------------------------ */
function policyPage(p) {
  const url = `/seoul/policy/${p.slug}/`;
  const title = `${p.h1} | ${site.brand}`;
  const desc = clamp80(p.desc, url);
  const trail = [
    { name: "서울", path: "/seoul/" },
    { name: "운영 기준", path: "/seoul/policy/privacy/" },
    { name: p.name, path: url },
  ];
  const others = policies
    .filter((x) => x.slug !== p.slug)
    .map((x) => `<a href="/seoul/policy/${x.slug}/">${esc(x.name)}</a>`)
    .join("");

  const body = `
${breadcrumbNav(trail)}
<section class="hero"><div class="container hero__inner">
  <span class="eyebrow">운영 기준</span>
  <h1>${esc(p.h1)}</h1>
  <p>${esc(p.desc)}</p>
</div></section>

<section class="section"><div class="container prose">
  ${p.sections.map((s) => `<h2>${esc(s.h)}</h2><p>${esc(s.p)}</p>`).join("")}

  <h2>관련 안내</h2>
  <nav class="linklist" style="margin-top:1rem" aria-label="관련 안내">
    ${others}
    <a href="/seoul/">서울 전체 지역 안내</a>
  </nav>
</div></section>
`;
  return layout({ title, desc, url, breadcrumb: trail, body, forceIndex: true });
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
  fs.copyFileSync(SRC_CSS, path.join(DIST, "assets", "main.css"));

  // root redirect → /seoul/
  fs.writeFileSync(
    path.join(DIST, "index.html"),
    `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>${esc(site.brand)}</title>
<link rel="canonical" href="${abs("/seoul/")}">
<meta http-equiv="refresh" content="0; url=/seoul/">
<meta name="robots" content="noindex, follow">
</head><body><p><a href="/seoul/">서울 지역 안내로 이동</a></p></body></html>`
  );

  emit("seoul", "/seoul/", mainPage());

  areas.forEach((a) => emit(path.join("seoul", "area", a.slug), `/seoul/area/${a.slug}/`, areaPage(a)));
  districts.forEach((d) => emit(path.join("seoul", d.slug), `/seoul/${d.slug}/`, districtPage(d)));
  lifeAreas.forEach((l) => emit(path.join("seoul", "life", l.slug), `/seoul/life/${l.slug}/`, lifePage(l)));
  useCases.forEach((u) => emit(path.join("seoul", "use", u.slug), `/seoul/use/${u.slug}/`, usePage(u)));
  checks.forEach((c) => emit(path.join("seoul", "check", c.slug), `/seoul/check/${c.slug}/`, checkPage(c)));
  policies.forEach((p) => emit(path.join("seoul", "policy", p.slug), `/seoul/policy/${p.slug}/`, policyPage(p)));

  // sitemap.xml
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
    .map(
      (u) =>
        `  <url><loc>${abs(u)}</loc><changefreq>weekly</changefreq><priority>${u === "/seoul/" ? "1.0" : "0.8"}</priority></url>`
    )
    .join("\n")}
</urlset>`;
  fs.writeFileSync(path.join(DIST, "sitemap.xml"), sitemap);

  // robots.txt
  fs.writeFileSync(
    path.join(DIST, "robots.txt"),
    `User-agent: *\nAllow: /\n\nSitemap: ${abs("/sitemap.xml")}\n`
  );

  console.log(`✔ 빌드 완료: 색인 ${urls.length}개 (+ 루트 리다이렉트)`);
  console.log(
    `  · 메인 1 · 생활권(권역) ${areas.length} · 구 ${districts.length} · 생활권(동네) ${lifeAreas.length} · 이용 장소 ${useCases.length} · 예약 전 확인 ${checks.length} · 운영 기준 ${policies.length}`
  );
  console.log(
    warnings.length ? "\n" + warnings.join("\n") : "  · 모든 meta description 80자 이내 ✓"
  );
  console.log(
    noindexLog.length
      ? `  · 도어웨이 방지 noindex ${noindexLog.length}개: ${noindexLog.join(", ")}`
      : "  · thin-content noindex 대상 없음 ✓"
  );
}

build();
