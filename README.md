# 야구 감독 — KBO 구단 운영 시뮬레이션

OOTP 느낌의 KBO 구단 운영 게임. 구단 하나를 맡아 시즌을 치르고, 선수를 키우고, FA·트레이드·드래프트로 팀을 만든다.
경기는 그래픽 없이 1구 단위 문자중계로 진행된다. 빌드 도구 없이 HTML + CSS + JavaScript(ES 모듈)만 사용.

## 실행

```bash
python -m http.server 8000      # 브라우저에서 http://localhost:8000
```

ES 모듈이라 `file://`로는 열리지 않는다. GitHub Pages에서는 저장소 루트를 배포하면 그대로 동작한다.

## 할 수 있는 것

- **구단 선택**: KBO 10개 구단 중 하나
- **선수단 모드**: 실제 KBO 선수단(2026 시즌 기록 → 능력치 변환) 또는 랜덤 선수단(전력 평준화)
- **경기 중계**: 1구 / 1타석 / 1이닝 / 끝까지, 자동 재생(속도 4단계), 승부처 자동 정지
- **감독 작전**: 도루, 번트, 히트앤런, 대타, 대주자, 고의사구, 투수 교체, 수비 시프트(당겨치기·전진수비).
  "AI 코치 자동 운영"을 끄면 투수 교체도 직접 해야 한다
- **로스터**: 타순·수비 위치, 선발 로테이션, 마무리·셋업, 1군(최대 28)/2군 이동, 방출.
  AI 코치 자동 관리 모드를 켜면 매 경기 최적 라인업
- **시즌**: 144경기(상대별 16경기, 2연전, 월요일 휴식), 순위·게임차·연승, 개인 기록 순위, 간이 WAR
- **포스트시즌**: 와일드카드(4위 1승 어드밴티지) → 준PO(5전3선승) → PO(5전3선승) → 한국시리즈(7전4선승)
- **선수 상태**: 부상(일수), 투수 피로(선발은 4~5일 휴식), 컨디션
- **오프시즌**: 시상(MVP·최고 투수·신인왕) → 성장/노쇠·은퇴·재계약 → FA 시장 → 신인 드래프트(5라운드) → 새 시즌
- **트레이드**: AI 구단이 나이·잠재력·계약을 평가해 수락/거절 (정규시즌 100일차가 마감)
- **저장**: 슬롯 3개(자동 저장) + JSON 내보내기/불러오기

## 실제 선수 데이터

`js/data/kbo2026.js`: 2026 KBO 정규시즌 기록 (Daum 스포츠 기록실, 2026-11-11 수집).
타자는 타석 순 상위 200명, 투수는 이닝 순 상위 200명. 세부 수비 위치는 `js/data/realRoster.js`에서 지정·추정한다.
능력치는 표본 크기만큼 리그 평균 쪽으로 보정한 비율 기록(타율·ISO·볼넷%·삼진%·도루 시도, 투수 탈삼진%·볼넷%·피홈런율)으로 정한다.

## 도구 (Node 18+)

```bash
node tools/balance.mjs                    # 1000시즌 밸런스 테스트 (실제 커리어 모드 조건, 병렬)
node tools/balance.mjs --seasons 30       # 빠른 확인
node tools/career-test.mjs --seasons 5    # 여러 시즌 연속 진행 + 불변 조건 검사 (--real: 실제 선수단)
node tools/real-check.mjs --seasons 3     # 실제 선수단 시뮬 기록 vs 2026 실제 기록 비교
node tools/parity.mjs --leagues 12        # 구단 간 승률 격차 점검
node tools/replay.mjs --away LG --home OB --seed 42   # 터미널 문자중계
node tools/replay.mjs --seed 42 --check               # 시드 재현성 확인
```

밸런스 수치는 `js/sim/log5.js`의 `LEAGUE`(1구 단위)와 `BATTED`(타구)에 모여 있다.
여러 시즌을 진행해도 리그 환경이 흐르지 않도록 오프시즌마다 능력치 평균·분산을 기준값 쪽으로 되돌린다 (`league/offseason.js`의 `normalizeRatings`).

## 구조

```
js/core/      rng(시드 난수), util
js/data/      names(KBO 구단), ratings(20~80 스케일), playerGen(선수·계약·유망주), teamGen(리그·뎁스차트)
js/sim/       log5, pitch, battedBall, baserunning(번트·히트앤런 포함), gameState, game(경기 루프·작전 큐), aiManager, boxscore
js/league/    schedule, standings, stats(WAR·순위), postseason, season(하루 진행·부상·피로), roster,
              offseason(성장·FA·드래프트), trade, career(진행 오케스트레이션)
js/save/      storage(localStorage 슬롯 + JSON)
js/ui/        app(라우터), common, scoreboard, broadcast/(문구·내레이터·피드), views/(화면별)
tools/        balance.mjs, career-test.mjs, replay.mjs
```

`sim/`, `data/`, `league/`는 DOM을 쓰지 않아 브라우저와 Node에서 같은 코드가 돈다.

## 진행 단계

- [x] 1단계: 선수/팀 생성 + 1경기 문자중계
- [x] 2단계: 감독 작전 개입 + 경기 속도 조절
- [x] 3단계: 시즌 일정, 순위, 기록 누적, 세이브
- [x] 4단계: 성장/노쇠, 부상, 계약, FA, 트레이드, 드래프트
- [ ] 5단계: 2군 경기(퓨처스리그), 재정(관중 수입, 연봉 총액 관리), 밸런스 조정
