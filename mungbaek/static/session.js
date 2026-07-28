/* 멍백홈 — 로그인 없는 보호자 권한 관리
 *
 * 공고를 만들면 서버가 비밀 ownerKey를 발급한다.
 * 그 키를 이 브라우저에 저장해두면 다음부터 앱을 열기만 해도 내 공고 관리 화면으로 간다.
 * (키를 잃어버려도 공고 주소 + PIN 4자리로 다시 받을 수 있다 — /find)
 */
(function () {
  const KEY = "mungbaek.owner";     // {slug, ownerKey, dogName, savedAt}

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || "null"); }
    catch (e) { return null; }
  }
  function save(slug, ownerKey, dogName) {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        slug, ownerKey, dogName: dogName || "", savedAt: Date.now(),
      }));
    } catch (e) { /* 시크릿 모드 등 — 저장 못 해도 링크로는 계속 쓸 수 있음 */ }
  }
  function clear() { try { localStorage.removeItem(KEY); } catch (e) {} }

  const origin = () => location.origin;

  window.MB = {
    read, save, clear,
    ownerKey: () => (read() || {}).ownerKey || "",
    slug: () => (read() || {}).slug || "",

    /* 보호자 인증 헤더 — 상태 변경 등 관리 요청에 붙인다 */
    authHeaders(extra) {
      const k = window.MB.ownerKey();
      return Object.assign({}, extra || {}, k ? { "X-Owner-Key": k } : {});
    },

    /* 목격자에게 뿌리는 공개 링크 (QR·단톡방용) */
    reportUrl: (slug) => `${origin()}/r/${slug}`,
    /* 보호자 전용 비밀 링크 — 절대 공유하면 안 됨 */
    manageUrl: (ownerKey) => `${origin()}/m/${ownerKey}`,

    /* 주소창의 /m/<key> 에서 키를 꺼낸다 */
    keyFromPath() {
      const m = location.pathname.match(/^\/m\/([^/?#]+)/);
      return m ? decodeURIComponent(m[1]) : "";
    },
    /* 주소창의 /r/<slug> 에서 공고 id를 꺼낸다 */
    slugFromPath() {
      const m = location.pathname.match(/^\/r\/([^/?#]+)/);
      return m ? decodeURIComponent(m[1]) : "";
    },

    /* 클립보드 복사 (https·localhost에서 동작, 실패 시 폴백) */
    async copy(text) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (e) {
        const ta = document.createElement("textarea");
        ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        let ok = false;
        try { ok = document.execCommand("copy"); } catch (e2) { ok = false; }
        document.body.removeChild(ta);
        return ok;
      }
    },
  };
})();
