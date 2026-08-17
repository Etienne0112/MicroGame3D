# 🐾 MicroGame3D

3차원 큐브의 규칙을 따라 숨어 있는 고양이를 찾는 브라우저 논리 퍼즐입니다. 별도 빌드나 라이브러리 없이 `index.html`을 열면 바로 실행됩니다.

## 게임 규칙

보드는 `N × N × N` 큐브이며 화면에서는 Z축 층별 보드로 펼쳐서 보여 줍니다.

- 모든 X축 직선에 고양이가 정확히 1마리 있습니다.
- 모든 Y축 직선에 고양이가 정확히 1마리 있습니다.
- 모든 Z축 직선에 고양이가 정확히 1마리 있습니다.
- 같은 색 영역마다 고양이가 정확히 1마리 있습니다.
- 고양이는 대각선을 포함한 26방향 이웃에 붙어 있지 않습니다.

## 조작

- **클릭**: 고양이가 아니라고 생각하는 칸에 🐾 표시
- **드래그**: 지나가는 칸을 같은 상태로 한꺼번에 표시하거나 지우기
- **더블클릭**: 카드를 뒤집어 고양이인지 확인
- **마킹/이동 모드**: 큰 보드에서 드래그의 용도를 전환

## 실행

`index.html`을 직접 열거나 정적 서버를 실행합니다.

```powershell
python -m http.server 8000
```

그다음 브라우저에서 `http://localhost:8000`을 엽니다.

## 화면과 사이트 연결

- Everything of My Workspace 계열의 편집형 그리드 UI를 사용합니다.
- 상단 `SITES` 메뉴에서 MainSite, DesertRose Blog, Study Archive로 이동할 수 있습니다.
- 밝은/어두운 테마는 공용 셸이 관리하며, DesertRose 계열 사이트 사이에서 그대로 이어집니다. 효과음 설정은 기기별로 기억합니다.
- 그래픽과 효과음은 CSS 및 Web Audio로 구성되어 별도 에셋 다운로드가 없습니다.

## 공용 셸

`subsite-shell.css`, `subsite-shell.js`, `scripts/verify-shell.mjs`는 DesertRose 서브사이트 네 레포가
**같은 내용으로 복사해 쓰는 파일**입니다. 원본은 [SiteTemplate](https://github.com/Etienne0112/SiteTemplate) 레포이고,
고칠 때는 그쪽에서 고친 뒤 `npm run sync-shell`로 배포하고 레포마다 따로 커밋합니다.
이 레포에서 직접 고치면 다음 sync 때 덮어써집니다. 계약 내용은 SiteTemplate README를 보세요.

`npm run verify-shell`이 이 레포 안에서 계약이 지켜졌는지 검사하며, `npm run check`에 포함돼 있습니다.

## 구조와 성능

- `core.js`: 3D 좌표, 보드 생성, 축·영역·비인접 규칙 검증
- `game.js`: 입력, 저장, 효과음, 화면 갱신
- `subsite-shell.js` / `subsite-shell.css`: 네 사이트가 공유하는 헤더·SITES 메뉴·테마 토글·푸터 (사본이므로 한 곳을 고치면 나머지도 맞춰야 함)
- `style.css`: 반응형 층별 레이아웃과 보드 상태 표현
- `index.html`: 게임 화면의 의미 구조

카드는 보드를 만들 때 한 번만 생성합니다. 플레이 중에는 바뀐 카드만 갱신하며, 이벤트는 보드 한 곳에서 위임 처리합니다. 축/인접 하이라이트도 전체 `N³` 칸을 검색하지 않고 최대 `3N + 26`칸만 계산합니다.

진행 정보는 기존 `myMeowDoku.save` 키를 그대로 사용하므로 이전 브라우저 저장 데이터와 호환됩니다.

## 검증

```powershell
npm run check
```

9³/16³ 보드의 X·Y·Z 직선, 색 영역, 26방향 비인접 규칙과 화면 입력 계약을 자동으로 확인합니다.
