# 멍백홈 · 사용자 플로우

실제 구현된 화면과 동작 기준. (2026-07-31)

---

## 1. 전체 플로우

```mermaid
flowchart TD
    Start(["멍백홈 열기<br/>mungbaek-home.onrender.com"])
    Saved{"이 기기에 저장된<br/>내 공고가 있나?"}
    Home["첫 화면<br/>강아지를 잃어버리셨나요?"]

    subgraph OWNER ["보호자 · 강아지를 잃어버린 사람"]
        direction TB
        New["공고 등록<br/>/new"]
        NewForm["사진 · 이름 · 견종<br/>나이/체중은 숫자 입력<br/>발견 시 안내는 선택형"]
        Loc["유실 위치 정하기<br/>현재 위치 · 장소 검색 · 지도 탭"]
        Pin["관리용 PIN 4자리 정하기"]
        Issue["공고 생성<br/>공개 제보 링크 + 비밀 관리 링크 발급<br/>이 기기에 자동 저장"]
        Share["전단지 화면<br/>/share"]
        SaveImg["전단지 이미지 저장<br/>카톡·당근·인스타로 전송"]
        CopyLink["제보 링크 복사"]
        Manage["내 관리 링크 보관<br/>나만 갖는 비밀 링크"]

        Map["유실목격지도<br/>제보가 모이는 곳"]
        NewReport["새 제보 도착<br/>2초마다 확인 + 알림"]
        Judge{"제보 판단"}
        Trust["신뢰<br/>이동 경로·우선 수색 구역에 반영"]
        Hide["숨김<br/>지도에서 제외"]
        Call["전화 · 문자<br/>연락처를 남긴 제보만"]
        AddSelf["직접 제보 추가<br/>전화로 받은 목격 정보 기록<br/>지도 탭 후 끌어서 방향"]
        Switch["공고 여러 개 전환"]
        Found["찾았어요 · 수색 종료"]

        New --> NewForm --> Loc --> Pin --> Issue --> Share
        Share --> SaveImg
        Share --> CopyLink
        Share --> Manage
        Share --> Map
        Map --> NewReport --> Judge
        Judge --> Trust
        Judge --> Hide
        Judge --> Call
        Map --> AddSelf --> Map
        Map --> Switch
        Map --> Found
    end

    subgraph WITNESS ["목격자 · 강아지를 본 사람 (가입·로그인 없음)"]
        direction TB
        QR(["QR 스캔 또는 링크 받음"])
        Dogs["찾고 있는 강아지 목록<br/>/dogs"]
        Pick["본 강아지 선택<br/>위치 허용 시 가까운 순 정렬"]
        Report["제보 화면<br/>/r/공고id"]
        W1["언제 봤나요"]
        W2["어디서 봤나요<br/>현재 위치 · 지도 탭"]
        W3["어느 쪽으로 갔나요<br/>지도에서 끌기 · 나침반 · 방향 없음"]
        W4["장소 설명 · 상황 · 사진<br/>연락처는 선택"]
        Send["제보 보내기"]
        Done(["전달 완료"])

        QR --> Report
        Dogs --> Pick --> Report
        Report --> W1 --> W2 --> W3 --> W4 --> Send --> Done
    end

    subgraph RECOVER ["기기를 바꿨을 때"]
        direction TB
        Find["내 공고 찾기<br/>/find"]
        FindForm["강아지 이름 + 나이 + PIN 4자리"]
        Find --> FindForm
    end

    Start --> Saved
    Saved -->|"있다"| Map
    Saved -->|"없다"| Home
    Home --> New
    Home --> Dogs
    Home --> Find

    CopyLink -.->|"링크 전달"| QR
    SaveImg -.->|"전단지의 QR"| QR
    Send ==>|"실시간 반영"| NewReport
    FindForm -->|"관리 권한 재발급"| Map
    Manage -.->|"다음 접속"| Saved
```

---

## 2. 누가 무엇을 할 수 있나 (로그인 없는 권한 모델)

```mermaid
sequenceDiagram
    autonumber
    actor O as 보호자
    participant S as 멍백홈 서버
    actor W as 목격자

    O->>S: 공고 등록 + PIN 4자리
    S-->>O: 공개 링크 + 비밀 관리 링크
    Note over O: 관리 링크는 기기에 저장<br/>다음부터 앱만 열면 바로 진입

    O-->>W: 공개 링크 · QR · 전단지 전달
    W->>S: 목격 제보 (인증 없음)
    Note over S: 상태는 항상 "확인 필요"로 고정<br/>목격자는 조작 불가
    S-->>O: 2초 안에 지도에 표시

    O->>S: 신뢰/숨김 변경 (비밀 키 첨부)
    S-->>O: 반영

    W->>S: 남의 제보 상태 변경 시도
    S-->>W: 거부 (403)

    Note over O,S: 기기를 바꿨다면
    O->>S: 이름 + 나이 + PIN
    S-->>O: 관리 권한 재발급
    Note over S: 5회 틀리면 10분 잠금<br/>기기당 10회 실패 시 차단
```

---

## 3. 화면 목록

| 주소 | 누구 | 하는 일 |
| --- | --- | --- |
| `/` | 보호자 | 저장된 공고가 있으면 유실목격지도, 없으면 첫 화면 |
| `/new` | 보호자 | 공고 등록 (사진·정보·위치·PIN) |
| `/share` | 보호자 | 전단지 이미지 생성·저장, 링크 복사, 관리 링크 보관 |
| `/m/<비밀키>` | 보호자 | 관리 화면 진입 (열면 기기에 저장되고 주소에서 키 제거) |
| `/find` | 보호자 | 이름 + 나이 + PIN으로 관리 권한 되찾기 |
| `/dogs` | 목격자 | 찾고 있는 강아지 목록, 가까운 순 정렬 |
| `/r/<공고id>` | 목격자 | 목격 제보 (가입·로그인 없음) |
