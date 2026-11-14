#!/usr/bin/env python3
"""AI Council: logged-in CLI models (Claude Code, Gemini CLI, Codex CLI ...) debate and converge.

No API keys. Each model is called through its official CLI, which uses the account
you logged into (`claude`, `gemini`, `codex login`). Python stdlib only.

Pipeline
  1. draft    : every model answers independently (in parallel)
  2. debate   : N rounds; each model sees peers' answers anonymised (Answer A/B/...),
                critiques them and writes an improved answer
  3. vote     : every model ranks the final answers (Borda count, own answer excluded)
  4. synthesis: the judge model merges the winner with the best points of the others
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import datetime as dt
import json
import pathlib
import re
import shutil
import string
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
ARG_LIMIT = 100_000  # Linux caps a single argv string at 128 KiB

DRAFT = """You are one member of a council of AI models solving the same task.
Answer the task as well as you can. Be concrete and correct; state assumptions.

# Task
{task}
"""

DEBATE = """You are one member of a council of AI models. Round {round} of {rounds}.

# Task
{task}

# Your previous answer
{own}

# Other members' answers (anonymised)
{peers}

Instructions:
1. Critique: list factual errors, gaps or weaker reasoning in the other answers AND in your own.
2. Keep what is right in yours; adopt better points from the others; do not agree just to agree.
3. Output in exactly this format:
## Critique
...
## Revised answer
...
"""

VOTE = """You are judging candidate answers to a task. Rank them from best to worst
on correctness, completeness and usefulness.

# Task
{task}

# Candidates
{cands}

Reply with ONE line only, the letters best-first, e.g.: RANKING: B, A, C
"""

SYNTH = """You are the final editor of an AI council. Produce the single best answer.

# Task
{task}

# Vote result (best first): {order}

# Candidates
{cands}

