# 멍백홈 로컬 서버 — Python 표준 라이브러리만 사용 (추가 설치 불필요, qrcode는 선택)
# 실행:  py server.py   →  http://localhost:8000
import json
import os
import threading
import io
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
DB_PATH = ROOT / "data.json"
LOCK = threading.Lock()
PORT = int(os.environ.get("PORT", 8000))  # 배포 플랫폼(Render 등)이 PORT를 지정함

try:
    import qrcode
    import qrcode.image.svg
    HAS_QR = True
except ImportError:
    HAS_QR = False

SEED = {
    "notice": {
        "slug": "kong-i",
        "dogName": "콩이",
        "breed": "말티즈 (흰색)",
        "age": "7살",
        "weight": "4.2kg",
        "personality": "겁이 많음",
        "health": "심장약 복용 중",
        "caution": "콩이는 겁이 많아 쫓아가면 더 도망갈 수 있습니다. 잡으려 하지 말고 위치와 사진만 제보해주세요.",
        "lostAt": "2026-07-20T16:30",
        "lostPlace": "노원구 중계근린공원 입구",
        "lostX": 352, "lostY": 196,
        "status": "찾는 중",
    },
    "reports": [
        {"id": 1, "seenAt": "17:10", "receivedAt": "17:24", "place": "GS25 중계점 편의점 앞",
         "dir": "남동쪽으로 이동", "bearing": 125, "status": "trusted", "source": "witness", "contact": True,
         "memo": "흰색 말티즈가 편의점 앞을 지나 공원 쪽으로 뛰어갔어요. 목줄은 없었고 많이 불안해 보였습니다.",
         "x": 222, "y": 150, "scene": "street", "photo": None},
        {"id": 2, "seenAt": "17:35", "receivedAt": "17:41", "place": "중계근린공원 입구",
         "dir": "방향 확인 안 됨", "bearing": None, "status": "pending", "source": "witness", "contact": False,
         "memo": "공원 입구 벤치 근처에서 작은 흰 강아지를 봤어요. 사람이 다가가니 하천 쪽으로 갔습니다.",
         "x": 398, "y": 238, "scene": "park", "photo": None},
        {"id": 3, "seenAt": "17:50", "receivedAt": "18:20", "place": "중계아파트 3단지 놀이터",
         "dir": "방향 확인 안 됨", "bearing": None, "status": "hidden", "source": "witness", "contact": False,
         "memo": "놀이터에서 흰 강아지를 봤다는 제보. 확인 결과 이웃집 강아지로 밝혀져 숨김 처리했습니다.",
         "x": 236, "y": 382, "scene": "playground", "photo": None},
        {"id": 4, "seenAt": "18:05", "receivedAt": "18:12", "place": "당현천 산책로",
         "dir": "남쪽으로 이동", "bearing": 180, "status": "trusted", "source": "witness", "contact": True,
         "memo": "산책 중에 흰색 말티즈가 산책로를 따라 남쪽으로 내려가는 걸 봤어요. 사진 찍어뒀습니다.",
         "x": 622, "y": 352, "scene": "river", "photo": None},
    ],
}

VALID_STATUS = {"trusted", "pending", "hidden", "important"}

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}

# URL 경로 → 정적 페이지
PAGES = {
    "/": "owner.html",
    "/share": "share.html",
    "/new": "create.html",
}


def load_db():
    with LOCK:
        if not DB_PATH.exists():
            DB_PATH.write_text(json.dumps(SEED, ensure_ascii=False, indent=2), encoding="utf-8")
        return json.loads(DB_PATH.read_text(encoding="utf-8"))


def save_db(db):
    with LOCK:
        DB_PATH.write_text(json.dumps(db, ensure_ascii=False, indent=2), encoding="utf-8")


