# ระบบติดตามแหล่งหญ้าทะเล

## วิธีรันระบบ

ต้องมี Docker Desktop และ Docker Compose รันจากโฟลเดอร์นี้:

```powershell
docker compose up --build -d --wait
```

ไม่ต้องสร้าง `.env` ก่อน Compose ใช้ค่า demo จาก [.env.example](.env.example) API สร้างตารางด้วย migration และนำเข้า `seed-data/` อัตโนมัติ (รายงานแถวที่ไม่รับเข้าอยู่ที่ `reports/import_report.csv`) ส่วน job `import-tiles` นำเข้าแปลงอ้างอิงจาก `seagrass_large_utm.zip` ให้ Martin

| บริการ | URL |
| --- | --- |
| หน้าเว็บ | http://localhost:3000/ |
| API health | http://localhost:3001/health |
| เอกสาร API (Swagger) | http://localhost:3001/docs |
| ตัวอย่างเรียก API | [api-examples.http](api-examples.http) |

วัดเวลาตั้งแต่สั่ง `up` จน `/health` ตอบ `db: ok` (ถ้าต้องการวัดแบบติดตั้งใหม่ ให้รัน `docker compose down -v` ก่อน ซึ่งจะลบข้อมูลในฐาน):

```powershell
$sw = [Diagnostics.Stopwatch]::StartNew(); docker compose up -d; do { Start-Sleep -Milliseconds 500; try { $h = Invoke-RestMethod http://127.0.0.1:3001/health -TimeoutSec 2 } catch { $h = $null } } until ($h.db -eq 'ok' -or $sw.Elapsed.TotalSeconds -gt 300); if ($h.db -eq 'ok') { "health ok: $([math]::Round($sw.Elapsed.TotalSeconds,1)) s" } else { 'timeout: docker compose logs api' }
```

ใน PowerShell ให้ใช้ `127.0.0.1` แทน `localhost` เพราะ port เปิดไว้เฉพาะ IPv4 แต่ Windows PowerShell 5.1 จะลอง `localhost` เป็น IPv6 (`::1`) ก่อน จึงรอจน timeout

## บัญชีทดสอบ

| Email | Role | Password |
| --- | --- | --- |
| `viewer@demo.local` | viewer | `viewer-demo-only` |
| `editor@demo.local` | editor | `editor-demo-only` |
| `admin@demo.local` | admin | `admin-demo-only` |

รหัสผ่านเปลี่ยนได้ด้วย `DEMO_VIEWER_PASSWORD`, `DEMO_EDITOR_PASSWORD`, `DEMO_ADMIN_PASSWORD` ใน `.env`

## วิธีรัน test

ขั้นที่ทำเสร็จ: 1–6, 9.1 (vector tiles) และ 9.5 (CI)

```powershell
cd gis-api
npm ci --ignore-scripts
npm run test:unit
```

```powershell
cd gis-web
npm ci --ignore-scripts
npm run test:unit
```

Integration test (API กับ PostGIS จริง รวม `OUTSIDE_SITE` และ `VERSION_CONFLICT`) ต้องใช้ฐานข้อมูลทดสอบแยก ชื่อฐานต้องมีคำว่า `test` เพราะ test ล้างตาราง:

```powershell
docker run -d --rm --name gis-test-db -e POSTGRES_DB=gis_test -e POSTGRES_USER=gis_test -e POSTGRES_PASSWORD=test-only -p 127.0.0.1:55432:5432 postgis/postgis:16-3.5
cd gis-api
$env:DATABASE_URL = 'postgresql://gis_test:test-only@127.0.0.1:55432/gis_test'
npm run test:integration
docker stop gis-test-db
```

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) รัน test ทั้งหมดและ build image ทุกครั้งที่ push
