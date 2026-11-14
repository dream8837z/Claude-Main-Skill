#!/usr/bin/env python3
"""AI Council mobile web UI.

Run this on the PC where the AI CLIs are logged in, then open the printed address
on your phone (same Wi-Fi). The phone only sends the question and shows the result;
the PC does the work. Python stdlib only.
"""
from __future__ import annotations

import argparse
import html
import json
import pathlib
import secrets
import socket
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import council

JOBS: dict[str, dict] = {}
LOCK = threading.Lock()
TOKEN = ""
CFG: dict = {}

PAGE = """<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Council</title>
<style>
:root{--bg:#f6f6f4;--fg:#1d1d1b;--card:#fff;--muted:#6b6b66;--acc:#2f5bd3;--bd:#deded8}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ececea;--card:#22221f;--muted:#a3a39c;--acc:#7c9cf0;--bd:#3a3a36}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif}
main{max-width:720px;margin:0 auto;padding:16px}
h1{font-size:1.3rem;margin:.2em 0 .1em}p.sub{color:var(--muted);margin:0 0 14px;font-size:.9rem}
textarea{width:100%;min-height:140px;padding:12px;border:1px solid var(--bd);border-radius:12px;background:var(--card);color:var(--fg);font:inherit}
.row{display:flex;gap:8px;align-items:center;margin:10px 0 18px;flex-wrap:wrap}
select,button{font:inherit;padding:12px 14px;border-radius:12px;border:1px solid var(--bd);background:var(--card);color:var(--fg)}
button{background:var(--acc);color:#fff;border:0;flex:1;min-width:140px;font-weight:600}
button:disabled{opacity:.5}
.card{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:14px;margin-bottom:12px;white-space:pre-wrap;word-break:break-word}
.status{color:var(--muted);font-size:.9rem;margin-bottom:8px}
details summary{cursor:pointer;color:var(--muted);margin:8px 0}
</style></head><body><main>
<h1>AI Council</h1>
<p class="sub">여러 AI가 토론해서 가장 좋은 답을 만듭니다. 참여 모델: __MEMBERS__</p>
<textarea id="q" placeholder="질문이나 과제를 입력하세요"></textarea>
<div class="row">
 <label>토론 횟수 <select id="r"><option>0</option><option>1</option><option selected>2</option><option>3</option></select></label>
 <button id="go">토론 시작</button>
</div>
<div id="st" class="status"></div>
<div id="final"></div>
<details><summary>토론 전체 과정 보기</summary><div id="log" class="card"></div></details>
<script>
const T=new URLSearchParams(location.search).get('t')||'';
const $=id=>document.getElementById(id);let timer;
async function api(p,opt={}){opt.headers={'X-Token':T,'Content-Type':'application/json'};const r=await fetch(p,opt);if(!r.ok)throw new Error(await r.text());return r.json()}
$('go').onclick=async()=>{
 const task=$('q').value.trim(); if(!task) return;
 $('go').disabled=true;$('final').innerHTML='';$('log').textContent='';$('st').textContent='시작하는 중... (몇 분 걸릴 수 있어요. 화면을 꺼도 PC에서는 계속 진행됩니다)';
 try{const j=await api('/api/run',{method:'POST',body:JSON.stringify({task,rounds:+$('r').value})});
  localStorage.setItem('job',j.id);poll(j.id)}catch(e){$('st').textContent='오류: '+e.message;$('go').disabled=false}
};
function poll(id){clearInterval(timer);timer=setInterval(async()=>{
 try{const j=await api('/api/job/'+id);$('log').textContent=j.log;
  if(j.state==='running'){$('st').textContent='진행 중... '+j.stage}
  else{clearInterval(timer);$('go').disabled=false;
   if(j.state==='done'){$('st').textContent='완료';const d=document.createElement('div');d.className='card';d.textContent=j.final;$('final').appendChild(d)}
   else $('st').textContent='실패: '+j.error}
 }catch(e){$('st').textContent='PC와 연결이 끊겼어요. PC가 켜져 있는지 확인하세요.'}},3000)}
const last=localStorage.getItem('job'); if(last) poll(last);
</script></main></body></html>"""


