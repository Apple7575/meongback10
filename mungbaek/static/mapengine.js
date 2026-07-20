/* 멍백홈 지도 엔진
 * - config.js의 KAKAO_MAP_KEY가 있으면 실제 카카오맵, 없으면 자체 SVG 도식 지도
 * - view 모드: 유실 지점 + 제보 핀 + 시간순 경로 + 우선 수색 구역
 * - pick 모드: 탭해서 목격 위치 선택
 */
(function () {
  const CFG = window.MUNGBAEK_CONFIG || {};
  const GEO = CFG.GEO || { centerLat: 37.6447, centerLng: 127.0763, latSpan: 0.00757, lngSpan: 0.01385 };
  const W = 820, H = 560;

  const STATUS_COLOR = {
    trusted: "var(--trust)", pending: "var(--pending)",
    important: "var(--important)", hidden: "var(--hidden)",
  };

  /* SVG 좌표 ↔ 위경도 */
  function xyToLatLng(x, y) {
    return {
      lat: GEO.centerLat - (y - H / 2) / H * GEO.latSpan,
      lng: GEO.centerLng + (x - W / 2) / W * GEO.lngSpan,
    };
  }
  function latLngToXy(lat, lng) {
    return {
      x: (lng - GEO.centerLng) / GEO.lngSpan * W + W / 2,
      y: (GEO.centerLat - lat) / GEO.latSpan * H + H / 2,
    };
  }

  /* 자체 도식 지도 배경 (중계동 일대) */
  const BASE_MAP = `
    <rect width="820" height="560" fill="var(--map-bg)"/>
    <g stroke="var(--map-road)" fill="none" stroke-linecap="round">
      <path d="M0 150 H820" stroke-width="22"/><path d="M0 470 H820" stroke-width="18"/>
      <path d="M150 0 V560" stroke-width="20"/><path d="M470 0 V150" stroke-width="16"/>
      <path d="M320 150 V470" stroke-width="14"/><path d="M650 150 V560" stroke-width="14"/>
    </g>
    <g fill="var(--map-block)">
      <rect x="30" y="30" width="90" height="88" rx="8"/><rect x="185" y="34" width="110" height="84" rx="8"/>
      <rect x="30" y="195" width="88" height="110" rx="8"/><rect x="30" y="340" width="88" height="96" rx="8"/>
      <rect x="185" y="330" width="100" height="105" rx="8"/><rect x="185" y="500" width="110" height="45" rx="8"/>
      <rect x="30" y="500" width="88" height="45" rx="8"/><rect x="510" y="30" width="120" height="85" rx="8"/>
      <rect x="680" y="30" width="105" height="85" rx="8"/><rect x="680" y="500" width="105" height="45" rx="8"/>
    </g>
    <path d="M355 180 Q470 160 560 195 Q615 220 600 300 Q585 375 490 400 Q390 420 350 350 Q325 290 340 235 Q345 200 355 180 Z"
      fill="var(--map-park)" stroke="var(--map-park-line)" stroke-width="2"/>
    <g fill="var(--map-park-line)">
      <circle cx="430" cy="250" r="9"/><circle cx="482" cy="230" r="7"/><circle cx="530" cy="270" r="9"/>
      <circle cx="470" cy="320" r="8"/><circle cx="410" cy="345" r="7"/><circle cx="545" cy="330" r="7"/>
    </g>
    <text x="455" y="298" class="maplabel big" text-anchor="middle">중계근린공원</text>
    <path d="M760 100 Q700 220 640 320 Q590 405 560 545" fill="none" stroke="var(--map-water)" stroke-width="40" stroke-linecap="round"/>
    <path d="M760 100 Q700 220 640 320 Q590 405 560 545" fill="none" stroke="var(--map-water-line)" stroke-width="1.6" stroke-dasharray="2 7" opacity=".8"/>
    <text x="702" y="252" class="maplabel big" transform="rotate(58 702 252)" text-anchor="middle">당현천</text>`;

  /* 카카오 SDK 로더 (키가 있을 때만) */
  let kakaoPromise = null;
  function loadKakao() {
    if (kakaoPromise) return kakaoPromise;
    kakaoPromise = new Promise((resolve, reject) => {
      if (!CFG.KAKAO_MAP_KEY) { reject(new Error("no key")); return; }
      const s = document.createElement("script");
      s.src = "https://dapi.kakao.com/v2/maps/sdk.js?appkey=" + CFG.KAKAO_MAP_KEY + "&autoload=false";
      s.onload = () => window.kakao.maps.load(() => resolve(window.kakao));
      s.onerror = () => reject(new Error("kakao sdk load failed"));
      document.head.appendChild(s);
    });
    return kakaoPromise;
  }

  /* ══════════ SVG 백엔드 ══════════ */
  function createSvgEngine(container, opts) {
    container.innerHTML =
      `<svg class="mb-map" viewBox="0 0 ${W} ${H}" role="img" aria-label="유실목격지도">
        <g>${BASE_MAP}</g>
        <g data-l="zone"></g><g data-l="trail"></g><g data-l="pins"></g><g data-l="pick"></g>
      </svg>`;
    const svg = container.querySelector("svg");
    const layer = (n) => svg.querySelector(`[data-l="${n}"]`);

    if (opts.mode === "pick") {
      svg.style.cursor = "crosshair";
      svg.addEventListener("click", (e) => {
        const r = svg.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width * W;
        const y = (e.clientY - r.top) / r.height * H;
        opts.onPick && opts.onPick({ x: Math.round(x), y: Math.round(y) });
      });
    }

    return {
      backend: "svg",
      setMarker(x, y) {
        layer("pick").innerHTML = `
          <circle cx="${x}" cy="${y}" r="26" fill="color-mix(in srgb, var(--pending) 25%, transparent)"/>
          <path d="M${x} ${y + 18} C${x - 14} ${y + 3} ${x - 14} ${y - 15} ${x} ${y - 15} C${x + 14} ${y - 15} ${x + 14} ${y + 3} ${x} ${y + 18} Z"
            fill="var(--pending)" stroke="var(--surface)" stroke-width="2.5"/>
          <circle cx="${x}" cy="${y - 3}" r="5" fill="var(--surface)"/>`;
      },
      clearMarker() { layer("pick").innerHTML = ""; },
      render({ lostPoint, reports, activeId, trail, zone }) {
        layer("zone").innerHTML = zone ? `
          <circle class="zone-circle" cx="${zone.x}" cy="${zone.y}" r="86"
            fill="color-mix(in srgb, var(--zone) 16%, transparent)"
            stroke="var(--zone)" stroke-width="2" stroke-dasharray="7 6"/>
          <text x="${zone.x}" y="${Math.min(zone.y + 98, 548)}" text-anchor="middle"
            style="font-size:12px;font-weight:800" fill="var(--zone)">우선 수색 구역</text>` : "";

        const pts = [[lostPoint.x, lostPoint.y], ...trail.map(r => [r.x, r.y])];
        let path = "";
        for (let i = 0; i < pts.length - 1; i++) {
          const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
          path += `M${x1} ${y1} Q${(x1 + x2) / 2} ${(y1 + y2) / 2 - 26} ${x2} ${y2} `;
        }
        layer("trail").innerHTML = pts.length > 1 ?
          `<path class="trail" d="${path}" fill="none" stroke="var(--navy)" stroke-width="2.6" stroke-linecap="round" opacity=".85"/>` : "";

        let html = `<g class="pin" tabindex="0" role="button" aria-label="마지막 목격 지점 ${lostPoint.place} ${lostPoint.label}">
          <g class="pin-body">
            <circle cx="${lostPoint.x}" cy="${lostPoint.y}" r="15" fill="var(--navy)" stroke="var(--surface)" stroke-width="3"/>
            <text x="${lostPoint.x}" y="${lostPoint.y + 5}" text-anchor="middle" style="font-size:14px" fill="var(--on-navy)">★</text>
          </g>
          <rect x="${lostPoint.x - 46}" y="${lostPoint.y - 46}" width="92" height="22" rx="11" fill="var(--navy)"/>
          <text x="${lostPoint.x}" y="${lostPoint.y - 31}" text-anchor="middle" class="time-chip" fill="var(--on-navy)">${lostPoint.label} 유실</text>
        </g>`;
        reports.forEach(r => {
          const c = STATUS_COLOR[r.status] || STATUS_COLOR.pending;
          html += `<g class="pin" data-id="${r.id}" tabindex="0" role="button" aria-label="${r.seenAt} ${r.place} 제보">
            <g class="pin-body">
              <path d="M${r.x} ${r.y + 16} C${r.x - 13} ${r.y + 2} ${r.x - 13} ${r.y - 14} ${r.x} ${r.y - 14} C${r.x + 13} ${r.y - 14} ${r.x + 13} ${r.y + 2} ${r.x} ${r.y + 16} Z"
                fill="${c}" stroke="var(--surface)" stroke-width="${activeId === r.id ? 3.5 : 2.5}"/>
              <circle cx="${r.x}" cy="${r.y - 2}" r="5" fill="var(--surface)"/>
            </g>
            <rect x="${r.x - 27}" y="${r.y - 44}" width="54" height="21" rx="10.5" fill="var(--surface)" stroke="${c}" stroke-width="1.5"/>
            <text x="${r.x}" y="${r.y - 29}" text-anchor="middle" class="time-chip" fill="${c}">${r.seenAt}</text>
          </g>`;
        });
        layer("pins").innerHTML = html;
        layer("pins").querySelectorAll(".pin[data-id]").forEach(el => {
          const open = () => opts.onPinClick && opts.onPinClick(+el.dataset.id);
          el.addEventListener("click", open);
          el.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
        });
      },
    };
  }

  /* ══════════ 카카오맵 백엔드 ══════════ */
  function createKakaoEngine(kakao, container, opts) {
    container.innerHTML = `<div class="kakao-host"></div>`;
    const host = container.querySelector(".kakao-host");
    const center = xyToLatLng(W / 2, H / 2);
    const map = new kakao.maps.Map(host, {
      center: new kakao.maps.LatLng(center.lat, center.lng),
      level: 4,
    });
    let overlays = [], shapes = [], pickOverlay = null;

    function clear(list) { list.forEach(o => o.setMap(null)); return []; }
    function pinOverlay(x, y, { cls, color, chip, onClick, z }) {
      const p = xyToLatLng(x, y);
      const el = document.createElement("div");
      el.className = "kpin " + (cls || "");
      if (color) el.style.color = color;
      el.innerHTML = `<span class="kp-chip">${chip}</span><span class="kp-drop"><span class="kp-dot"></span></span>`;
      if (onClick) el.addEventListener("click", onClick);
      const ov = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(p.lat, p.lng),
        content: el, yAnchor: 1, zIndex: z || 3,
      });
      ov.setMap(map);
      return ov;
    }

    if (opts.mode === "pick") {
      kakao.maps.event.addListener(map, "click", (e) => {
        const { x, y } = latLngToXy(e.latLng.getLat(), e.latLng.getLng());
        opts.onPick && opts.onPick({ x: Math.round(x), y: Math.round(y) });
      });
    }

    const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

    return {
      backend: "kakao",
      setMarker(x, y) {
        if (pickOverlay) pickOverlay.setMap(null);
        pickOverlay = pinOverlay(x, y, { color: css("--pending") || "#E8842C", chip: "목격 위치", z: 9 });
      },
      clearMarker() { if (pickOverlay) { pickOverlay.setMap(null); pickOverlay = null; } },
      render({ lostPoint, reports, activeId, trail, zone }) {
        overlays = clear(overlays); shapes = clear(shapes);

        if (zone) {
          const zc = xyToLatLng(zone.x, zone.y);
          const circle = new kakao.maps.Circle({
            center: new kakao.maps.LatLng(zc.lat, zc.lng), radius: 130,
            strokeWeight: 2, strokeColor: css("--zone") || "#2E63C0", strokeStyle: "dash",
            fillColor: css("--zone") || "#2E63C0", fillOpacity: 0.15,
          });
          circle.setMap(map); shapes.push(circle);
        }
        const pts = [[lostPoint.x, lostPoint.y], ...trail.map(r => [r.x, r.y])]
          .map(([x, y]) => { const p = xyToLatLng(x, y); return new kakao.maps.LatLng(p.lat, p.lng); });
        if (pts.length > 1) {
          const line = new kakao.maps.Polyline({
            path: pts, strokeWeight: 3, strokeColor: css("--navy") || "#1D3E6B",
            strokeOpacity: 0.85, strokeStyle: "shortdash",
          });
          line.setMap(map); shapes.push(line);
        }
        overlays.push(pinOverlay(lostPoint.x, lostPoint.y,
          { cls: "kp-star", chip: lostPoint.label + " 유실", z: 5 }));
        reports.forEach(r => {
          overlays.push(pinOverlay(r.x, r.y, {
            color: css("--" + (r.status === "pending" ? "pending" : r.status === "trusted" ? "trust" :
              r.status === "important" ? "important" : "hidden")) || "#E8842C",
            chip: r.seenAt,
            z: activeId === r.id ? 8 : 4,
            onClick: () => opts.onPinClick && opts.onPinClick(r.id),
          }));
        });
      },
    };
  }

  /* ══════════ 팩토리 ══════════ */
  window.MapEngine = {
    xyToLatLng, latLngToXy,
    /* container에 지도를 만들고 engine 객체를 콜백으로 넘긴다.
       카카오 키가 있으면 카카오맵, 실패하거나 없으면 SVG 폴백 */
    create(container, opts, ready) {
      if (CFG.KAKAO_MAP_KEY) {
        loadKakao()
          .then(kakao => ready(createKakaoEngine(kakao, container, opts)))
          .catch(err => {
            console.warn("카카오맵 로드 실패, SVG 지도로 폴백:", err.message);
            ready(createSvgEngine(container, opts));
          });
      } else {
        ready(createSvgEngine(container, opts));
      }
    },
  };
})();
