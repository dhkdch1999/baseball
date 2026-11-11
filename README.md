# 야구 감독 — 문자중계 야구 매니지먼트 (1단계)

OOTP 느낌의 KBO 구단 운영 게임. 경기는 그래픽 없이 문자중계로 진행된다.
빌드 도구 없이 HTML + CSS + JavaScript(ES 모듈)만 사용한다.

## 실행

ES 모듈은 `file://`로 열면 동작하지 않으므로 로컬 서버로 연다.

```bash
python -m http.server 8000
# 브라우저에서 http://localhost:8000
```

GitHub Pages에서는 저장소 루트를 배포하면 그대로 동작한다.

조작: `Space` = 1구, `Enter` = 1타석, "경기 끝까지" = 결과까지 스킵.
같은 **리그 시드 + 경기 시드**면 항상 같은 경기가 나온다.

## 도구 (Node 18+)

```bash
node tools/balance.mjs                 # 1000시즌(72만 경기) 밸런스 테스트, 코어 수만큼 병렬
node tools/balance.mjs --seasons 30    # 빠른 확인 (수 초)
node tools/replay.mjs --away LG --home OB --seed 42   # 터미널 문자중계 + 박스스코어
node tools/replay.mjs --seed 42 --check               # 같은 시드 2회 실행 → 결과 일치 확인
```

밸런스 수치는 `js/sim/log5.js`의 `LEAGUE`(1구 단위)와 `BATTED`(타구) 값으로 조정한다.

## 구조

```
js/core/     rng(시드 난수), util
js/data/     names(성씨·KBO 구단), ratings(20~80 스케일), playerGen, teamGen
js/sim/      log5, pitch(1구 판정), battedBall(타구), baserunning(진루),
             gameState, game(경기 루프·이벤트), aiManager(AI 감독), boxscore
js/ui/       broadcast/(phrases·narrator·feed), scoreboard, pregame
tools/       balance.mjs, replay.mjs
```

`sim/`과 `data/`는 DOM을 쓰지 않으므로 브라우저와 Node에서 같은 코드가 돈다.
엔진은 이벤트만 내보내고, 문장은 `narrator.js`가 만든다.

## 진행 단계

- [x] 1단계: 선수/팀 생성 + 1경기 문자중계
- [ ] 2단계: 감독 작전 개입 + 경기 속도 조절
- [ ] 3단계: 시즌 일정, 순위, 기록 누적, 세이브
- [ ] 4단계: 성장/노쇠, 부상, 계약, FA, 트레이드, 드래프트
- [ ] 5단계: 2군, 재정, 밸런스 조정
