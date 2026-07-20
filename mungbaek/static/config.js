/* 멍백홈 환경 설정
 *
 * KAKAO_MAP_KEY: 카카오맵 JavaScript 키를 넣으면 도식 지도 대신 실제 카카오맵이 뜹니다.
 *   1) https://developers.kakao.com → 내 애플리케이션 → 앱 만들기
 *   2) 앱 설정 > 플랫폼 > Web 플랫폼 등록 → 사이트 도메인에 http://localhost:8000 추가
 *   3) 앱 키 중 "JavaScript 키"를 아래에 붙여넣기
 * 비워두면 자체 SVG 도식 지도로 동작합니다 (데모는 이걸로 충분해요).
 */
window.MUNGBAEK_CONFIG = {
  KAKAO_MAP_KEY: "28730e33b262d73b246526cf8fbd715d",

  /* SVG 좌표(820x560) ↔ 실제 위경도 변환 기준.
     중계근린공원(노원구) 일대를 가로 약 1.2km 박스로 가정한 값 — 실지도 연동 시 필요하면 조정 */
  GEO: {
    centerLat: 37.6447,
    centerLng: 127.0763,
    latSpan: 0.00757,   /* 세로 560px ≈ 840m */
    lngSpan: 0.01385,   /* 가로 820px ≈ 1,230m */
  },
};
