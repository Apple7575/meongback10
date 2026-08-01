/* 멍백홈 지도 엔진
 * - config.js의 KAKAO_MAP_KEY가 있으면 실제 카카오맵, 없으면 자체 SVG 도식 지도
 * - view 모드: 유실 지점 + 제보 마커(핀/방향화살표) + 시간순 경로 + 우선 수색 구역
 * - pick 모드: 탭해서 위치 선택 (방향은 페이지 로직에서 setMarker(x,y,bearing)로 미리보기)
 * - 방향(bearing): 북=0, 시계방향 0~360도. null이면 핀, 숫자면 화살표
 */
(function () {
  const CFG = window.MUNGBAEK_CONFIG || {};
  const GEO = CFG.GEO || { centerLat: 37.6447, centerLng: 127.0763, latSpan: 0.00757, lngSpan: 0.01385 };
  const W = 820, H = 560;

  /* 프레임(820x560) 중심의 실제 위경도. 공고마다 다를 수 있어 런타임에 바꿀 수 있게 함.
     create() 호출 전에 setGeoCenter(lat,lng)로 지정하면 그 위치를 중심으로 지도가 뜬다. */
  function setGeoCenter(lat, lng) {
    lat = Number(lat); lng = Number(lng);
    if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
      GEO.centerLat = lat; GEO.centerLng = lng;
    }
  }

  /* 제보 글자를 SVG에 넣기 전 이스케이프 (목격자 입력이 태그로 해석되지 않게) */
  const E = (v) => String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  const STATUS_COLOR = {
    trusted: "var(--trust)", pending: "var(--pending)",
    important: "var(--important)", hidden: "var(--hidden)",
  };
  const color = (s) => STATUS_COLOR[s] || STATUS_COLOR.pending;

  /* ── 방향 헬퍼 ── */
  const COMPASS8 = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];
  function bearingToKo(b) {
    if (b === null || b === undefined || isNaN(b)) return null;
    const i = Math.round((((b % 360) + 360) % 360) / 45) % 8;
    return COMPASS8[i] + "쪽으로 이동";
  }
  /* SVG 좌표계(위=-y)에서 (x0,y0)→(x1,y1) 방향의 나침반 각도 */
  function bearingFromXY(x0, y0, x1, y1) {
    const deg = Math.atan2(x1 - x0, -(y1 - y0)) * 180 / Math.PI;
    return ((Math.round(deg) % 360) + 360) % 360;
  }

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

  /* ── SVG 마커 빌더 ── */
  function svgPinMarker(r, active) {
    const c = color(r.status), x = r.x, y = r.y, sw = active ? 3.5 : 2.5;
    return `<g class="pin" data-id="${+r.id}" tabindex="0" role="button" aria-label="${E(r.seenAt)} ${E(r.place)} 제보">
      <g class="pin-body">
        <path d="M${x} ${y + 16} C${x - 13} ${y + 2} ${x - 13} ${y - 14} ${x} ${y - 14} C${x + 13} ${y - 14} ${x + 13} ${y + 2} ${x} ${y + 16} Z"
          fill="${c}" stroke="var(--surface)" stroke-width="${sw}"/>
        <circle cx="${x}" cy="${y - 2}" r="5" fill="var(--surface)"/>
      </g>
      <rect x="${x - 27}" y="${y - 44}" width="54" height="21" rx="10.5" fill="var(--surface)" stroke="${c}" stroke-width="1.5"/>
      <text x="${x}" y="${y - 29}" text-anchor="middle" class="time-chip" fill="${c}">${E(r.seenAt)}</text>
    </g>`;
  }
  function svgArrowMarker(r, active) {
    const c = color(r.status), x = r.x, y = r.y, sw = active ? 3.5 : 2.5;
    return `<g class="pin" data-id="${+r.id}" tabindex="0" role="button" aria-label="${E(r.seenAt)} ${E(r.place)} ${bearingToKo(r.bearing) || "방향"} 제보">
      <g class="pin-body">
        <g transform="rotate(${+r.bearing || 0} ${x} ${y})">
          <path d="M${x} ${y} L${x} ${y - 22}" stroke="${c}" stroke-width="4.5" stroke-linecap="round"/>
          <path d="M${x} ${y - 34} L${x - 8.5} ${y - 19} L${x + 8.5} ${y - 19} Z"
            fill="${c}" stroke="var(--surface)" stroke-width="1.5" stroke-linejoin="round"/>
        </g>
        <circle cx="${x}" cy="${y}" r="6" fill="${c}" stroke="var(--surface)" stroke-width="${sw}"/>
      </g>
      <rect x="${x - 27}" y="${y + 10} " width="54" height="21" rx="10.5" fill="var(--surface)" stroke="${c}" stroke-width="1.5"/>
      <text x="${x}" y="${y + 25}" text-anchor="middle" class="time-chip" fill="${c}">${E(r.seenAt)}</text>
    </g>`;
  }
  const svgMarker = (r, active) =>
    (r.bearing === null || r.bearing === undefined) ? svgPinMarker(r, active) : svgArrowMarker(r, active);

  /* 카카오 SDK 로더 */
  let kakaoPromise = null;
  function loadKakao() {
    if (kakaoPromise) return kakaoPromise;
    kakaoPromise = new Promise((resolve, reject) => {
      if (!CFG.KAKAO_MAP_KEY) { reject(new Error("no key")); return; }
      const s = document.createElement("script");
      // services — 장소·주소 검색용 (노트북처럼 GPS가 없는 기기에서 위치를 직접 찾을 수 있게)
      s.src = "https://dapi.kakao.com/v2/maps/sdk.js?appkey=" + CFG.KAKAO_MAP_KEY
            + "&autoload=false&libraries=services";
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

    svg.addEventListener("click", (e) => {
      if (e.target.closest(".pin")) return;   // 마커 클릭은 배경 탭에서 제외
      const r = svg.getBoundingClientRect();
      const x = Math.round((e.clientX - r.left) / r.width * W);
      const y = Math.round((e.clientY - r.top) / r.height * H);
      if (opts.mode === "pick") opts.onPick && opts.onPick({ x, y });
      else opts.onMapTap && opts.onMapTap({ x, y });
    });
    if (opts.mode === "pick") svg.style.cursor = "crosshair";

    return {
      backend: "svg",
      setPickable(on) { svg.style.cursor = on ? "crosshair" : ""; },
      setCenter() {},   /* SVG 도식 지도는 중심 개념이 없음 (no-op) */
      lockPan(on) { svg.style.touchAction = on ? "none" : ""; },
      clientToXy(clientX, clientY) {
        const r = svg.getBoundingClientRect();
        return {
          x: Math.round((clientX - r.left) / r.width * W),
          y: Math.round((clientY - r.top) / r.height * H),
        };
      },
      element() { return svg; },
      setMarker(x, y, bearing) {
        const c = "var(--pending)";
        if (bearing === null || bearing === undefined) {
          layer("pick").innerHTML = `
            <circle cx="${x}" cy="${y}" r="26" fill="color-mix(in srgb, var(--pending) 25%, transparent)"/>
            <path d="M${x} ${y + 18} C${x - 14} ${y + 3} ${x - 14} ${y - 15} ${x} ${y - 15} C${x + 14} ${y - 15} ${x + 14} ${y + 3} ${x} ${y + 18} Z"
              fill="${c}" stroke="var(--surface)" stroke-width="2.5"/>
            <circle cx="${x}" cy="${y - 3}" r="5" fill="var(--surface)"/>`;
        } else {
          layer("pick").innerHTML = `
            <circle cx="${x}" cy="${y}" r="26" fill="color-mix(in srgb, var(--pending) 25%, transparent)"/>
            <g transform="rotate(${bearing} ${x} ${y})">
              <path d="M${x} ${y} L${x} ${y - 24}" stroke="${c}" stroke-width="5" stroke-linecap="round"/>
              <path d="M${x} ${y - 37} L${x - 9} ${y - 20} L${x + 9} ${y - 20} Z"
                fill="${c}" stroke="var(--surface)" stroke-width="1.5" stroke-linejoin="round"/>
            </g>
            <circle cx="${x}" cy="${y}" r="6.5" fill="${c}" stroke="var(--surface)" stroke-width="2.5"/>`;
        }
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

        let html = `<g class="pin" tabindex="0" role="button" aria-label="마지막 목격 지점 ${E(lostPoint.place)} ${E(lostPoint.label)}">
          <g class="pin-body">
            <circle cx="${lostPoint.x}" cy="${lostPoint.y}" r="15" fill="var(--navy)" stroke="var(--surface)" stroke-width="3"/>
            <text x="${lostPoint.x}" y="${lostPoint.y + 5}" text-anchor="middle" style="font-size:14px" fill="var(--on-navy)">★</text>
          </g>
          <rect x="${lostPoint.x - 46}" y="${lostPoint.y - 46}" width="92" height="22" rx="11" fill="var(--navy)"/>
          <text x="${lostPoint.x}" y="${lostPoint.y - 31}" text-anchor="middle" class="time-chip" fill="var(--on-navy)">${E(lostPoint.label)} 유실</text>
        </g>`;
        reports.forEach(r => { html += svgMarker(r, activeId === r.id); });
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
      center: new kakao.maps.LatLng(center.lat, center.lng), level: 4,
    });
    let overlays = [], shapes = [], pickOverlay = null;
    const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || v;
    const clear = (list) => { list.forEach(o => o.setMap(null)); return []; };

    function markerEl({ color: cc, chip, bearing, star, onClick }) {
      const el = document.createElement("div");
      el.className = "kpin" + (star ? " kp-star" : "");
      el.style.color = cc;
      if (bearing === null || bearing === undefined) {
        el.innerHTML = `<span class="kp-chip">${E(chip)}</span><span class="kp-drop"><span class="kp-dot"></span></span>`;
      } else {
        el.classList.add("karrow");
        el.innerHTML =
          `<span class="ka-shaft" style="transform:rotate(${+bearing || 0}deg)"></span>` +
          `<span class="ka-dot"></span><span class="ka-chip">${E(chip)}</span>`;
      }
      if (onClick) el.addEventListener("click", onClick);
      return el;
    }
    function overlay(x, y, cfg, z) {
      const p = xyToLatLng(x, y);
      const isArrow = cfg.bearing !== null && cfg.bearing !== undefined;
      const ov = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(p.lat, p.lng),
        content: markerEl(cfg), zIndex: z || 3,
        yAnchor: isArrow ? 0.5 : 1, xAnchor: 0.5,
      });
      ov.setMap(map);
      return ov;
    }

    kakao.maps.event.addListener(map, "click", (e) => {
      const { x, y } = latLngToXy(e.latLng.getLat(), e.latLng.getLng());
      if (opts.mode === "pick") opts.onPick && opts.onPick({ x: Math.round(x), y: Math.round(y) });
      else opts.onMapTap && opts.onMapTap({ x: Math.round(x), y: Math.round(y) });
    });
    const statColor = (s) => css("--" + (s === "trusted" ? "trust" : s === "important" ? "important" : s === "hidden" ? "hidden" : "pending"));

    return {
      backend: "kakao",
      setPickable() {},
      /* 방향을 드래그로 정하는 동안은 지도가 따라 움직이지 않게 잠근다 */
      lockPan(on) {
        map.setDraggable(!on);
        map.setZoomable(!on);
        host.style.touchAction = on ? "none" : "";
      },
      /* 화면 좌표(clientX/Y) → 프레임 좌표(x,y) */
      clientToXy(clientX, clientY) {
        const r = host.getBoundingClientRect();
        const proj = map.getProjection();
        const ll = proj.coordsFromContainerPoint(
          new kakao.maps.Point(clientX - r.left, clientY - r.top));
        const p = latLngToXy(ll.getLat(), ll.getLng());
        return { x: Math.round(p.x), y: Math.round(p.y) };
      },
      element() { return host; },
      setCenter(x, y) {
        const p = xyToLatLng(x, y);
        map.setCenter(new kakao.maps.LatLng(p.lat, p.lng));
      },
      setMarker(x, y, bearing) {
        if (pickOverlay) pickOverlay.setMap(null);
        pickOverlay = overlay(x, y, { color: css("--pending"), chip: "목격", bearing: bearing ?? null }, 9);
      },
      clearMarker() { if (pickOverlay) { pickOverlay.setMap(null); pickOverlay = null; } },
      render({ lostPoint, reports, activeId, trail, zone }) {
        overlays = clear(overlays); shapes = clear(shapes);
        if (zone) {
          const zc = xyToLatLng(zone.x, zone.y);
          const circle = new kakao.maps.Circle({
            center: new kakao.maps.LatLng(zc.lat, zc.lng), radius: 130,
            strokeWeight: 2, strokeColor: css("--zone"), strokeStyle: "dash",
            fillColor: css("--zone"), fillOpacity: 0.15,
          });
          circle.setMap(map); shapes.push(circle);
        }
        const pts = [[lostPoint.x, lostPoint.y], ...trail.map(r => [r.x, r.y])]
          .map(([x, y]) => { const p = xyToLatLng(x, y); return new kakao.maps.LatLng(p.lat, p.lng); });
        if (pts.length > 1) {
          const line = new kakao.maps.Polyline({
            path: pts, strokeWeight: 3, strokeColor: css("--navy"),
            strokeOpacity: 0.85, strokeStyle: "shortdash",
          });
          line.setMap(map); shapes.push(line);
        }
        overlays.push(overlay(lostPoint.x, lostPoint.y,
          { color: css("--navy"), chip: lostPoint.label + " 유실", bearing: null, star: true }, 5));
        reports.forEach(r => {
          overlays.push(overlay(r.x, r.y, {
            color: statColor(r.status), chip: r.seenAt, bearing: r.bearing ?? null,
            onClick: () => opts.onPinClick && opts.onPinClick(r.id),
          }, activeId === r.id ? 8 : 4));
        });
      },
    };
  }

  /* ── 나침반(기기 방향) ──
   * watchHeading(cb): 폰을 돌릴 때마다 cb({heading, absolute})를 계속 호출한다.
   *   지도앱처럼 방향 화살표를 실시간으로 돌리는 용도.
   *   첫 측정값이 들어오면 "멈추는 함수"로 resolve → 센서가 실제로 되는지도 이때 판별된다.
   */
  function screenAngle() {
    const a = (screen.orientation && screen.orientation.angle);
    return typeof a === "number" ? a : (window.orientation || 0);
  }

  function watchHeading(onReading) {
    return new Promise((resolve, reject) => {
      if (!window.DeviceOrientationEvent) { reject(new Error("이 기기는 방향 센서를 지원하지 않아요")); return; }
      const start = () => {
        let got = false, timer = null;
        const handler = (e) => {
          let h = null, absolute = true;
          if (e.webkitCompassHeading !== undefined && e.webkitCompassHeading !== null) {
            h = e.webkitCompassHeading;                 // iOS — 이미 진북 기준
          } else if (e.alpha !== null && e.alpha !== undefined) {
            h = 360 - e.alpha;                          // alpha는 반시계 → 나침반 방향
            absolute = e.absolute !== false;            // 절대 방위가 아니면 부정확할 수 있음
          }
          if (h === null || isNaN(h)) return;
          h = (((Math.round(h + screenAngle()) % 360) + 360) % 360);   // 가로모드 보정
          if (!got) { got = true; clearTimeout(timer); resolve(stop); }
          onReading({ heading: h, absolute });
        };
        const stop = () => {
          clearTimeout(timer);
          window.removeEventListener("deviceorientationabsolute", handler, true);
          window.removeEventListener("deviceorientation", handler, true);
        };
        window.addEventListener("deviceorientationabsolute", handler, true);
        window.addEventListener("deviceorientation", handler, true);
        timer = setTimeout(() => { if (!got) { stop(); reject(new Error("방향을 읽지 못했어요")); } }, 3000);
      };
      // iOS 13+ 권한 요청 (사용자 탭에서 호출되어야 함)
      if (typeof DeviceOrientationEvent.requestPermission === "function") {
        DeviceOrientationEvent.requestPermission()
          .then(p => p === "granted" ? start() : reject(new Error("방향 센서 권한이 필요해요")))
          .catch(() => reject(new Error("방향 센서 권한 요청에 실패했어요")));
      } else {
        start();
      }
    });
  }

  /* ── 장소·주소 검색 ──
   * "전주역", "노원구 중계동" 처럼 입력하면 후보 목록을 돌려준다.
   * 카카오맵이 없을 때(SVG 폴백)는 사용할 수 없다.
   */
  function searchPlace(query) {
    query = String(query || "").trim();
    if (!query) return Promise.resolve([]);
    return loadKakao().then(kakao => new Promise((resolve, reject) => {
      const svc = kakao.maps.services;
      if (!svc) { reject(new Error("장소 검색을 쓸 수 없어요")); return; }
      const pack = (list) => list.slice(0, 6).map(p => ({
        name: p.place_name || p.address_name,
        address: p.road_address_name || p.address_name || "",
        lat: parseFloat(p.y), lng: parseFloat(p.x),
      }));
      new svc.Places().keywordSearch(query, (data, status) => {
        if (status === svc.Status.OK && data.length) { resolve(pack(data)); return; }
        // 키워드로 못 찾으면 주소로 한 번 더
        new svc.Geocoder().addressSearch(query, (adr, st2) => {
          if (st2 === svc.Status.OK && adr.length) {
            resolve(adr.slice(0, 6).map(a => ({
              name: a.address_name,
              address: (a.road_address && a.road_address.address_name) || "",
              lat: parseFloat(a.y), lng: parseFloat(a.x),
            })));
          } else resolve([]);
        });
      });
    }));
  }

  /* 한 번만 읽고 끝내는 버전 (호환용) */
  function captureHeading() {
    let first = null;
    return watchHeading(r => { if (first === null) first = r.heading; })
      .then(stop => { stop(); return first; });
  }

  /* ══════════ 팩토리 ══════════ */
  window.MapEngine = {
    xyToLatLng, latLngToXy, bearingToKo, bearingFromXY, captureHeading, watchHeading,
    setGeoCenter, searchPlace,
    hasCompass: !!window.DeviceOrientationEvent,
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
