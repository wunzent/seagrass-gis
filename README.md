# GIS — ระบบติดตามแหล่งหญ้าทะเล

Repository นี้ (`gis-docs`) เก็บเอกสาร, `docker-compose.yml`, `seed-data/`, `reports/`, [DESIGN](DESIGN.md) และ [api-examples.http](api-examples.http); โค้ดแยกอยู่ใน GitLab repositories `gis-api` (NestJS) และ `gis-web` (Next.js) ใช้ PostgreSQL/PostGIS และ GitLab CI

> **Data disclaimer**: ข้อมูลใน `seed-data/` เป็นข้อมูลจำลองสำหรับแบบทดสอบ ไม่ใช่ขอบเขตจังหวัด แหล่งหญ้าทะเล หรือผลสำรวจจริง ห้ามนำไปใช้ตัดสินใจ

## Workspace Layout

clone ทั้งสาม repository ไว้ในโฟลเดอร์เดียวกัน เพราะ Compose build จาก `../gis-api` และ `../gis-web`:

```powershell
git clone -b feat/seagrass-monitoring https://gitlab.com/gis450547/gis-api.git
git clone -b feat/seagrass-monitoring https://gitlab.com/gis450547/gis-web.git
git clone -b feat/seagrass-monitoring https://gitlab.com/gis450547/gis-docs.git
```

```text
seagrass-gis/
├── gis-api/    NestJS API + migrations + api-docs/ + .gitlab-ci.yml
├── gis-web/    Next.js web + .gitlab-ci.yml
└── gis-docs/   docs/, docker-compose.yml, seed-data/, reports/ (รันคำสั่ง Compose จากที่นี่)
```

## Current Status

| Step | สิ่งที่ทำงานได้ | หลักฐาน |
|---|---|---|
| 1 Runtime | Compose 3 services, versioned migrations, `/health` ตรวจ PostGIS, ข้อมูลคงอยู่หลัง restart | fresh DB/restart proof |
| 2 Import | importer อัตโนมัติตอน start + รันซ้ำได้, `reports/import_report.csv` | unit + real PostGIS integration |
| 3 Site writes | POST/PATCH/DELETE `/sites` พร้อม optimistic locking (`version`) และ soft delete | real PostGIS e2e |
| 4 Surveys | CRUD survey, history, `/surveys.geojson`, `/provinces.geojson`, `/species` | real PostGIS e2e |
| 5 Auth | `POST /auth/login` คืน JWT (`access_token`, 15 นาที) + HttpOnly cookie; ใช้ `Authorization: Bearer` หรือ cookie; me/logout, session revocation, CSRF สำหรับ cookie, roles viewer/editor/admin; ปุ่ม demo login ตาม role (`DEMO_LOGIN_ENABLED`, ค่าตั้งต้นปิด) | e2e (real PostGIS) + Docker smoke |
| 6 Web | เมนู แผนที่ / ตารางแหล่งหญ้าทะเล; sidebar ตัวกรอง + รายการ; MapLibre polygons ตาม bbox (debounce), เส้นจังหวัด, จุดสำรวจ, legend; popup แหล่ง (รายละเอียด + ประวัติสรุปรอบ) และ popup จุดสำรวจ; login (ฟอร์ม + ปุ่ม role); loading/error/empty; 375px | unit + browser บน Docker (desktop และ 375px) |
| 9.5 CI | `.gitlab-ci.yml` ใน gis-api/gis-web: `test` → `docker-image` → `secret_detection` | hosted GitLab pipeline ของ gis-api/gis-web ผ่าน (owner-reported 2026-11-22); gis-docs ไม่มี pipeline |

ผลคำสั่งและตัวเลขจริงอยู่ที่ [WORK-STATUS](docs/WORK-STATUS.md); แผนและ spec ที่ [SWC](docs/swc/README.md); ขั้นตอนรับงานที่ [UAT](docs/swc/UAT.md) และชุดส่งมอบ [UAT Package](docs/swc/UAT-PACKAGE.md); งานที่เลื่อนออกที่ [DEFERRED](docs/swc/DEFERRED.md)