def lan_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))  # no packet is sent
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def worker(job_id: str, task: str, rounds: int) -> None:
    job = JOBS[job_id]

    def log(s: str) -> None:
        with LOCK:
            job["log"] += s
            if s.startswith("\n## "):
                job["stage"] = s.strip().lstrip("# ").split("\n")[0]

    try:
        job["final"] = council.run(task, CFG, rounds, log)
        job["state"] = "done"
    except SystemExit as e:  # council.run exits on fatal errors
        job["state"], job["error"] = "error", str(e)
    except Exception as e:  # noqa: BLE001 - surface anything to the phone
        job["state"], job["error"] = "error", f"{type(e).__name__}: {e}"


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: str, ctype: str = "application/json") -> None:
        data = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", f"{ctype}; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _authed(self) -> bool:
        if secrets.compare_digest(self.headers.get("X-Token", ""), TOKEN):
            return True
        self._send(403, '"wrong token: use the full address printed on the PC"')
        return False

    def do_GET(self) -> None:
        url = urlparse(self.path)
        if url.path == "/":
            t = parse_qs(url.query).get("t", [""])[0]
            if not secrets.compare_digest(t, TOKEN):
                return self._send(403, "주소가 올바르지 않습니다. PC 화면에 표시된 주소 전체를 입력하세요.",
                                  "text/plain")
            members = ", ".join(council.available(CFG["models"])) or "(없음 - PC에서 AI 로그인 필요)"
            return self._send(200, PAGE.replace("__MEMBERS__", html.escape(members)), "text/html")
        if url.path.startswith("/api/job/") and self._authed():
            job = JOBS.get(url.path.rsplit("/", 1)[-1])
            if not job:
                return self._send(404, '"no such job"')
            with LOCK:
                return self._send(200, json.dumps(job, ensure_ascii=False))
        if not url.path.startswith("/api/"):
            self._send(404, '"not found"')

    def do_POST(self) -> None:
        if self.path != "/api/run" or not self._authed():
            return
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            task = str(body["task"]).strip()
            rounds = max(0, min(5, int(body.get("rounds", 2))))
        except (ValueError, KeyError):
            return self._send(400, '"bad request"')
        if not task:
            return self._send(400, '"empty task"')
        if any(j["state"] == "running" for j in JOBS.values()):
            return self._send(409, '"이미 진행 중인 토론이 있어요. 끝난 뒤 다시 시도하세요."')
        job_id = uuid.uuid4().hex[:12]
        JOBS[job_id] = {"state": "running", "stage": "초안 작성", "log": "", "final": "", "error": ""}
        threading.Thread(target=worker, args=(job_id, task, rounds), daemon=True).start()
        self._send(200, json.dumps({"id": job_id}))

    def log_message(self, *args) -> None:  # keep the console quiet
        pass


def main() -> None:
    global TOKEN, CFG
    ap = argparse.ArgumentParser(description="AI Council mobile web UI")
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--host", default="0.0.0.0", help="0.0.0.0 = reachable from phones on the same Wi-Fi")
    ap.add_argument("-c", "--config", default=str(council.HERE / "council.config.json"))
    ap.add_argument("--token", default=None, help="fixed access code (default: random each start)")
    a = ap.parse_args()
    CFG = council.load_config(pathlib.Path(a.config))
    TOKEN = a.token or secrets.token_urlsafe(8)
    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    print("\n  AI Council 모바일 화면이 켜졌습니다.")
    print(f"  휴대폰(같은 와이파이)에서 이 주소를 여세요:\n\n    http://{lan_ip()}:{a.port}/?t={TOKEN}\n")
    print("  끄려면 이 창에서 Ctrl+C 를 누르세요.\n")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
