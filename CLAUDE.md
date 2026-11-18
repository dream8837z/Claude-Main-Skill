# 다비오 회의록 작성 프로젝트

다비오(Dabeeo) 전용 회의록 작성 저장소. 회의·세미나·출장 녹취나 메모를 받아 다비오 양식의 회의록을 만든다.

## 폴더 구조
- `context/다비오_회사_브랜드_컨텍스트.md`: 회사 정보, 브랜드 명칭 규칙, 사업 사례 (작성 전 먼저 읽기)
- `context/reference/`: 원본 참고자료 (브랜드 가이드, 발표자료, 원본 회의록 양식 샘플, BI zip)
- `templates/build_minutes.py`: 회의록 JSON → HWPX·DOCX·PDF 생성기
- `templates/양식.json`, `templates/다비오_회의록_양식.*`: 빈 양식
- `회의록/`: 완성본 (HWPX·DOCX·PDF), `회의록/_source/`: 회의별 원본 JSON

## 작성 절차
1. 원문을 받으면 `회의록/_source/YYYYMMDD_<짧은이름>.json`을 `templates/양식.json` 구조로 작성
2. `python3 templates/build_minutes.py 회의록/_source/<파일>.json 회의록` 실행
3. PDF를 열어 레이아웃 확인 후 세 파일 전달, 커밋·푸시

## 출력 규칙
- 출력 형식은 **HWPX, DOCX, PDF만**. HTML·PNG 등 다른 형식으로 출력하지 않는다.
- 파일명: `[다비오] 행사명_주제명_부서명_작성자명_YYMMDD`
  - 기본 부서·작성자: `영업3팀_요셉`
  - 주제명에 콜론(:) 등 파일명 금지 문자가 있으면 그 앞부분만 쓴다.

## 양식 (원본: `context/reference/회의록양식_원본샘플_hwpx기반_260702.pdf`)
- 상단 dabeeo 로고 + "MEETING MINUTES", 제목 "회 의 록"
- 2열 표: 회의주제 / 회의일자 / 회의장소 / 참석자(내부) / 참석자(외부) / 내용 / 특이사항
- 내용: "주요 내용" 요약 → 번호 붙인 안건 → 소제목 → `·` 글머리
- 하단: Dabeeo is an Earth Intelligence Company. / 사내 공유용
- 글꼴: Pretendard (`templates/fonts/`). 본문 Pretendard Medium, 굵은 글씨 Pretendard Bold (Regular 파일 미보유). PDF 빌드 전 `~/.local/share/fonts`에 설치 후 `fc-cache -f`
- 회의장소·내부 참석자 등 원문에 없는 정보는 "(확인 필요)"로 두고 사용자에게 확인
- 향후 조치는 원문에 조치·담당이 있을 때만 넣는다 (세미나 참관 기록에는 넣지 않음).

## 내용 원칙
- 원문 내용을 축약하지 않는다. 수치·사례·질의응답을 빠짐없이 개조식으로 옮긴다.
- 원문에 없는 해석·평가를 추가하지 않는다. 특이사항도 원문에 있는 사실만 쓴다.
- 녹취의 명백한 오기는 고친다 (예: 팬셔클링→팬샤프닝, 네옴 GT→네옴시티, 타르그 섬→하르그 섬).
- 불확실한 표기는 원문대로 유지한다.
- 참석자(외부)는 이름이 밝혀진 발표자·귀빈만 쓰고 나머지는 "외"로 표기한다.
- 다비오 명칭은 `context/다비오_회사_브랜드_컨텍스트.md`의 브랜드 규칙을 따른다.
