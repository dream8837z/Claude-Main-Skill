# 인수인계: 다비오 회의록 작성 프로젝트

작성일 2026-11-19. 이 문서와 `CLAUDE.md`를 먼저 읽고 시작한다.

## 1. 프로젝트 목적
다비오(Dabeeo) 영업3팀 요셉의 회의·세미나·설명회 녹취(주로 Tiro 출력)나 메모를 받아, 다비오 양식 회의록을 **HWPX·DOCX·PDF** 세 형식으로 만든다.

- 저장소: `dream8837z/Claude-Main-Skill`, 작업 브랜치 `claude/epic-planck-8r17fo`, 초안 PR #3
- 규칙 원문: `CLAUDE.md` (출력·파일명·양식·내용 원칙). 규칙이 이 문서와 다르면 `CLAUDE.md`가 우선한다.

## 2. 폴더 구조
| 경로 | 내용 |
|---|---|
| `CLAUDE.md` | 작업 규칙 (반드시 준수) |
| `context/다비오_회사_브랜드_컨텍스트.md` | 회사 개요, 새 브랜드 명칭표, 사업 사례 |
| `context/reference/` | 원본 자료: 리브랜딩 가이드 PDF, 국방 GeoAI 발표자료 PDF, 회의록 양식 원본 샘플 PDF, product_BI.zip |
| `templates/build_minutes.py` | JSON → DOCX·HWPX·PDF 생성기 |
| `templates/양식.json` | 회의록 JSON 구조 예시(빈 양식) |
| `templates/다비오_회의록_양식.*` | 빈 양식 완성본 |
| `templates/dabeeo_logo.png` | BI zip의 DID_h.png에서 잘라낸 dabeeo 워드마크 |
| `templates/fonts/` | Pretendard 8종 (Regular 없음) |
| `회의록/` | 완성본, `회의록/_source/` 회의별 JSON |

## 3. 작업 방법
```bash
# 1) 글꼴 설치 (컨테이너가 새로 뜨면 매번)
mkdir -p ~/.local/share/fonts && cp templates/fonts/*.otf ~/.local/share/fonts/ && fc-cache -f

# 2) 원문 → 회의록/_source/YYYYMMDD_<짧은이름>.json 작성 (templates/양식.json 구조)

# 3) 빌드
python3 templates/build_minutes.py 회의록/_source/<파일>.json 회의록

# 4) PDF를 열어 레이아웃 확인 → 세 파일 전달 → 커밋·푸시
```
- 필요 도구: Python 3 + `python-docx`, LibreOffice(`soffice`, PDF 변환용)
- JSON 구조: `file_name`, `meta`(회의주제·회의일자·회의장소·참석자(내부)·참석자(외부)), `sections`[{`title`, `subs`[{`title` 또는 null, `lines`[...]}]}], `notes`[...]
- 파일명이 바뀌면 이전 이름의 세 파일을 `git rm`으로 지운다.

## 4. 사용자 선호 (대화에서 확정된 것)
- 출력은 HWPX·DOCX·PDF만. HTML·PNG 출력 금지
- 파일명 `[다비오] 행사명_주제명_부서명_작성자명_YYMMDD`, 기본 `영업3팀_요셉`
- **원문을 축약하지 않는다.** 한 번 너무 줄였다가 지적받음. 수치·사례·질의응답을 모두 옮긴다.
- 원문에 없는 해석·평가 금지. 특이사항에 다비오 관점 분석을 넣었다가 지적받아 삭제함
- 명백한 녹취 오기만 수정, 불확실한 표기는 원문대로 유지
- 세미나·설명회 참관 기록에는 "향후 조치"를 넣지 않는다
- 질의응답에 질문자 소속·이름을 넣지 않는다 (사용자가 요청할 때만)
- 장소·내부 참석자·일시가 원문에 없으면 "(확인 필요)"로 두고 물어본다
- 사용자 개인 선호: 결과물마다 자가평가 채점표(①~⑥, 총점, 게이트, 프롬프트 튜닝, 개선 1가지)를 붙인다

## 5. 완료된 회의록
| 날짜 | 회의 | JSON |
|---|---|---|
| 2026-11-17 | 제27회 군·지형정보발전 세미나 (한국과학기술정보연구원 대전본원), 내부 J Park·David·Albert·Bryan·Kai·Joseph | `회의록/_source/20261117_세미나.json` |
| 2026-11-18 | 국기연 2027년 실증시험 지원사업 후보과제 공모 설명회 (영등포역 대회의실, 14:00~17:00), 내부 루카·윌·딘·요셉, 외부 "국기연 관계자 외" | `회의록/_source/20261118_실증시험지원사업설명회.json` |

## 6. 미해결 사항
- **HWPX 검증 안 됨**: 이 환경에 한글 프로그램이 없고 라이브러리 설치가 막혀, OWPML 구조를 직접 작성했다. XML 형식 검사만 통과했다. 사용자가 한글에서 열어 본 결과를 아직 받지 못함. 깨지면 `build_minutes.py`의 `_header`/`_section`/`_pic`/`_tbl`을 고친다.
- **Pretendard Regular 없음**: 본문은 Medium, 굵은 글씨는 Bold로 지정. Regular를 받으면 `FONT_REG`를 바꾼다. 받는 PC에 Pretendard가 없으면 대체 글꼴로 보인다.
- **11/18 회의록 파일명의 주제명** "사업현황 및 공고 설명"은 임의로 정한 것. 사용자 확인 대기 중.
- **11/18 회의록의 불확실 표기**(원문 유지): R&CS, 포구 출석 지침기, 불절 조총 조준경, 검형장비 등
- **11/17 회의록의 불확실 표기**(원문 유지): 지정여단, K3, MTP·GPT·Change Titan, Operation Jailbreak 1.5, AI for Planet

## 7. 주의
- 새 브랜드 규칙상 새 자료에 Eartheye·Labelbox 등 구 명칭을 쓰지 않는다. BI zip의 제품 로고는 구 명칭이라 사용 금지
- 회의록은 사내 공유용 자료다. 외부 서비스에 올리지 않는다.
