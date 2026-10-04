# Munder Office (웹)

원본 Munder Difflin처럼 픽셀 오피스 플로어가 보이는 웹 UI입니다. 브라우저 안에서 진짜 리눅스 VM(v86, `../vm`)을 부팅합니다.

- `office.js`: 오피스 타일을 직접 그리는 렌더러. 걸어 다니는 캐릭터와 상태 말풍선(`starting up`, `working`, `awaiting`, `idle`)을 그립니다. LimeZu 타일셋은 쓰지 않습니다.
- `sprites.js`: 원본 `portraitArt.ts`(MIT)를 esbuild로 옮긴 캐릭터 스프라이트
- `app.js`: VM 부팅, 시리얼 터미널(xterm), 9p 파일 공유와 실행 큐, Claude 에이전트(도구: run_command, read_file, write_file, send_message), Michael 위임, 보드
- `index.src.html`: 페이지. `/*XTERM_CSS*/` 자리에 `@xterm/xterm/css/xterm.css`를 넣어 `index.html`을 만듭니다.

게시본에서 VM 이미지는 base64 텍스트(`vm/*.b64.txt`)로 실립니다. 아티팩트가 바이너리 형식을 서비스하지 않기 때문입니다.
