from __future__ import annotations

import argparse
import json
import sys
import time
import webbrowser
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

EXAMPLE_DIR = Path(__file__).resolve().parent
if str(EXAMPLE_DIR) not in sys.path:
    sys.path.insert(0, str(EXAMPLE_DIR))

from _example_bootstrap import CONFIG_PATH
from sdk.sousaku import SousakuClient


HTML = r"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sousaku Accounts</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #eef3f7;
      --panel: #ffffff;
      --panel-soft: #f5f7f9;
      --text: #172033;
      --muted: #5d6b80;
      --line: #d8e0ea;
      --blue: #1677d2;
      --green: #1dbd66;
      --orange: #f58b1f;
      --red: #df3d3d;
      --shadow: 0 14px 32px rgba(30, 42, 62, .14);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Segoe UI", "Microsoft YaHei", Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    header {
      position: sticky;
      top: 0;
      z-index: 5;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 18px 28px;
      background: rgba(238, 243, 247, .88);
      backdrop-filter: blur(14px);
      border-bottom: 1px solid rgba(216, 224, 234, .7);
    }
    h1 {
      margin: 0;
      font-size: 22px;
      letter-spacing: 0;
    }
    .toolbar {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    button, select {
      height: 38px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      color: var(--text);
      padding: 0 12px;
      font-size: 14px;
      box-shadow: 0 3px 8px rgba(30, 42, 62, .08);
    }
    button.primary {
      color: #fff;
      background: var(--blue);
      border-color: var(--blue);
    }
    main {
      max-width: 1480px;
      margin: 0 auto;
      padding: 24px 28px 40px;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(5, minmax(140px, 1fr));
      gap: 14px;
      margin-bottom: 22px;
    }
    .metric {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px 16px;
      box-shadow: 0 8px 18px rgba(30, 42, 62, .08);
    }
    .metric span {
      display: block;
      color: var(--muted);
      font-size: 13px;
      margin-bottom: 6px;
    }
    .metric strong {
      font-size: 24px;
      letter-spacing: 0;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
      gap: 18px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 18px;
      box-shadow: var(--shadow);
    }
    .card.error { border-color: rgba(223, 61, 61, .4); }
    .top {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin-bottom: 14px;
    }
    .email {
      min-width: 0;
      font-weight: 700;
      font-size: 17px;
      overflow-wrap: anywhere;
    }
    .badge {
      margin-left: auto;
      flex: 0 0 auto;
      color: #fff;
      background: var(--blue);
      border-radius: 999px;
      padding: 4px 9px;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .badge.running { background: var(--orange); }
    .badge.error { background: var(--red); }
    .credits {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      padding: 12px;
      border-radius: 8px;
      background: var(--panel-soft);
      margin-bottom: 14px;
    }
    .credit span, .row span {
      display: block;
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 4px;
    }
    .credit strong {
      font-size: 21px;
      color: var(--green);
    }
    .rows {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px 14px;
      font-size: 14px;
    }
    .row strong {
      display: block;
      overflow-wrap: anywhere;
      font-weight: 600;
    }
    .invite {
      display: flex;
      gap: 8px;
      margin-top: 14px;
      padding-top: 14px;
      border-top: 1px dashed var(--line);
    }
    .invite input {
      min-width: 0;
      flex: 1;
      height: 34px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 0 10px;
      color: var(--muted);
    }
    .status {
      color: var(--muted);
      font-size: 13px;
    }
    .empty {
      padding: 42px;
      text-align: center;
      color: var(--muted);
      border: 1px dashed var(--line);
      border-radius: 8px;
      background: rgba(255, 255, 255, .55);
    }
    @media (max-width: 860px) {
      header { align-items: flex-start; flex-direction: column; }
      .toolbar { margin-left: 0; }
      .summary { grid-template-columns: repeat(2, minmax(140px, 1fr)); }
      main { padding: 18px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Sousaku Accounts</h1>
    <div class="status" id="status">准备加载</div>
    <div class="toolbar">
      <select id="sort">
        <option value="index">按配置顺序</option>
        <option value="credit">按总额度</option>
        <option value="running">按运行状态</option>
      </select>
      <button id="save">保存快照</button>
      <button class="primary" id="refresh">刷新实时额度</button>
    </div>
  </header>
  <main>
    <section class="summary" id="summary"></section>
    <section class="grid" id="grid"></section>
  </main>
  <script>
    let state = { accounts: [], fetched_at: null, duration_ms: 0 };

    const statusEl = document.getElementById("status");
    const summaryEl = document.getElementById("summary");
    const gridEl = document.getElementById("grid");
    const sortEl = document.getElementById("sort");

    document.getElementById("refresh").addEventListener("click", loadAccounts);
    document.getElementById("save").addEventListener("click", saveSnapshot);
    sortEl.addEventListener("change", render);

    async function loadAccounts() {
      statusEl.textContent = "正在请求 Sousaku /v1/user ...";
      const res = await fetch("/api/accounts", { cache: "no-store" });
      state = await res.json();
      render();
    }

    async function saveSnapshot() {
      statusEl.textContent = "正在保存快照...";
      const res = await fetch("/api/save-snapshot", { method: "POST" });
      const data = await res.json();
      statusEl.textContent = data.ok ? `已保存 ${data.count} 个账号到 ${data.path}` : data.error;
    }

    function render() {
      const accounts = [...(state.accounts || [])];
      if (sortEl.value === "credit") {
        accounts.sort((a, b) => safeNum(b.total_credit) - safeNum(a.total_credit));
      } else if (sortEl.value === "running") {
        accounts.sort((a, b) => safeNum(b.running_task_count) - safeNum(a.running_task_count));
      } else {
        accounts.sort((a, b) => safeNum(a.token_index) - safeNum(b.token_index));
      }

      const okAccounts = accounts.filter(a => !a.error);
      const totalCredit = okAccounts.reduce((sum, a) => sum + safeNum(a.total_credit), 0);
      const running = okAccounts.reduce((sum, a) => sum + safeNum(a.running_task_count), 0);
      const errors = accounts.length - okAccounts.length;
      const plus = okAccounts.filter(a => (a.package_level || "").toLowerCase() === "plus").length;

      summaryEl.innerHTML = [
        metric("账号数", accounts.length),
        metric("可用账号", okAccounts.length),
        metric("总额度", totalCredit),
        metric("运行中", running),
        metric("错误", errors || 0),
      ].join("");

      statusEl.textContent = `最后刷新 ${formatTime(state.fetched_at)}，耗时 ${state.duration_ms || 0}ms，Plus ${plus}`;

      if (!accounts.length) {
        gridEl.innerHTML = `<div class="empty">没有读取到 token，请检查 config/sousaku_config.json</div>`;
        return;
      }

      gridEl.innerHTML = accounts.map(card).join("");
      document.querySelectorAll("[data-copy]").forEach(btn => {
        btn.addEventListener("click", async () => {
          await navigator.clipboard.writeText(btn.dataset.copy);
          btn.textContent = "已复制";
          setTimeout(() => btn.textContent = "复制", 900);
        });
      });
    }

    function metric(label, value) {
      return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
    }

    function card(account) {
      const hasError = !!account.error;
      const running = safeNum(account.running_task_count) > 0;
      const badge = hasError ? "error" : running ? "running" : "";
      const badgeText = hasError ? "ERROR" : running ? "RUNNING" : (account.package_level || "OK");
      const email = account.user_email || account.nick_name || account.user_name || account.user_id || account.token_masked || "Unknown";
      const invite = account.share_code ? `https://sousaku.ai/signin?share_code=${account.share_code}` : "";
      return `
        <article class="card ${hasError ? "error" : ""}">
          <div class="top">
            <div class="email">${escapeHtml(account.token_index)}. ${escapeHtml(email)}</div>
            <div class="badge ${badge}">${escapeHtml(badgeText)}</div>
          </div>
          ${hasError ? `<div class="empty">${escapeHtml(account.error)}</div>` : `
            <div class="credits">
              ${credit("总额度", account.total_credit)}
              ${credit("订阅", account.subscription_credit)}
              ${credit("永久", account.permanent_credit)}
            </div>
            <div class="rows">
              ${row("运行中任务", account.running_task_count)}
              ${row("待领取", account.complete_pending_claim_num)}
              ${row("Token", account.token_masked)}
              ${row("套餐", account.package_level)}
              ${row("邀请码", account.share_code)}
              ${row("被邀请码", account.inviter_share_code)}
            </div>
            ${invite ? `<div class="invite"><input readonly value="${escapeAttr(invite)}" /><button data-copy="${escapeAttr(invite)}">复制</button></div>` : ""}
          `}
        </article>
      `;
    }

    function credit(label, value) {
      return `<div class="credit"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value ?? "-")}</strong></div>`;
    }

    function row(label, value) {
      return `<div class="row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value ?? "-")}</strong></div>`;
    }

    function safeNum(value) {
      const number = Number(value);
      return Number.isFinite(number) ? number : 0;
    }

    function formatTime(value) {
      if (!value) return "-";
      return new Date(value).toLocaleString();
    }

    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
      }[c]));
    }

    function escapeAttr(value) {
      return escapeHtml(value).replace(/`/g, "&#96;");
    }

    loadAccounts();
  </script>
</body>
</html>
"""


class DashboardServer(ThreadingHTTPServer):
    def __init__(self, server_address: tuple[str, int], config_path: Path, max_workers: int):
        super().__init__(server_address, DashboardHandler)
        self.config_path = config_path
        self.max_workers = max_workers


class DashboardHandler(BaseHTTPRequestHandler):
    server: DashboardServer

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/":
            self.send_html(HTML)
            return
        if path == "/api/accounts":
            self.send_json(load_account_records(self.server.config_path, self.server.max_workers, include_token=False))
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/save-snapshot":
            payload = load_account_records(self.server.config_path, self.server.max_workers, include_token=True)
            accounts_path = resolve_accounts_path(self.server.config_path)
            accounts_path.parent.mkdir(parents=True, exist_ok=True)
            accounts_path.write_text(
                json.dumps({
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                    "count": len(payload["accounts"]),
                    "accounts": payload["accounts"],
                }, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            self.send_json({"ok": True, "count": len(payload["accounts"]), "path": str(accounts_path)})
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def log_message(self, format: str, *args: Any) -> None:
        return

    def send_html(self, html: str) -> None:
        data = html.encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, payload: dict[str, Any]) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def load_account_records(config_path: Path, max_workers: int, *, include_token: bool = False) -> dict[str, Any]:
    started = time.time()
    base_client = SousakuClient.from_config(str(config_path))
    tokens = list(base_client.tokens)
    records: list[dict[str, Any]] = []

    with ThreadPoolExecutor(max_workers=max(1, min(max_workers, len(tokens) or 1))) as executor:
        futures = {
            executor.submit(fetch_account_record, config_path, token, index, include_token): index
            for index, token in enumerate(tokens)
        }
        for future in as_completed(futures):
            records.append(future.result())

    records.sort(key=lambda item: item.get("token_index", 0))
    return {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "duration_ms": int((time.time() - started) * 1000),
        "config_path": str(config_path),
        "accounts": records,
    }


def fetch_account_record(config_path: Path, token: str, index: int, include_token: bool) -> dict[str, Any]:
    try:
        client = SousakuClient.from_config(str(config_path), tokens=[token])
        record = client.get_account_record(include_token=include_token, include_raw=False)
        record["token_index"] = index
        record["token_masked"] = mask_token(token)
        return record
    except Exception as exc:
        return {
            "token_index": index,
            "token": token if include_token else None,
            "token_masked": mask_token(token),
            "error": str(exc),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }


def resolve_accounts_path(config_path: Path) -> Path:
    config = json.loads(config_path.read_text(encoding="utf-8-sig"))
    accounts_path = Path(config.get("accounts_path") or "sousaku_accounts.json")
    return accounts_path if accounts_path.is_absolute() else config_path.parent / accounts_path


def mask_token(token: str) -> str:
    if len(token) <= 12:
        return "*" * len(token)
    return f"{token[:6]}...{token[-6:]}"


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a local Sousaku account dashboard.")
    parser.add_argument("--config", default=str(CONFIG_PATH), help="Path to sousaku_config.json")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--max-workers", type=int, default=8)
    parser.add_argument("--no-open", action="store_true", help="Do not open browser automatically.")
    args = parser.parse_args()

    config_path = Path(args.config).resolve()
    server = DashboardServer((args.host, args.port), config_path, args.max_workers)
    url = f"http://{args.host}:{args.port}/"
    print(f"Sousaku account dashboard: {url}")
    print(f"config: {config_path}")
    if not args.no_open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