class Handler(BaseHTTPRequestHandler):
    server_version = "MungbaekHome/0.2"

    # ── 응답 헬퍼 ──────────────────────────────
    def _send(self, code, body: bytes, ctype: str):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"),
                   "application/json; charset=utf-8")

    def _file(self, name):
        path = (STATIC / name).resolve()
        if not str(path).startswith(str(STATIC)) or not path.is_file():
            self._json({"error": "not found"}, 404)
            return
        self._send(200, path.read_bytes(), MIME.get(path.suffix, "application/octet-stream"))

    def _body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length > 4_000_000:  # 사진 dataURL 포함 최대 4MB
            self._json({"error": "payload too large"}, 413)
            return None
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._json({"error": "invalid json"}, 400)
            return None

    # ── 라우팅 ────────────────────────────────
    def do_GET(self):
        url = urlparse(self.path)
        path = url.path

        if path == "/api/notice":
            self._json(load_db()["notice"])
        elif path == "/api/reports":
            self._json(load_db()["reports"])
        elif path == "/api/qr":
            self._qr(parse_qs(url.query).get("data", [""])[0])
        elif path in PAGES:
            self._file(PAGES[path])
        elif path.startswith("/r/"):          # 목격자 제보 단축 링크
            self._file("report.html")
        else:
            self._file(path.lstrip("/"))

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/reports":
            self._create_report()
        elif path == "/api/notice":
            self._create_notice()
        else:
            self._json({"error": "not found"}, 404)

    def _create_report(self):
        body = self._body()
        if body is None:
            return
        if not body.get("seenAt") or body.get("x") is None or body.get("y") is None:
            self._json({"error": "seenAt, x, y는 필수입니다"}, 400)
            return
        # 방향(나침반/지도) — 0~360도, 북=0 시계방향. 없으면 핀만 표시
        bearing = body.get("bearing")
        try:
            bearing = round(float(bearing)) % 360
        except (TypeError, ValueError):
            bearing = None
        # 보호자가 직접 등록한 제보는 status를 지정할 수 있음(외부로 받은 신뢰 제보 등)
        status = body.get("status") if body.get("status") in VALID_STATUS else "pending"
        source = "owner" if body.get("source") == "owner" else "witness"
        db = load_db()
        report = {
            "id": max((r["id"] for r in db["reports"]), default=0) + 1,
            "seenAt": str(body["seenAt"])[:5],
            "receivedAt": datetime.now().strftime("%H:%M"),
            "place": (str(body.get("place") or "").strip() or "지도에 찍은 위치")[:80],
            "dir": str(body.get("dir") or "방향 확인 안 됨")[:40],
            "bearing": bearing,
            "memo": str(body.get("memo") or "").strip()[:500],
            "status": status,
            "source": source,
            "contact": bool(body.get("contact")),
            "x": round(float(body["x"])), "y": round(float(body["y"])),
            "scene": str(body.get("scene") or "street")[:20],
            "photo": body.get("photo") if isinstance(body.get("photo"), str)
                     and str(body.get("photo")).startswith("data:image/") else None,
        }
        db["reports"].append(report)
        save_db(db)
        self._json(report, 201)

    def _create_notice(self):
        body = self._body()
        if body is None:
            return
        if not str(body.get("dogName") or "").strip():
            self._json({"error": "강아지 이름은 필수입니다"}, 400)
            return
        if body.get("lostX") is None or body.get("lostY") is None:
            self._json({"error": "유실 위치를 지도에 찍어주세요"}, 400)
            return

        def s(key, default="", n=60):
            return (str(body.get(key) or "").strip() or default)[:n]

        name = s("dogName", n=20)
        slug = "dog-" + datetime.now().strftime("%m%d%H%M%S")
        notice = {
            "slug": slug,
            "dogName": name,
            "breed": s("breed", "믹스"),
            "age": s("age", "나이 미상"),
            "weight": s("weight", "체중 미상"),
            "personality": s("personality", "정보 없음"),
            "health": s("health", "특이사항 없음"),
            "caution": s("caution",
                         f"{name}를 발견하면 잡으려 하지 말고 위치와 사진만 제보해주세요.", 200),
            "lostAt": s("lostAt", datetime.now().strftime("%Y-%m-%dT%H:%M"), 16),
            "lostPlace": s("lostPlace", "지도에 찍은 위치", 80),
            "lostX": round(float(body["lostX"])),
            "lostY": round(float(body["lostY"])),
            "status": "찾는 중",
        }
        db = load_db()
        db["notice"] = notice
        if body.get("resetReports"):     # 새 공고 → 제보 초기화
            db["reports"] = []
        save_db(db)
        self._json(notice, 201)

    def do_PATCH(self):
        path = urlparse(self.path).path
        if not path.startswith("/api/reports/"):
            self._json({"error": "not found"}, 404)
            return
        try:
            rid = int(path.rsplit("/", 1)[1])
        except ValueError:
            self._json({"error": "invalid id"}, 400)
            return
        body = self._body()
        if body is None:
            return
        status = body.get("status")
        if status not in VALID_STATUS:
            self._json({"error": f"status는 {sorted(VALID_STATUS)} 중 하나여야 합니다"}, 400)
            return
        db = load_db()
        for r in db["reports"]:
            if r["id"] == rid:
                r["status"] = status
                save_db(db)
                self._json(r)
                return
        self._json({"error": "report not found"}, 404)

    # ── QR 생성 ───────────────────────────────
    def _qr(self, data):
        if not HAS_QR:
            self._json({"error": "qrcode 패키지가 없습니다. py -m pip install qrcode"}, 503)
            return
        if not data or len(data) > 500:
            self._json({"error": "data 파라미터가 필요합니다"}, 400)
            return
        img = qrcode.make(data, image_factory=qrcode.image.svg.SvgPathImage,
                          box_size=10, border=1)
        buf = io.BytesIO()
        img.save(buf)
        self._send(200, buf.getvalue(), "image/svg+xml")

    def log_message(self, fmt, *args):
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {fmt % args}")


if __name__ == "__main__":
    load_db()  # 최초 실행 시 시드 데이터 생성
    print(f"멍백홈 서버 시작: http://localhost:{PORT}")
    print(f"  보호자 지도   http://localhost:{PORT}/")
    print(f"  공고·공유     http://localhost:{PORT}/share")
    print(f"  목격자 제보   http://localhost:{PORT}/r/kong-i")
    print(f"  QR 생성 지원: {'예' if HAS_QR else '아니오 (py -m pip install qrcode)'}")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
