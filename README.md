# 간다GO · 서울 지역 안내 (정적 사이트)

데이터 기반 정적 HTML 사이트입니다. `data/seoul/*.json`을 읽어 `dist/`에 페이지·sitemap·robots를 생성합니다.

## 구조

```
data/seoul/        콘텐츠 데이터 (JSON) — 여기만 고치면 페이지가 확장됩니다
  site.json        상호·전화·텔레그램·저자 등 전역 설정
  areas.json       5대 생활권
  districts.json   25개 구
  content.json     공통 FAQ·체크리스트·이용 장소
src/styles/main.css  Pretendard 기반 프리미엄 디자인 토큰 + 컴포넌트
scripts/build.js     빌드 스크립트 (data → dist)
dist/                빌드 산출물 (git 미포함)
```

## 빌드 / 미리보기

```bash
npm run build   # dist/ 생성
npm run serve   # http://localhost:4321/seoul/
```

## 현재 범위 (1차 골격)

- 서울 메인 `/seoul/`
- 5대 생활권 `/seoul/area/<slug>/`
- 25개 구 `/seoul/<gu-slug>/`
- `sitemap.xml`, `robots.txt`, 루트 리다이렉트

지시서의 행정동·생활권·역세권·이용 장소·예약 전 확인 상세 페이지는
동일한 데이터 구조로 이어서 추가할 수 있도록 설계되었습니다.

## SEO / 정책 반영

- 모든 페이지 meta description **80자 이내** (빌드 시 자동 검증)
- 스키마: `Organization`, `WebPage`, `BreadcrumbList`, `FAQPage`, `ImageObject`
  - 실제 매장이 없으므로 `LocalBusiness` 미사용
  - 실제 후기 데이터가 없으므로 `Review`/`AggregateRating` 미사용
- canonical, OG/Twitter 메타, breadcrumb 적용
- 내부링크: 상위 생활권 → 구 → 인접 구, 서술형 롱테일 앵커텍스트
  (예: "강남구 생활권 안내", "강남·동남권 생활권 안내")
- Who / How / Why 블록, 예약 전 체크리스트, 불법·선정적 서비스 불가 안내

## ⚠️ 배포 전 교체 필요

`data/seoul/site.json`:

- `siteUrl` — 실제 도메인 (현재 `https://gandago.kr` 플레이스홀더)
- `telegram.url` / `telegram.handle` — **실제 텔레그램 계정** (현재 `@ganda_go` 플레이스홀더)
- `defaultOgImage` — 대표 OG 이미지 경로

값만 바꾸고 `npm run build`를 다시 실행하면 전 페이지에 반영됩니다.
