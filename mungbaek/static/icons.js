/* 멍백홈 아이콘 세트
 *
 * 이모지(📍🔔📷…) 대신 쓰는 공통 아이콘. 굵기·크기·모서리 처리가 모두 같아
 * 화면마다 제각각으로 보이지 않는다. 외부 CDN을 쓰지 않아 오프라인·느린 망에서도 안전.
 *
 * 쓰는 법
 *   1) <span class="ic" data-icon="map-pin"></span>  → 페이지 로드 시 자동으로 채워짐
 *   2) el.innerHTML = Icons.svg("phone")             → 직접 넣을 때
 *
 * 규격: 24x24 격자, 선 굵기 2, 둥근 끝 — 라인 아이콘 표준 형태
 */
(function () {
  const P = {
    /* 위치·지도 */
    "map-pin": '<path d="M12 21s7-5.7 7-11a7 7 0 1 0-14 0c0 5.3 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>',
    "crosshair": '<circle cx="12" cy="12" r="7.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
    "map": '<path d="M9 4.5 3.5 7v12.5L9 17l6 2.5 5.5-2.5V4.5L15 7Z"/><path d="M9 4.5V17M15 7v12.5"/>',
    "compass": '<circle cx="12" cy="12" r="9"/><path d="m15.2 8.8-2 5.4-5.4 2 2-5.4Z"/>',
    "search": '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    "navigation": '<path d="M12 3 20 20l-8-4-8 4Z"/>',

    /* 상태 */
    "check": '<path d="m4.5 12.6 4.8 4.8L19.5 6.6"/>',
    "check-circle": '<circle cx="12" cy="12" r="9"/><path d="m8.2 12.3 2.6 2.6 5-5.2"/>',
    "help-circle": '<circle cx="12" cy="12" r="9"/><path d="M9.3 9.3a3 3 0 1 1 3.9 3.8c-.7.2-1.2.9-1.2 1.6v.3"/><path d="M12 18.2h.01"/>',
    "eye-off": '<path d="M3 3 21 21"/><path d="M10.6 5.2A9.9 9.9 0 0 1 12 5.1c5 0 9 4.4 9 6.9 0 .9-.7 2.2-1.9 3.4M6.6 7C4.3 8.5 3 10.4 3 12c0 2.5 4 6.9 9 6.9 1.6 0 3-.4 4.3-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    "alert-triangle": '<path d="M12 4.6 21 19H3L12 4.6Z"/><path d="M12 10.2v3.6"/><path d="M12 16.6h.01"/>',
    "home": '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z"/><path d="M9.5 21v-6h5v6"/>',

    /* 동작 */
    "plus": '<path d="M12 5.5v13M5.5 12h13"/>',
    "bell": '<path d="M18 9.2a6 6 0 1 0-12 0c0 5-2.1 6.3-2.1 6.3h16.2S18 14.2 18 9.2"/><path d="M10.3 19a2 2 0 0 0 3.4 0"/>',
    "share": '<path d="M12 15.2V4"/><path d="m8.2 7.8 3.8-3.8 3.8 3.8"/><path d="M5 13.6V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4.4"/>',
    "download": '<path d="M12 4v11"/><path d="m8 11.5 4 4 4-4"/><path d="M5 19h14"/>',
    "link": '<path d="M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1"/><path d="M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1"/>',
    "camera": '<path d="M4 8.5h3l1.6-2.2h6.8L17 8.5h3a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13.4" r="3.4"/>',
    "key": '<circle cx="8" cy="14" r="4"/><path d="m11 11 8-8"/><path d="m17 5 2.4 2.4"/><path d="m14.5 7.5 2.2 2.2"/>',

    /* 연락 */
    "phone": '<path d="M6.6 4h3l1.5 3.8-2 1.3a11 11 0 0 0 5.8 5.8l1.3-2 3.8 1.5v3a1.6 1.6 0 0 1-1.8 1.6C11.4 18.3 5.7 12.6 5 6.2A1.6 1.6 0 0 1 6.6 4Z"/>',
    "phone-off": '<path d="M3 3 21 21"/><path d="M9.6 5.4 9 4H6.6A1.6 1.6 0 0 0 5 6.2c.3 2.6 1.4 5 3 7"/><path d="M11.9 15.9c1.9 1.6 4.2 2.7 6.8 3a1.6 1.6 0 0 0 1.7-1.6v-3l-3.8-1.5-1.3 2"/>',
  };

  const svg = (name, extra) => {
    const p = P[name];
    if (!p) return "";
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra || ""}>${p}</svg>`;
  };

  /* data-icon 이 붙은 자리를 한 번에 채운다 */
  function paint(root) {
    (root || document).querySelectorAll("[data-icon]").forEach(el => {
      const name = el.getAttribute("data-icon");
      if (name && !el.firstElementChild) el.innerHTML = svg(name);
    });
  }

  window.Icons = { svg, paint, has: n => !!P[n] };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", () => paint());
  else paint();
})();
