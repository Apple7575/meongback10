# 멍백홈 배포 가이드

순서대로 따라 하면 됩니다. **1번(카카오맵 켜기)은 5분이면 끝나고, 3번(Render 배포)까지 하면 인터넷 어디서든 접속되는 진짜 서비스가 됩니다.**

---

## 1. 카카오맵 활성화 (지금 바로, 5분)

키(`28730e...715d`)는 이미 config.js에 들어있고 유효합니다.
확인해보니 딱 하나가 막혀 있어요:

> `App(멍백홈-TEST) disabled OPEN_MAP_AND_LOCAL service.`
> → **앱에서 "카카오맵" 서비스가 꺼져 있음**

### 켜는 방법

1. https://developers.kakao.com 로그인 → **내 애플리케이션** → **멍백홈-TEST** 클릭
2. 왼쪽 메뉴에서 **카카오맵** 클릭 (안 보이면 **제품 설정 > 카카오맵**)
3. **활성화 설정** 스위치를 **ON**으로 변경
4. 왼쪽 메뉴 **앱 설정 > 플랫폼** → **Web 플랫폼 등록** 클릭 → 사이트 도메인에 아래 추가:
   ```
   http://localhost:8000
   ```
   (여러 개 등록 가능 — 배포 후 배포 주소도 여기에 추가합니다. 3-4단계 참고)

### 확인

```
cd C:\Users\SSAFY\Desktop\새 폴더\mungbaek
py server.py
```
크롬에서 http://localhost:8000 접속 → 도식 지도 대신 **실제 카카오맵**(중계근린공원 일대)이 뜨고
그 위에 핀·경로·수색구역이 올라가면 성공.
실패하면 F12 → Console 탭의 에러 메시지를 보면 원인이 나옵니다.

---

## 2. GitHub에 코드 올리기 (10분)

git 저장소와 첫 커밋은 이미 만들어뒀습니다. 올리기만 하면 돼요.

1. https://github.com 가입/로그인
2. 오른쪽 위 **+** → **New repository**
   - Repository name: `mungbaek-home`
   - **Public** 선택 (무료 배포에 필요)
   - README 추가 체크 **하지 말 것** (이미 있음)
   - **Create repository**
3. PowerShell에서 (＜내아이디＞만 바꿔서):
   ```powershell
   cd "C:\Users\SSAFY\Desktop\새 폴더"
   git remote add origin https://github.com/<내아이디>/mungbaek-home.git
   git push -u origin main
   ```
   - 처음 push하면 브라우저 로그인 창이 뜹니다 → GitHub 로그인하면 끝
4. GitHub 저장소 페이지를 새로고침해서 파일이 올라갔는지 확인

---

## 3. Render로 배포 (15분, 무료·카드 불필요)

Render는 GitHub 저장소를 연결하면 자동으로 서버를 돌려주는 무료 호스팅입니다.

1. https://render.com → **Get Started** → **Sign in with GitHub** (깃허브 계정으로 가입)
2. 대시보드에서 **New +** → **Web Service**
3. **mungbaek-home** 저장소 옆 **Connect** 클릭
4. 설정 입력:

   | 항목 | 값 |
   | --- | --- |
   | Name | `mungbaek-home` (이게 주소가 됨) |
   | Region | **Singapore** (한국에서 제일 빠름) |
   | Branch | `main` |
   | **Root Directory** | `mungbaek` ← 중요! |
   | Runtime | Python 3 |
   | Build Command | `pip install -r requirements.txt` |
   | Start Command | `python server.py` |
   | Instance Type | **Free** |

5. **Create Web Service** → 로그가 올라가고 1~3분 뒤 **Live** 초록불
6. 상단의 주소 클릭 → `https://mungbaek-home.onrender.com` 형태
   - `/` 보호자 지도, `/share` 공고·공유, `/r/kong-i` 목격자 제보 모두 확인

### 무료 플랜 주의사항 (발표 전 필독)

- **15분간 접속이 없으면 서버가 잠듭니다.** 다시 깨어나는 데 30~60초 걸림
  → **발표 5분 전에 미리 한 번 접속해두세요**
- **데이터가 영구 저장되지 않습니다.** 서버가 재시작되면 초기 더미 데이터로 리셋
  → 시연엔 오히려 좋음(항상 깨끗한 상태로 시작). 진짜 저장이 필요해지면 DB(PostgreSQL 등) 연동이 다음 단계

---

## 4. 배포 주소를 카카오에 등록 (2분)

배포가 되면 카카오맵이 새 도메인에서도 뜨도록 등록:

1. developers.kakao.com → 멍백홈-TEST → **앱 설정 > 플랫폼** → Web 사이트 도메인에 추가:
   ```
   https://mungbaek-home.onrender.com
   ```
   (본인의 실제 Render 주소로)
2. 저장하면 바로 적용 — 배포된 사이트에서 카카오맵 확인

> 참고: JavaScript 키는 코드에 들어가도 괜찮습니다. 등록된 도메인에서만 동작하도록 카카오가 막아주기 때문이에요. 그래서 도메인 등록이 꼭 필요한 것.

---

## 4-2. 데이터가 사라지지 않게 DB 연결 (베타 전 필수)

Render 무료 플랜은 **15분간 접속이 없으면 서버가 잠들고, 깨어날 때 저장 파일이 초기화**됩니다.
공고와 제보가 통째로 사라지므로, 실제 사용자를 받으려면 외부 DB가 필요합니다.

`DATABASE_URL` 환경변수만 넣으면 자동으로 PostgreSQL에 저장되고, 없으면 지금처럼 파일에 저장됩니다.

### Supabase로 연결하기 (무료)

1. https://supabase.com → **Start your project** → GitHub로 로그인
2. **New project**
   - Name: `mungbaek`
   - Database Password: **직접 정하고 어딘가 적어두세요** (연결 문자열에 들어갑니다)
   - Region: **Northeast Asia (Seoul)**
   - **Create new project** → 1~2분 대기
3. 왼쪽 아래 **Project Settings**(톱니) → **Database**
4. **Connection string** 항목에서 **Session pooler** 탭 선택 ← 중요
   - Direct connection은 IPv6 전용이라 Render에서 연결되지 않습니다. 반드시 **Session pooler**(IPv4)를 쓰세요.
   - 형태: `postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres`
5. 복사한 문자열에서 `[YOUR-PASSWORD]` 를 2번에서 정한 실제 비밀번호로 바꿉니다.
6. Render 대시보드 → **mungbaek-home** → **Environment** → **Add Environment Variable**
   - Key: `DATABASE_URL`
   - Value: 5번에서 완성한 문자열
   - **Save changes** → 자동 재배포 (1~3분)

### 연결됐는지 확인

```
https://mungbaek-home.onrender.com/api/health
```

- `{"store": "postgres", ...}` → **연결 성공.** 이제 데이터가 사라지지 않습니다.
- `{"store": "file", "note": "DB 연결 실패 — ..."}` → note에 원인이 그대로 나옵니다.
  - `password authentication failed` → 비밀번호를 잘못 붙여넣음
  - 연결 시간 초과 → Direct connection을 쓴 경우. **Session pooler** 문자열로 교체

> Neon(https://neon.tech)도 동일하게 동작합니다. 연결 문자열을 `DATABASE_URL`에 넣으면 됩니다.
> Supabase 무료 플랜은 1주일간 접속이 없으면 일시정지되며, 대시보드에서 다시 켤 수 있습니다.

---

## 5. 이후 코드를 수정했을 때

```powershell
cd "C:\Users\SSAFY\Desktop\새 폴더"
git add -A
git commit -m "수정 내용"
git push
```
push하면 Render가 **자동으로 재배포**합니다 (1~2분).

---

## 6. 발표 시연 꿀팁

- 배포 후에는 `/share`의 QR이 **진짜 인터넷 주소**로 생성됩니다
  → 발표장에서 청중이 각자 폰으로 QR 찍고 제보 → 스크린의 보호자 지도에 실시간으로 핀이 뜨는 시연 가능
- 보호자 지도에서 **🔔 알림 켜기**를 미리 눌러두면 새 제보가 OS 알림으로 옴 (https라서 배포 버전에서도 동작)
- 시연 리허설로 데이터가 쌓였다면: Render 대시보드 → **Manual Deploy > Deploy latest commit**으로 재시작하면 리셋

---

## 문제 해결

| 증상 | 원인/해결 |
| --- | --- |
| 지도가 도식 SVG로만 나옴 | F12 Console 확인. `disabled OPEN_MAP_AND_LOCAL` → 1번의 활성화 스위치. `domain mismatch` 계열 → 플랫폼에 현재 주소 등록 |
| Render 빌드 실패 | Root Directory가 `mungbaek`인지 확인 |
| 배포 주소 첫 접속이 느림 | 무료 플랜 슬립 — 30~60초 기다리면 됨 |
| push 시 인증 실패 | 브라우저 로그인 창 확인, 또는 `git credential-manager github login` |
| QR 찍었는데 안 열림 | 로컬(localhost) QR은 그 PC에서만 열림 — 배포 주소로 접속한 상태의 QR을 쓰거나, 같은 와이파이면 `http://<PC IP>:8000/share` 사용 |