## Run

ต้องมี Docker Desktop (Linux engine) และ Docker Compose

```powershell
cd gis-docs
docker compose up --build -d --wait
```

ไม่ต้องสร้าง `gis-docs/.env` ก่อนเปิดครั้งแรก: Compose มีค่า default แบบ demo-only (ดู [.env.example](.env.example)) API รัน migrations แล้ว import seed ก่อนรับ HTTP ไม่มี schema synchronize; named volume `seagrass-gis_postgres_data` เก็บข้อมูลข้าม restart อย่าลบ volume เพื่อแก้ startup error

| Service | Local endpoint |
|---|---|
| Web (แผนที่) | http://localhost:3000/ |
| Web readiness | http://localhost:3000/health |
| API readiness / PostGIS | http://localhost:3001/health |
| Swagger UI | http://localhost:3001/docs (spec: `/docs/openapi.json`, `/docs/openapi.yaml`) |
| Database | `127.0.0.1:54329`, database/user `gis` |

ทุก port ผูกกับ loopback เท่านั้น ห้ามเปิดบริการนี้ออกอินเทอร์เน็ตด้วยค่า demo การรัน API/Web บน host (port 3002/3003) ดู [Local Development](docs/swc/LOCAL-DEVELOPMENT.md)

## Demo Accounts (local-only)

API สร้างบัญชีสาธิตตอน start จาก `DEMO_*_PASSWORD`; ค่าด้านล่างเป็น default ใน Compose ใช้บนเครื่อง local เท่านั้น

| Email | Role | Password (demo-only) | สิทธิ์ |
|---|---|---|---|
| `viewer@demo.local` | viewer | `viewer-demo-only` | อ่าน + เห็นผู้บันทึก survey |
| `editor@demo.local` | editor | `editor-demo-only` | แก้ชื่อ site, เพิ่ม/แก้/ลบ survey |
| `admin@demo.local` | admin | `admin-demo-only` | ทุกอย่างของ editor + สร้าง/แก้ geometry/ลบ site |

เปลี่ยนได้ด้วย `DEMO_*_PASSWORD` และ `JWT_SECRET` ใน `gis-docs/.env` สิทธิ์ละเอียดดู [USER-MATRIX](docs/swc/BE/USER-MATRIX.md)

## API Usage

- `POST /auth/login` คืน JWT (15 นาที) ใน `access_token` ตามโจทย์ข้อ 5.1 และตั้ง HttpOnly cookie `gis_access`; เรียก API ได้ด้วย `Authorization: Bearer <access_token>` (ไม่ต้องใช้ CSRF header) หรือ cookie (ต้องใช้ CSRF header); logout revoke session ฝั่ง server; ไม่มี refresh token
- ปุ่มเข้าสู่ระบบตาม role (Viewer/Editor/Admin) บนหน้า `/login` แสดงเมื่อตั้ง `DEMO_LOGIN_ENABLED=true` ใน `gis-docs/.env` (ค่าตั้งต้นปิด; ใช้เฉพาะสาธิตบนเครื่อง local)
- คำขอ POST/PATCH/DELETE (รวม login/logout) ต้องส่ง `Origin` ที่อนุญาต (`http://localhost:3000` หรือ `http://localhost:3001`) และ `X-CSRF-Protection: 1`
- [api-examples.http](api-examples.http): ตัวอย่างทุก endpoint (VS Code REST Client) รันตามลำดับจะสร้างและลบ site `DOC-EX-001` เอง; status ในไฟล์ได้จากการรันจริง
- Swagger UI: login ผ่าน `POST /auth/login` ในหน้า `/docs` ก่อนใช้ write; ทุกคำขอเขียนต้องเลือก `X-CSRF-Protection` = `1` และกรอกช่อง `Origin` เป็น `http://localhost:3001` (browser ส่ง Origin จริงของหน้าเอง) (Swagger บังคับกรอกทั้งสองช่อง; interceptor เติม `X-CSRF-Protection` ให้คำขอเขียนอยู่แล้ว)
- Spec แยกไฟล์อยู่ใน `gis-api/api-docs/` (generate ด้วย `npm run docs:generate`) รายการ endpoint: [API-ENDPOINTS](docs/swc/BE/API-ENDPOINTS.md)

