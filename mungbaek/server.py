# 멍백홈 서버 — Python 표준 라이브러리만 사용 (추가 설치 불필요, qrcode는 선택)
# 실행:  py server.py   →  http://localhost:8000
#
# 권한 모델 (로그인 없음)
#   · 공고마다 공개 slug 와 비밀 ownerKey 를 발급한다.
#   · 목격자: /r/<slug> 에서 아무 인증 없이 제보 (진입장벽 0)
#   · 보호자: /m/<ownerKey> 로 관리. 제보 상태 변경·공고 수정에는 X-Owner-Key 헤더가 필요.
#   · 링크를 잃어버리면 slug + PIN(4자리)으로 ownerKey를 다시 받는다. (시도 횟수 제한)
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import threading
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
DB_PATH = ROOT / "data.json"
LOCK = threading.RLock()
PORT = int(os.environ.get("PORT", 8000))  # 배포 플랫폼(Render 등)이 PORT를 지정함

PIN_ITERATIONS = 120_000
PIN_MAX_FAILS = 5          # 이 횟수를 넘기면
PIN_LOCK_SECONDS = 600     # 10분간 잠금
IP_MAX_FAILS = 10          # 한 기기에서 실패 10회면
IP_LOCK_SECONDS = 600      # 10분간 차단 (이름·나이·PIN 무작위 대입 방지)
_IP_FAILS = {}             # ip → {count, until}

try:
    import qrcode
    import qrcode.image.svg
    HAS_QR = True
except ImportError:
    HAS_QR = False

VALID_STATUS = {"trusted", "pending", "hidden", "important"}

# 공개 API로 내보내면 안 되는 필드
SECRET_FIELDS = {"ownerKey", "pinSalt", "pinHash", "pinFails", "pinLockedUntil", "reports"}

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
    "/find": "claim.html",
    "/dogs": "dogs.html",
}

DEMO_SLUG = "demo"
DEMO_OWNER_KEY = "demo-owner-key"   # 데모 공고는 누구나 둘러볼 수 있게 고정 키 사용


