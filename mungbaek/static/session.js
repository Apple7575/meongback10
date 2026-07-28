/* 멍백홈 — 로그인 없는 보호자 권한 관리
 *
 * 공고를 만들면 서버가 비밀 ownerKey를 발급한다.
 * 그 키를 이 브라우저에 저장해두면 다음부터 앱을 열기만 해도 내 공고 관리 화면으로 간다.
 * (키를 잃어버려도 공고 주소 + PIN 4자리로 다시 받을 수 있다 — /find)
 */
(function () {
  const KEY = "mungbaek.owner";      // 예전(공고 1개) 형식 — 자동으로 아래 목록으로 옮긴다
  const LIST = "mungbaek.notices";   // [{slug, ownerKey, dogName, savedAt}]
  const ACTIVE = "mungbaek.active";  // 지금 보고 있는 공고 slug

  function readList() {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(LIST) || "[]"); } catch (e) { list = []; }
    if (!Array.isArray(list)) list = [];
    // 예전 형식이 남아 있으면 목록으로 이전
    try {
      const old = JSON.parse(localStorage.getItem(KEY) || "null");
      if (old && old.slug && old.ownerKey && !list.some(n => n.slug === old.slug)) {
        list.push(old);
        localStorage.setItem(LIST, JSON.stringify(list));
        localStorage.removeItem(KEY);
      }
    } catch (e) { /* 무시 */ }
    return list;
  }

  function writeList(list) {
    try { localStorage.setItem(LIST, JSON.stringify(list)); } catch (e) {}
  }

  /* 공고 하나를 목록에 추가(같은 공고면 갱신)하고 활성 공고로 지정 */
  function add(slug, ownerKey, dogName) {
    if (!slug || !ownerKey) return;
    const list = readList().filter(n => n.slug !== slug);
    list.push({ slug, ownerKey, dogName: dogName || "", savedAt: Date.now() });
    writeList(list);
    setActive(slug);
  }

  function remove(slug) {
    writeList(readList().filter(n => n.slug !== slug));
    if (getActiveSlug() === slug) {
      const rest = readList();
      rest.length ? setActive(rest[rest.length - 1].slug) : clearActive();
    }
  }

  function find(slug) { return readList().find(n => n.slug === slug) || null; }

  function getActiveSlug() {
    let a = "";
    try { a = localStorage.getItem(ACTIVE) || ""; } catch (e) {}
    const list = readList();
    if (a && list.some(n => n.slug === a)) return a;
    return list.length ? list[list.length - 1].slug : "";
  }
  function setActive(slug) { try { localStorage.setItem(ACTIVE, slug); } catch (e) {} }
  function clearActive() { try { localStorage.removeItem(ACTIVE); } catch (e) {} }

  /* 지금 활성 공고 (없으면 null) */
  function read() { return find(getActiveSlug()); }
  /* 예전 이름 유지 — 새 공고를 추가한다 (기존 공고 권한은 그대로 남음) */
  function save(slug, ownerKey, dogName) { add(slug, ownerKey, dogName); }
  function clear() {
    try { localStorage.removeItem(KEY); localStorage.removeItem(LIST); localStorage.removeItem(ACTIVE); } catch (e) {}
  }

  const origin = () => location.origin;

  window.MB = {
    read, save, clear, add, remove, find, readList, setActive, getActiveSlug,
    ownerKey: () => (read() || {}).ownerKey || "",
    slug: () => (read() || {}).slug || "",

    /* 보호자 인증 헤더 — 관리 요청에 붙인다. 공고를 지정하면 그 공고의 키를 쓴다 */
    authHeaders(extra, slug) {
      const rec = slug ? find(slug) : read();
      const k = rec && rec.ownerKey;
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
