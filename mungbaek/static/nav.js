/* 멍백홈 주요 메뉴
 *
 * 화면이 여러 개인데 서로 어떻게 오가는지 보이지 않아서 헷갈린다는 피드백에 따라
 * 어느 화면에 있든 같은 자리에 같은 메뉴가 보이게 한다.
 *
 *   홈      — 내가 찾는 강아지 지도 (공고가 없으면 시작 화면)
 *   제보하기 — 다른 사람이 잃어버린 강아지를 봤을 때
 *   내 공고  — 내가 올린 공고 목록 · 전단지 · 수정
 *
 * 쓰는 법: <script src="/nav.js" data-nav="home"></script>
 */
(function () {
  const ICON = {
    home: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z"/><path d="M9.5 21v-6h5v6"/>',
    dogs: '<path d="M12 21s7-5.7 7-11a7 7 0 1 0-14 0c0 5.3 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>',
    mine: '<path d="M6 4h9l4 4v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/><path d="M14 4v5h5"/><path d="M9 13h6M9 17h4"/>',
  };
  const ITEMS = [
    { key: "home", href: "/", label: "홈" },
    { key: "dogs", href: "/dogs", label: "제보하기" },
    { key: "mine", href: "/mine", label: "내 공고" },
  ];

  const current = (document.currentScript && document.currentScript.dataset.nav) || "";

  function build() {
    const nav = document.createElement("nav");
    nav.className = "mb-nav";
    nav.setAttribute("aria-label", "주요 메뉴");
    nav.innerHTML = ITEMS.map(it => `
      <a href="${it.href}" class="mb-nav-item${it.key === current ? " on" : ""}"
         ${it.key === current ? 'aria-current="page"' : ""}>
        <span class="mb-nav-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[it.key]}</svg></span>
        <span>${it.label}</span>
      </a>`).join("");
    document.body.appendChild(nav);
    document.body.classList.add("has-nav");
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", build);
  else build();
})();