def demo_notice():
    """시연용 기본 공고 — 실제 공고는 /new 에서 만든다."""
    return {
        "slug": DEMO_SLUG,
        "isDemo": True,
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
        "centerLat": 37.6447, "centerLng": 127.0763,
        "status": "찾는 중",
        "createdAt": "2026-07-20T16:30",
        "ownerKey": DEMO_OWNER_KEY,
        "pinSalt": "", "pinHash": "",      # 데모는 PIN 없음
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


# ── PIN ────────────────────────────────────────
def hash_pin(pin: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"),
                               salt.encode("utf-8"), PIN_ITERATIONS).hex()


def now_ts() -> float:
    return datetime.now().timestamp()


def digits(v) -> str:
    """'7살' → '7' — 나이 비교를 느슨하게 하기 위해."""
    return re.sub(r"\D", "", str(v or ""))


# ── DB ─────────────────────────────────────────
def _blank_db():
    return {"notices": {DEMO_SLUG: demo_notice()}}


def _migrate(db):
    """예전 형식({notice, reports})을 공고 여러 개 구조로 옮긴다."""
    if "notices" in db:
        return db, False
    old = db.get("notice")
    notices = {DEMO_SLUG: demo_notice()}
    if old:
        slug = old.get("slug") or DEMO_SLUG
        if slug == DEMO_SLUG:                       # 데모 자리를 차지하지 않도록
            slug = "dog-" + secrets.token_hex(3)
        old = dict(old)
        old["slug"] = slug
        old.setdefault("centerLat", 37.6447)
        old.setdefault("centerLng", 127.0763)
        old["createdAt"] = datetime.now().strftime("%Y-%m-%dT%H:%M")
        old["ownerKey"] = secrets.token_urlsafe(18)
        old["pinSalt"] = ""
        old["pinHash"] = ""
        old["reports"] = db.get("reports", [])
        notices[slug] = old
    return {"notices": notices}, True


# ── 저장소 ────────────────────────────────────
# DATABASE_URL이 있으면 PostgreSQL, 없으면 파일(data.json).
# Render 무료 플랜은 서버가 잠들 때 파일이 사라지므로, 실제 운영에는 DB가 필요하다.
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
STORE = "file"          # 실제로 쓰고 있는 저장소 — /api/health 로 확인 가능
STORE_NOTE = ""
_DB = None              # 메모리에 올려둔 전체 데이터 (요청마다 다시 읽지 않는다)

try:
    import pg8000.dbapi as _pg     # 순수 파이썬 드라이버 — 빌드 도구 없이 설치됨
except ImportError:
    _pg = None


def _pg_connect():
    """Supabase·Neon 등 관리형 DB는 SSL이 필수, 로컬 DB는 보통 SSL이 없다 → 둘 다 지원."""
    from urllib.parse import urlparse as _u, unquote, parse_qs
    import ssl
    u = _u(DATABASE_URL)
    args = dict(
        user=unquote(u.username or ""), password=unquote(u.password or ""),
        host=u.hostname, port=u.port or 5432,
        database=(u.path or "/postgres").lstrip("/") or "postgres",
        timeout=15,
    )
    if (parse_qs(u.query).get("sslmode") or [""])[0] == "disable":
        return _pg.connect(**args)
    ctx = ssl.create_default_context()
    ctx.check_hostname = False          # 관리형 DB는 자체 인증서를 쓰는 경우가 많다
    ctx.verify_mode = ssl.CERT_NONE
    try:
        return _pg.connect(ssl_context=ctx, **args)
    except Exception:
        return _pg.connect(**args)      # SSL을 지원하지 않는 서버면 평문으로


def _pg_init():
    """공고 하나당 한 행. 바뀐 공고만 다시 쓰면 되므로 사진이 많아도 가볍다."""
    con = _pg_connect()
    try:
        cur = con.cursor()
        cur.execute("CREATE TABLE IF NOT EXISTS notices ("
                    "slug TEXT PRIMARY KEY, data TEXT NOT NULL, "
                    "updated_at TIMESTAMPTZ NOT NULL DEFAULT now())")
        con.commit()
    finally:
        con.close()


def _pg_load():
    con = _pg_connect()
    try:
        cur = con.cursor()
        cur.execute("SELECT slug, data FROM notices")
        rows = cur.fetchall()
    finally:
        con.close()
    notices = {}
    for slug, data in rows:
        try:
            notices[slug] = json.loads(data)
        except json.JSONDecodeError:
            pass
    return {"notices": notices}


def _pg_save(slug, notice):
    con = _pg_connect()
    try:
        cur = con.cursor()
        cur.execute(
            "INSERT INTO notices (slug, data, updated_at) VALUES (%s, %s, now()) "
            "ON CONFLICT (slug) DO UPDATE SET data = EXCLUDED.data, updated_at = now()",
            (slug, json.dumps(notice, ensure_ascii=False)))
        con.commit()
    finally:
        con.close()


def _read_file():
    if not DB_PATH.exists():
        return _blank_db(), True
    try:
        db = json.loads(DB_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return _blank_db(), True
    db, changed = _migrate(db)
    return db, changed


def _write_file(db):
    """임시 파일에 쓰고 바꿔치기 — 저장 도중 서버가 죽어도 파일이 깨지지 않는다."""
    tmp = DB_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(db, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(DB_PATH)


def init_store():
    """서버 시작 시 한 번. DB가 있으면 DB에서, 없으면 파일에서 읽어 메모리에 올린다."""
    global _DB, STORE, STORE_NOTE
    if DATABASE_URL:
        if _pg is None:
            STORE, STORE_NOTE = "file", "pg8000 미설치 — pip install pg8000 필요"
        else:
            last = ""
            for attempt in range(3):
                try:
                    _pg_init()
                    _DB = _pg_load()
                    STORE = "postgres"
                    break
                except Exception as e:      # 네트워크·인증 실패 등
                    last = f"{type(e).__name__}: {e}"
            if STORE != "postgres":
                STORE_NOTE = "DB 연결 실패 — 파일로 동작 중: " + last[:200]
    if _DB is None:
        _DB, changed = _read_file()
        if changed:
            _write_file(_DB)
    # 데모 공고는 항상 있어야 첫 화면 둘러보기가 된다
    if DEMO_SLUG not in _DB.setdefault("notices", {}):
        _DB["notices"][DEMO_SLUG] = demo_notice()
        save_db(DEMO_SLUG)
    print(f"저장소: {STORE}" + (f" ({STORE_NOTE})" if STORE_NOTE else ""))


def load_db():
    """데이터를 돌려준다. 값을 고칠 때는 반드시 LOCK 안에서 하고 save_db()를 부를 것."""
    global _DB
    with LOCK:
        if _DB is None:
            init_store()
        return _DB


def save_db(slug=None):
    """slug를 주면 그 공고만 저장(권장). 없으면 전체 저장."""
    global STORE, STORE_NOTE
    with LOCK:
        if STORE == "postgres":
            try:
                targets = ([slug] if slug else list(_DB["notices"].keys()))
                for s in targets:
                    n = _DB["notices"].get(s)
                    if n is not None:
                        _pg_save(s, n)
                return
            except Exception as e:
                # 저장이 실패해도 서비스는 계속 — 메모리에는 남아 있고 로그로 알린다
                STORE_NOTE = f"쓰기 실패: {type(e).__name__}: {e}"[:200]
                print("[저장 실패]", STORE_NOTE)
        _write_file(_DB)


def light_report(r):
    """목록·폴링용 — 사진 원본은 빼고 작은 썸네일만 (2초마다 원본을 다시 받지 않도록)."""
    out = {k: v for k, v in r.items() if k != "photo"}
    out["hasPhoto"] = bool(r.get("photo"))
    return out


def list_notice(n):
    """목록용 — 목격자가 '내가 본 강아지'를 고를 수 있을 만큼만. 사진은 작은 것만."""
    return {
        "slug": n.get("slug"),
        "dogName": n.get("dogName"),
        "breed": n.get("breed"),
        "age": n.get("age"),
        "thumb": n.get("thumb"),
        "lostPlace": n.get("lostPlace"),
        "lostAt": n.get("lostAt"),
        "centerLat": n.get("centerLat"),
        "centerLng": n.get("centerLng"),
        "reportCount": len(n.get("reports", [])),
    }


def public_notice(n):
    """비밀 필드를 뺀 공개용 공고 정보."""
    out = {k: v for k, v in n.items() if k not in SECRET_FIELDS}
    out["hasPin"] = bool(n.get("pinHash"))
    out["reportCount"] = len(n.get("reports", []))
    return out


class Handler(BaseHTTPRequestHandler):
    server_version = "MungbaekHome/0.3"

    # ── 응답 헬퍼 ──────────────────────────────
    def _send(self, code, body: bytes, ctype: str):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        # 관리 링크(비밀 URL)가 새어나가지 않도록
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Robots-Tag", "noindex, nofollow")
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

    # ── 공고 조회 헬퍼 ─────────────────────────
    def _query(self):
        return parse_qs(urlparse(self.path).query)

    def _find_notice(self, db):
        """?slug= 또는 ?key= 로 공고를 찾는다. 없으면 (None, 오류응답함)."""
        q = self._query()
        key = (q.get("key") or [""])[0]
        slug = (q.get("slug") or [""])[0]
        if key:
            for n in db["notices"].values():
                if hmac.compare_digest(n.get("ownerKey", ""), key):
                    return n
            return None
        if slug:
            return db["notices"].get(slug)
        return None

    def _owner_ok(self, notice):
        """이 요청이 해당 공고의 보호자인지."""
        sent = self.headers.get("X-Owner-Key", "")
        return bool(sent) and hmac.compare_digest(notice.get("ownerKey", ""), sent)

    # ── 라우팅 ────────────────────────────────
    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/api/notice":
            with LOCK:
                db = load_db()
                n = self._find_notice(db)
                if not n:
                    self._json({"error": "공고를 찾을 수 없어요"}, 404)
                    return
                out = public_notice(n)
                if self._owner_ok(n):
                    out["isOwner"] = True
                self._json(out)
        elif path == "/api/health":
            # 저장소가 DB인지 파일인지 확인용 — 비밀 정보는 담지 않는다
            with LOCK:
                db = load_db()
                self._json({
                    "store": STORE,
                    "note": STORE_NOTE,
                    "notices": len(db.get("notices", {})),
                    "reports": sum(len(n.get("reports", [])) for n in db["notices"].values()),
                })
        elif path == "/api/notices":
            # 아직 찾는 중인 공고 목록 — 목격자가 본 강아지를 고를 수 있게
            with LOCK:
                db = load_db()
                items = [list_notice(n) for n in db["notices"].values()
                         if n.get("status") != "찾았어요"]
                items.sort(key=lambda x: x.get("lostAt") or "", reverse=True)
                self._json(items[:60])
        elif path == "/api/reports":
            with LOCK:
                db = load_db()
                n = self._find_notice(db)
                if not n:
                    self._json({"error": "공고를 찾을 수 없어요"}, 404)
                    return
                self._json([light_report(r) for r in n.get("reports", [])])
        elif path == "/api/photo":
            # 사진 원본은 제보 상세를 열 때만 따로 받아간다
            with LOCK:
                db = load_db()
                n = self._find_notice(db)
                if not n:
                    self._json({"error": "공고를 찾을 수 없어요"}, 404)
                    return
                try:
                    rid = int((self._query().get("id") or ["0"])[0])
                except ValueError:
                    self._json({"error": "invalid id"}, 400)
                    return
                for r in n.get("reports", []):
                    if r["id"] == rid:
                        self._json({"photo": r.get("photo")})
                        return
                self._json({"error": "report not found"}, 404)
        elif path == "/api/qr":
            self._qr((self._query().get("data") or [""])[0])
        elif path in PAGES:
            self._file(PAGES[path])
        elif path.startswith("/r/"):          # 목격자 제보 링크
            self._file("report.html")
        elif path.startswith("/m/"):          # 보호자 관리 링크(비밀)
            self._file("owner.html")
        else:
            self._file(path.lstrip("/"))

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/reports":
            self._create_report()
        elif path == "/api/notice":
            self._create_notice()
        elif path == "/api/auth":
            self._auth_pin()
        else:
            self._json({"error": "not found"}, 404)

    # ── 제보 등록 (누구나) ─────────────────────
    def _create_report(self):
        body = self._body()
        if body is None:
            return
        # 읽기~쓰기를 한 덩어리로 잠근다 (동시에 들어온 제보가 서로를 덮어쓰지 않게)
        with LOCK:
            return self._create_report_locked(body)

    def _create_report_locked(self, body):
        db = load_db()
        notice = db["notices"].get(str(body.get("slug") or ""))
        if not notice:
            notice = self._find_notice(db)
        if not notice:
            self._json({"error": "공고를 찾을 수 없어요"}, 404)
            return
        if not body.get("seenAt") or body.get("x") is None or body.get("y") is None:
            self._json({"error": "seenAt, x, y는 필수입니다"}, 400)
            return
        # 방향(나침반/지도) — 0~360도, 북=0 시계방향. 없으면 핀만 표시
        try:
            bearing = round(float(body.get("bearing"))) % 360
        except (TypeError, ValueError):
            bearing = None
        # 상태 지정은 보호자만 (외부로 받은 제보를 직접 신뢰로 등록하는 경우)
        status = "pending"
        source = "witness"
        if body.get("source") == "owner" and self._owner_ok(notice):
            source = "owner"
            if body.get("status") in VALID_STATUS:
                status = body["status"]
        reports = notice.setdefault("reports", [])
        report = {
            "id": max((r["id"] for r in reports), default=0) + 1,
            "seenAt": str(body["seenAt"])[:5],
            "receivedAt": datetime.now().strftime("%H:%M"),
            "place": (str(body.get("place") or "").strip() or "지도에 찍은 위치")[:80],
            "dir": str(body.get("dir") or "방향 확인 안 됨")[:40],
            "bearing": bearing,
            "memo": str(body.get("memo") or "").strip()[:500],
            "status": status,
            "source": source,
            # 목격자가 남긴 연락처 — 보호자만 볼 수 있다(관리 API가 인증으로 보호됨)
            "phone": re.sub(r"[^\d+\-]", "", str(body.get("phone") or ""))[:20] or None,
            "contact": bool(body.get("contact")) or bool(body.get("phone")),
            "x": round(float(body["x"])), "y": round(float(body["y"])),
            "scene": str(body.get("scene") or "street")[:20],
            "photo": body.get("photo") if isinstance(body.get("photo"), str)
                     and str(body.get("photo")).startswith("data:image/") else None,
            "thumb": body.get("thumb") if isinstance(body.get("thumb"), str)
                     and str(body.get("thumb")).startswith("data:image/") else None,
        }
        reports.append(report)
        save_db(notice["slug"])
        self._json(light_report(report), 201)

    # ── 공고 등록 (누구나 — 만든 사람이 보호자가 됨) ──
    def _create_notice(self):
        body = self._body()
        if body is None:
            return
        with LOCK:
            return self._create_notice_locked(body)

    def _create_notice_locked(self, body):
        if not str(body.get("dogName") or "").strip():
            self._json({"error": "강아지 이름은 필수입니다"}, 400)
            return
        if body.get("lostX") is None or body.get("lostY") is None:
            self._json({"error": "유실 위치를 지도에 찍어주세요"}, 400)
            return
        pin = str(body.get("pin") or "").strip()
        if not re.fullmatch(r"\d{4}", pin):
            self._json({"error": "PIN은 숫자 4자리로 정해주세요"}, 400)
            return

        def s(key, default="", n=60):
            return (str(body.get(key) or "").strip() or default)[:n]

        def geo(key, default):
            try:
                return float(body.get(key))
            except (TypeError, ValueError):
                return default

        def img(key):
            v = body.get(key)
            return v if isinstance(v, str) and v.startswith("data:image/") else None

        name = s("dogName", n=20)
        db = load_db()
        slug = "dog-" + secrets.token_hex(3)
        while slug in db["notices"]:
            slug = "dog-" + secrets.token_hex(3)
        owner_key = secrets.token_urlsafe(18)
        salt = secrets.token_hex(8)
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
            "centerLat": geo("centerLat", 37.6447),
            "centerLng": geo("centerLng", 127.0763),
            "photo": img("photo"),      # 전단지에 쓰는 강아지 사진
            "thumb": img("thumb"),      # 목록용 작은 사진
            "status": "찾는 중",
            "createdAt": datetime.now().strftime("%Y-%m-%dT%H:%M"),
            "ownerKey": owner_key,
            "pinSalt": salt,
            "pinHash": hash_pin(pin, salt),
            "reports": [],
        }
        db["notices"][slug] = notice
        save_db(slug)
        self._json({"notice": public_notice(notice), "slug": slug, "ownerKey": owner_key}, 201)

    # ── 내 공고 되찾기 (이름 + 나이 + PIN) ──────
    def _client_ip(self):
        fwd = self.headers.get("X-Forwarded-For", "")
        return fwd.split(",")[0].strip() if fwd else self.client_address[0]

    def _ip_blocked(self):
        """이름·나이·PIN을 무작위로 대입하는 걸 막는다."""
        rec = _IP_FAILS.get(self._client_ip())
        return bool(rec and now_ts() < rec.get("until", 0))

    def _ip_fail(self):
        ip = self._client_ip()
        rec = _IP_FAILS.setdefault(ip, {"count": 0, "until": 0})
        rec["count"] += 1
        if rec["count"] >= IP_MAX_FAILS:
            rec["until"] = now_ts() + IP_LOCK_SECONDS
            rec["count"] = 0

    def _auth_pin(self):
        body = self._body()
        if body is None:
            return
        with LOCK:
            return self._auth_pin_locked(body)

    def _auth_pin_locked(self, body):
        db = load_db()
        pin = str(body.get("pin") or "").strip()
        slug = str(body.get("slug") or "").strip()
        name = str(body.get("dogName") or "").strip()
        age = digits(body.get("age"))

        if self._ip_blocked():
            self._json({"error": "시도가 너무 많아요. 10분 뒤에 다시 시도해주세요"}, 429)
            return
        if not re.fullmatch(r"\d{4}", pin):
            self._json({"error": "PIN을 숫자 4자리로 입력해주세요"}, 400)
            return

        # 후보 찾기 — slug를 알면 그것만, 모르면 이름(+나이)으로
        if slug:
            n = db["notices"].get(slug)
            candidates = [n] if n else []
        elif name:
            candidates = [n for n in db["notices"].values()
                          if n.get("dogName", "").strip() == name
                          and (not age or digits(n.get("age")) == age)]
        else:
            self._json({"error": "강아지 이름을 입력해주세요"}, 400)
            return
        candidates = [n for n in candidates if n.get("pinHash")]
        if not candidates:
            self._ip_fail()
            self._json({"error": "그 이름·나이로 등록된 공고를 찾지 못했어요. 입력을 다시 확인해주세요"}, 404)
            return

        # 잠긴 공고는 건너뛰고, PIN이 맞는 공고를 찾는다
        locked_wait = 0
        for n in candidates:
            until = n.get("pinLockedUntil", 0)
            if until and now_ts() < until:
                locked_wait = max(locked_wait, int((until - now_ts()) / 60) + 1)
                continue
            if hmac.compare_digest(n["pinHash"], hash_pin(pin, n.get("pinSalt", ""))):
                n["pinFails"] = 0
                n["pinLockedUntil"] = 0
                save_db(n["slug"])
                _IP_FAILS.pop(self._client_ip(), None)
                self._json({"ownerKey": n["ownerKey"], "slug": n["slug"], "notice": public_notice(n)})
                return

        # 전부 실패 — 후보들의 실패 횟수를 올린다
        left = PIN_MAX_FAILS
        for n in candidates:
            fails = n.get("pinFails", 0) + 1
            n["pinFails"] = fails
            if fails >= PIN_MAX_FAILS:
                n["pinLockedUntil"] = now_ts() + PIN_LOCK_SECONDS
                n["pinFails"] = 0
            left = min(left, max(0, PIN_MAX_FAILS - fails))
        for n in candidates:
            save_db(n["slug"])
        self._ip_fail()
        if locked_wait:
            self._json({"error": f"PIN을 여러 번 틀렸어요. {locked_wait}분 뒤에 다시 시도해주세요"}, 429)
            return
        self._json({"error": f"PIN이 맞지 않아요 (남은 시도 {left}회)"}, 401)

    # ── 제보 상태 변경 / 공고 수정 (보호자만) ───
    def do_PATCH(self):
        with LOCK:
            return self._do_patch_locked()

    def _do_patch_locked(self):
        path = urlparse(self.path).path
        db = load_db()
        notice = self._find_notice(db)
        if not notice:
            self._json({"error": "공고를 찾을 수 없어요"}, 404)
            return
        if not self._owner_ok(notice):
            self._json({"error": "이 공고를 관리할 권한이 없어요"}, 403)
            return

        if path == "/api/notice":
            body = self._body()
            if body is None:
                return
            status = str(body.get("status") or "").strip()
            if status not in {"찾는 중", "찾았어요"}:
                self._json({"error": "status는 '찾는 중' 또는 '찾았어요'여야 합니다"}, 400)
                return
            notice["status"] = status
            save_db(notice["slug"])
            self._json(public_notice(notice))
            return

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
        for r in notice.get("reports", []):
            if r["id"] == rid:
                r["status"] = status
                save_db(notice["slug"])
                self._json(light_report(r))
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
        line = fmt % args
        # 비밀 관리 링크·키가 로그에 남지 않게 가린다 (로그를 보는 사람 = 주인이 됨)
        line = re.sub(r"/m/[^\s\"?]+", "/m/***", line)
        line = re.sub(r"([?&]key=)[^\s\"&]+", r"\1***", line)
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {line}")


if __name__ == "__main__":
    init_store()  # DB 또는 파일에서 데이터를 메모리에 올린다
    print(f"멍백홈 서버 시작: http://localhost:{PORT}")
    print(f"  첫 화면(공고 등록/관리)  http://localhost:{PORT}/")
    print(f"  데모 관리 화면           http://localhost:{PORT}/m/{DEMO_OWNER_KEY}")
    print(f"  데모 목격자 제보         http://localhost:{PORT}/r/{DEMO_SLUG}")
    print(f"  QR 생성 지원: {'예' if HAS_QR else '아니오 (py -m pip install qrcode)'}")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