Use the top-ranked answer as the base, merge in correct points the others add,
drop anything that was refuted. Then add a short section "## Remaining disagreements"
(write "None" if none). Output only the final answer.
"""


def load_config(path: pathlib.Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def available(models: dict) -> dict:
    """Keep enabled models whose executable exists on PATH."""
    out = {}
    for name, m in models.items():
        if not m.get("enabled", True):
            continue
        if shutil.which(m["cmd"][0]) is None:
            print(f"[skip] {name}: '{m['cmd'][0]}' not found on PATH", file=sys.stderr)
            continue
        out[name] = m
    return out


def call(name: str, m: dict, prompt: str, timeout: int) -> str:
    use_stdin = m.get("stdin", False)
    if not use_stdin and len(prompt) > ARG_LIMIT:
        use_stdin = True  # too long for argv
    cmd = [a for a in m["cmd"] if not (use_stdin and a == "{prompt}")]
    if not use_stdin:
        cmd = [prompt if a == "{prompt}" else a for a in cmd]
    try:
        r = subprocess.run(cmd, input=prompt if use_stdin else None, capture_output=True,
                           text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return f"[ERROR {name}: timed out after {timeout}s]"
    if r.returncode != 0:
        return f"[ERROR {name}: exit {r.returncode}] {r.stderr.strip()[-500:]}"
    return r.stdout.strip() or f"[ERROR {name}: empty output]"


def ok(text: str) -> bool:
    return not text.startswith("[ERROR")


def parallel(jobs: dict, timeout: int) -> dict:
    """jobs: {name: (model_cfg, prompt)} -> {name: output}"""
    with cf.ThreadPoolExecutor(max_workers=max(1, len(jobs))) as ex:
        futs = {n: ex.submit(call, n, m, p, timeout) for n, (m, p) in jobs.items()}
        return {n: f.result() for n, f in futs.items()}


def letters(names: list[str]) -> dict:
    return {n: string.ascii_uppercase[i] for i, n in enumerate(names)}


def block(items: dict, label: dict) -> str:
    return "\n\n".join(f"### Answer {label[n]}\n{t}" for n, t in items.items())


def revised(text: str) -> str:
    m = re.search(r"##\s*Revised answer\s*\n(.*)", text, re.S | re.I)
    return m.group(1).strip() if m else text


def parse_rank(text: str, valid: set[str]) -> list[str]:
    m = re.search(r"RANKING:\s*([A-Z ,>]+)", text.upper())
    seq = re.findall(r"[A-Z]", m.group(1)) if m else []
    seen = []
    for c in seq:
        if c in valid and c not in seen:
            seen.append(c)
    return seen


def run(task: str, cfg: dict, rounds: int, log) -> str:
    models = available(cfg["models"])
    timeout = cfg.get("timeout_sec", 600)
    if not models:
        sys.exit("No usable model CLI found. Install/log in to at least one (see README).")
    log(f"# AI Council run\n\n**Members:** {', '.join(models)}\n\n## Task\n{task}\n")

    # 1. draft
    answers = parallel({n: (m, DRAFT.format(task=task)) for n, m in models.items()}, timeout)
    answers = {n: a for n, a in answers.items() if ok(a) or log(f"\n> {a}\n")}
    for n, a in answers.items():
        log(f"\n## Draft - {n}\n{a}\n")
    if not answers:
        sys.exit("Every model failed in the draft round; see the transcript.")

    # 2. debate (skipped automatically with a single member)
    if len(answers) > 1:
        for r in range(1, rounds + 1):
            jobs = {}
            for n in answers:
                peers = {p: a for p, a in answers.items() if p != n}
                jobs[n] = (models[n], DEBATE.format(round=r, rounds=rounds, task=task, own=answers[n],
                                                    peers=block(peers, letters(list(peers)))))
            out = parallel(jobs, timeout)
            for n, t in out.items():
                log(f"\n## Round {r} - {n}\n{t}\n")
                if ok(t):
                    answers[n] = revised(t)

    # 3. vote (anonymised, own answer excluded via Borda over the others)
    names = list(answers)
    label = letters(names)
    inv = {v: k for k, v in label.items()}
    score = {n: 0 for n in names}
    if len(names) > 1:
        vote_out = parallel({n: (models[n], VOTE.format(task=task, cands=block(answers, label)))
                             for n in names}, timeout)
        for voter, t in vote_out.items():
            rank = [c for c in parse_rank(t, set(inv)) if inv[c] != voter]
            log(f"\n- vote by {voter}: {', '.join(inv[c] for c in rank) or '(unparsed)'}")
            for i, c in enumerate(rank):
                score[inv[c]] += len(rank) - i
    order = sorted(names, key=lambda n: -score[n])
    log(f"\n\n**Borda scores:** {score}\n")

    # 4. synthesis
    judge = cfg.get("judge") or order[0]
    judge = judge if judge in models else order[0]
    final = call(judge, models[judge], SYNTH.format(
        task=task, order=", ".join(f"Answer {label[n]}" for n in order),
        cands=block({n: answers[n] for n in order}, label)), timeout)
    if not ok(final):
        log(f"\n> synthesis failed: {final}\n")
        final = answers[order[0]]
    log(f"\n## Final answer (judge: {judge})\n{final}\n")
    return final


def main() -> None:
    ap = argparse.ArgumentParser(description="Make logged-in AI CLIs debate and converge.")
    ap.add_argument("task", nargs="?", help="task text (or use --file / stdin)")
    ap.add_argument("-f", "--file", help="read task from a file")
    ap.add_argument("-r", "--rounds", type=int, default=None, help="debate rounds (default from config)")
    ap.add_argument("-c", "--config", default=str(HERE / "council.config.json"))
    ap.add_argument("-o", "--out", default=str(HERE / "runs"), help="transcript directory")
    a = ap.parse_args()

    task = (pathlib.Path(a.file).read_text(encoding="utf-8") if a.file
            else a.task or (sys.stdin.read() if not sys.stdin.isatty() else ""))
    if not task.strip():
        ap.error("no task given")
    cfg = load_config(pathlib.Path(a.config))
    rounds = a.rounds if a.rounds is not None else cfg.get("rounds", 2)

    outdir = pathlib.Path(a.out)
    outdir.mkdir(parents=True, exist_ok=True)
    path = outdir / f"council-{dt.datetime.now():%Y%m%d-%H%M%S}.md"
    with path.open("w", encoding="utf-8") as fh:
        def log(s: str) -> None:
            fh.write(s)
            fh.flush()
        final = run(task, cfg, rounds, log)
    print(final)
    print(f"\n[transcript] {path}", file=sys.stderr)


if __name__ == "__main__":
    main()