## Seed Import

API startup เรียก importer หลัง migrations; อ่าน `seed-data/` แบบ read-only (ไม่แก้ไฟล์ต้นฉบับ) และเขียนรายงาน **`reports/import_report.csv`** (แถวที่ถูกปฏิเสธพร้อมเหตุผล) รันซ้ำ:

```powershell
docker compose exec api npm run import
```

รันซ้ำข้าม key เดิม ไม่ overwrite การแก้ไขผ่าน API และไม่ฟื้น site ที่ลบ ผลรอบแรก: 339 records รับ 310 / ปฏิเสธ 29; เก็บ provinces 3, species 6, sites 27, surveys 274 (สำเนา [import_report.initial.csv](reports/import_report.initial.csv)) รายงานปัจจุบันถูกแทนทุกครั้งที่รัน; ใช้ row index เริ่ม 1 สำหรับ feature/array และ physical line เริ่ม 2 สำหรับ CSV รายละเอียด [Step2 import SWC](docs/swc/BE/step-2-import.md)

## Test

| ที่ | คำสั่ง |
|---|---|
| `gis-api/` | `npm ci --ignore-scripts`, `npm run format:check`, `npm run build`, `npm run test:unit`, `npm run test:import:unit` |
| `gis-api/` (ต้องมี PostGIS แยก) | `npm run test:integration` กับ `DATABASE_URL` ที่ชื่อฐานเป็น `*_test`; `npm run test:import:integration` กับ `IMPORT_TEST_DATABASE_URL` (ฐานแยกอีกตัว) |
| `gis-web/` | `npm ci --ignore-scripts`, `npm run format:check`, `npm run test:unit`, `npm run build`, `npm run typecheck` |
| `gis-docs/` | `docker compose config --quiet`, `curl.exe --fail http://localhost:3001/health` |

Integration tests ล้างตาราง จึงปฏิเสธฐานที่ชื่อไม่มีคำว่า `test`; ห้ามชี้ไปฐาน `gis` ที่ใช้งาน รายละเอียดต่อแอปดู README ของ `gis-api` และ `gis-web`; `npm run format` จัดรูปแบบโค้ดด้วย Prettier

## Known Limitations

- ยังไม่มี UI สำหรับเขียนข้อมูล (วาด polygon, เพิ่ม survey บนแผนที่ เป็น Step 7 ที่เลื่อนออก) การเขียนทำผ่าน API/Swagger/`.http`
- `seed-data/seagrass_large_utm.zip` (UTM) ยังไม่ import; ไม่มีการแปลง CRS; งาน Senior และ optional อื่นอยู่ใน [DEFERRED](docs/swc/DEFERRED.md)
- แผนที่พื้นหลังใช้ OpenStreetMap tiles (ต้องมีอินเทอร์เน็ตและ WebGL) สำหรับ demo เท่านั้น
- Survey ไม่มี version: แก้พร้อมกันเป็น last-write-wins; หลัง admin ย้าย site อาจมี survey เดิมที่ห่างเกิน 50 m ค้างอยู่
- `/surveys.geojson` คืนสูงสุด 5000 จุดใหม่สุด; rate limit login คิดตาม client+email เพราะ API เห็น IP เดียวของ web proxy
- HTTP loopback เท่านั้น ไม่ใช่ production HTTPS

## Continue Work

อ่าน [AGENTS.md](AGENTS.md) และ [docs/WORK-STATUS.md](docs/WORK-STATUS.md) ก่อนทำงานต่อ บันทึก `.honeyguide/` เป็น local workflow ที่ไม่ commit
