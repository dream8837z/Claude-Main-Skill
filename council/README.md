# AI Council — 로그인 계정으로 여러 AI가 토론해 최적의 답을 내는 도구

> 처음이거나 개발자가 아니라면 **[GUIDE.md](GUIDE.md)** (쉬운 가이드)부터 보세요.

API 키 없이, 각 회사의 **공식 CLI에 로그인한 계정**(Claude Code, Gemini CLI, Codex CLI)을 그대로 호출합니다.
Python 표준 라이브러리만 사용합니다.

## 동작 방식
1. **초안**: 모든 모델이 같은 과제에 독립적으로 답합니다(병렬).
2. **토론**(N라운드): 각 모델이 다른 모델의 답을 *익명*(Answer A/B…)으로 보고 비판한 뒤 자기 답을 고칩니다.
3. **투표**: 각 모델이 최종 답들의 순위를 매기고 Borda 점수로 합산합니다. 자기 답에 준 표는 제외합니다.
4. **종합**: 심판 모델이 1위 답을 바탕으로 다른 답의 옳은 부분을 합치고, 남은 이견을 따로 적습니다.

전체 과정은 `runs/council-날짜.md`에 기록됩니다.

## 준비 (한 번만)
| 모델 | 설치 | 로그인 |
|---|---|---|
| Claude | `npm i -g @anthropic-ai/claude-code` | `claude` 실행 후 Pro/Max 계정으로 로그인 |
| Gemini | `npm i -g @google/gemini-cli` | `gemini` 실행 후 Google 로그인 |
| GPT | `npm i -g @openai/codex` | `codex login` (ChatGPT 계정) |

설치되지 않은 CLI는 자동으로 건너뜁니다. 두 개 이상 있어야 토론과 투표가 일어납니다.

## 사용
```bash
python3 council.py "이 함수의 버그를 찾아 고쳐줘: ..."
python3 council.py -f task.md -r 3        # 파일 입력, 토론 3라운드
cat task.md | python3 council.py          # 표준입력
```

## 휴대폰에서 쓰기
```bash
python3 web.py        # 또는 start-windows.bat / start-mac.command 더블클릭
```
화면에 나온 `http://PC주소:8787/?t=접속코드`를 같은 와이파이의 휴대폰 브라우저에서 엽니다.
`?t=` 접속코드가 없으면 403으로 막힙니다. 한 번에 토론 하나만 진행합니다.

## 설정 (`council.config.json`)
- `models.<이름>.cmd`: 실행할 명령입니다. `{prompt}` 자리에 프롬프트가 들어가고, `"stdin": true`면 표준입력으로 전달합니다.
- `rounds`, `timeout_sec`, `judge`(종합 담당 모델)를 정할 수 있습니다.
- 다른 CLI(예: `ollama run llama3 {prompt}`)도 같은 형식으로 추가할 수 있습니다.

## 주의
- 각 모델의 구독 사용량을 씁니다. 3개 모델, 2라운드면 호출이 약 13회 발생합니다.
- 공식 CLI를 본인이 직접 실행하는 방식이지만, 자동화 사용에 대한 각 서비스 약관은 직접 확인하세요.
- gemini와 codex의 명령 플래그는 버전마다 다를 수 있습니다. 동작하지 않으면 `cmd`를 수정하세요.

## 테스트 (오프라인)
```bash
python3 council.py -c tests/fake.config.json "test"
```
