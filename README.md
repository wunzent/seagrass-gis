# GIS — ระบบติดตามแหล่งหญ้าทะเล

Repository เดียว `wunzent/seagrass-gis` branch `main` รวม `gis-api/` (NestJS), `gis-web/` (Next.js), เอกสาร, `docker-compose.yml`, `seed-data/`, `reports/`, [DESIGN](DESIGN.md) และ [api-examples.http](api-examples.http) ใช้ PostgreSQL/PostGIS และ GitHub Actions

> **Data disclaimer**: ข้อมูลใน `seed-data/` เป็นข้อมูลจำลองสำหรับแบบทดสอบ ไม่ใช่ขอบเขตจังหวัด แหล่งหญ้าทะเล หรือผลสำรวจจริง ห้ามนำไปใช้ตัดสินใจ

## Workspace Layout

clone repository เดียว แล้วรันคำสั่งจาก root:

```powershell
git clone --branch main https://github.com/wunzent/seagrass-gis.git
cd seagrass-gis
```

```text
seagrass-gis/
├── gis-api/              NestJS API + migrations + api-docs/
├── gis-web/              Next.js web
├── .github/workflows/ci.yml
├── docker-compose.yml   รัน Compose จาก root
├── .env.example
├── seed-data/
└── reports/
```

## Current Status

| Step | สิ่งที่ทำงานได้ | หลักฐาน |
|---|---|---|
| 1 Runtime | Compose 3 services, versioned migrations, `/health` ตรวจ PostGIS, ข้อมูลคงอยู่หลัง restart | fresh DB/restart proof |
| 2 Import | importer อัตโนมัติตอน start + รันซ้ำได้, `reports/import_report.csv` | unit + real PostGIS integration |
| 3 Site writes | POST/PATCH/DELETE `/sites` พร้อม optimistic locking (`version`) และ soft delete | real PostGIS e2e |
| 4 Surveys | CRUD survey, history, `/surveys.geojson`, `/provinces.geojson`, `/species` | real PostGIS e2e |
| 5 Auth | `POST /auth/login` คืน JWT (`access_token`, 15 นาที) + HttpOnly cookie; ใช้ `Authorization: Bearer` หรือ cookie; API ตรวจ token + session ทุกคำขอ; me/logout, session revocation, CSRF สำหรับ cookie, roles viewer/editor/admin | e2e (real PostGIS) + Docker smoke |
| 6 Web | เมนู แผนที่ / ตารางแหล่งหญ้าทะเล; sidebar ตัวกรอง + รายการ; MapLibre polygons ตาม bbox (debounce), เส้นจังหวัด, จุดสำรวจ, legend; popup แหล่ง (รายละเอียด + ประวัติสรุปรอบ) และ popup จุดสำรวจ; login (ฟอร์ม + กล่องบัญชีสาธิต), แจ้งเตือน session ใกล้หมด/หมดอายุ; loading/error/empty + หน้า loading/error/not-found; 375px | unit + browser บน Docker (desktop และ 375px) |
| 9.5 CI | `.github/workflows/ci.yml`: `api-test` → `api-image`, `web-test` → `web-image` | GitHub Actions ผ่านบน `main` |

## Run

ต้องมี Docker Desktop (Linux engine) และ Docker Compose

```powershell
# รันจาก repository root
# Copy-Item .env.example .env  # optional: ใช้เมื่อต้องการปรับค่า demo
docker compose up --build -d --wait
```

ไม่ต้องสร้าง `.env` ก่อนเปิดครั้งแรก: Compose มีค่า default แบบ demo-only (ดู [.env.example](.env.example)) API รัน migrations แล้ว import seed ก่อนรับ HTTP ไม่มี schema synchronize; named volume `seagrass-gis_postgres_data` เก็บข้อมูลข้าม restart อย่าลบ volume เพื่อแก้ startup error

| Service | Local endpoint |
|---|---|
| Web (แผนที่) | http://localhost:3000/ |
| Web readiness | http://localhost:3000/health |
| API readiness / PostGIS | http://localhost:3001/health |
| Swagger UI | http://localhost:3001/docs (spec: `/docs/openapi.json`, `/docs/openapi.yaml`) |
| Database | `127.0.0.1:54329`, database/user `gis` |

ทุก port ผูกกับ loopback เท่านั้น ห้ามเปิดบริการนี้ออกอินเทอร์เน็ตด้วยค่า demo การรัน API/Web บน host (port 3002/3003)

## Demo Accounts (local-only)

API สร้างบัญชีสาธิตตอน start จาก `DEMO_*_PASSWORD`; ค่าด้านล่างเป็น default ใน Compose ใช้บนเครื่อง local เท่านั้น

| Email | Role | Password (demo-only) | สิทธิ์ |
|---|---|---|---|
| `viewer@demo.local` | viewer | `viewer-demo-only` | อ่าน + เห็นผู้บันทึก survey |
| `editor@demo.local` | editor | `editor-demo-only` | แก้ชื่อ site, เพิ่ม/แก้/ลบ survey |
| `admin@demo.local` | admin | `admin-demo-only` | ทุกอย่างของ editor + สร้าง/แก้ geometry/ลบ site |

เปลี่ยนได้ด้วย `DEMO_*_PASSWORD` และ `JWT_SECRET` ใน `.env`

กล่องบัญชีสาธิตในหน้า `/login` แสดงรหัสผ่านจาก `DEMO_VIEWER_PASSWORD`/`DEMO_EDITOR_PASSWORD`/`DEMO_ADMIN_PASSWORD` ใน `.env` ชุดเดียวกับที่ API ใช้สร้างบัญชี (ถ้าไม่ตั้งหรือเว้นว่างจะใช้ค่า default ข้างบน) หลังแก้ `.env` ให้รัน `docker compose up -d` เพื่อ restart api/web ให้ใช้ค่าใหม่

ค่า default เมื่อไม่ตั้งหรือเว้นว่างใช้ได้เฉพาะตอนรันด้วย Compose; ถ้ารัน API บนเครื่องโดยตรงแล้วไม่ตั้งตัวแปร บัญชีนั้นจะไม่ถูกสร้าง และ `next dev` อ่านค่าจาก `gis-web/.env*` ไม่ใช่ `.env` ที่ root

## API Usage

- `POST /auth/login` คืน JWT (15 นาที) ใน `access_token` ตามโจทย์ข้อ 5.1 และตั้ง HttpOnly cookie `gis_access`; เรียก API ได้ด้วย `Authorization: Bearer <access_token>` (ไม่ต้องใช้ CSRF header) หรือ cookie (ต้องใช้ CSRF header); logout revoke session ฝั่ง server; ไม่มี refresh token
- หน้า `/login` มีบัญชีสาธิตให้เลือกกรอก เริ่มด้วย Admin และมีปุ่มแสดง/ซ่อนรหัสผ่าน; styles/font/icons อยู่ `gis-web/src/assets/`
- คำขอ POST/PATCH/DELETE (รวม login/logout) ต้องส่ง `Origin` ที่อนุญาต (`http://localhost:3000` หรือ `http://localhost:3001`) และ `X-CSRF-Protection: 1`
- [api-examples.http](api-examples.http): ตัวอย่างทุก endpoint (VS Code REST Client) รันตามลำดับจะสร้างและลบ site `DOC-EX-001` เอง; status ในไฟล์ได้จากการรันจริง
- Swagger UI: login ผ่าน `POST /auth/login` ในหน้า `/docs` ก่อนใช้ write; ทุกคำขอเขียนต้องเลือก `X-CSRF-Protection` = `1` และกรอกช่อง `Origin` เป็น `http://localhost:3001` (browser ส่ง Origin จริงของหน้าเอง) (Swagger บังคับกรอกทั้งสองช่อง; interceptor เติม `X-CSRF-Protection` ให้คำขอเขียนอยู่แล้ว)
- Spec แยกไฟล์อยู่ใน `gis-api/api-docs/` (generate ด้วย `npm run docs:generate`) รายการ endpoint ดูใน Swagger UI (http://localhost:3001/docs)

## Seed Import

API startup เรียก importer หลัง migrations; อ่าน `seed-data/` แบบ read-only (ไม่แก้ไฟล์ต้นฉบับ) และเขียนรายงาน **`reports/import_report.csv`** (แถวที่ถูกปฏิเสธพร้อมเหตุผล) รันซ้ำ:

```powershell
docker compose exec api npm run import
```

รันซ้ำข้าม key เดิม ไม่ overwrite การแก้ไขผ่าน API และไม่ฟื้น site ที่ลบ ผลรอบแรก: 339 records รับ 310 / ปฏิเสธ 29; เก็บ provinces 3, species 6, sites 27, surveys 274 (สำเนา [import_report.initial.csv](reports/import_report.initial.csv)) รายงานปัจจุบันถูกแทนทุกครั้งที่รัน; ใช้ row index เริ่ม 1 สำหรับ feature/array และ physical line เริ่ม 2 สำหรับ CSV

## Test

| ที่ | คำสั่ง |
|---|---|
| `gis-api/` | `npm ci --ignore-scripts`, `npm run format:check`, `npm run build`, `npm run test:unit`, `npm run test:import:unit` |
| `gis-api/` (ต้องมี PostGIS แยก) | `npm run test:integration` กับ `DATABASE_URL` ที่ชื่อฐานเป็น `*_test`; `npm run test:import:integration` กับ `IMPORT_TEST_DATABASE_URL` (ฐานแยกอีกตัว) |
| `gis-web/` | `npm ci --ignore-scripts`, `npm run format:check`, `npm run lint`, `npm run test:unit`, `npm run build`, `npm run typecheck` |
| root | `docker compose config --quiet`, `curl.exe --fail http://localhost:3001/health` |

Integration tests ล้างตาราง จึงปฏิเสธฐานที่ชื่อไม่มีคำว่า `test`; ห้ามชี้ไปฐาน `gis` ที่ใช้งาน รายละเอียดต่อแอปดู [API (gis-api)](#api-gis-api) และ [Web (gis-web)](#web-gis-web); `npm run format` จัดรูปแบบโค้ดด้วย Prettier

## API (gis-api)

NestJS + PostgreSQL/PostGIS (`pg` ไม่มี ORM) โครงสร้างหลัก:

```text
gis-api/
├── migrations/     SQL migrations แบบ versioned + checksum (รันก่อนเปิด HTTP)
├── api-docs/       OpenAPI ที่ generate จากโค้ด (openapi.yaml, paths/, components/)
├── src/
│   ├── core/       config, database, seeders (importer), logger
│   ├── shared/     decorators, dto, errors, filters, openapi, pipes, types, validators
│   ├── auth/ sites/ surveys/ lookups/ health/   feature modules
│   └── main.ts migrate.ts import.ts docs.ts     entry points
└── test/           *.e2e-spec.ts (real PostGIS), helpers.ts
```

Unit specs (`*.spec.ts`) อยู่ข้างไฟล์ที่ทดสอบใน `src/`

รันบน host จาก `gis-api/` (ต้องมี PostGIS ของ Compose ที่ `localhost:54329`):

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm ci --ignore-scripts
npm run build
npm start
```

`.env` (ignored) ตั้ง `PORT=3002`, `DATABASE_URL`, `SEED_DATA_DIR=../seed-data`, `IMPORT_REPORT_DIR=../reports`, `JWT_SECRET`, `PUBLIC_WEB_ORIGIN`, `API_DOCS_ORIGIN` และ `DEMO_*_PASSWORD` (ค่าใน `.env.example` เป็น demo-only) ตรวจที่ `http://localhost:3002/health`

| Script | ใช้ทำอะไร |
|---|---|
| `npm run build` / `npm start` | compile ด้วย Nest CLI แล้วรัน `dist/main.js` (migrate + import แล้วเปิด HTTP) |
| `npm run start:dev` | watch mode |
| `npm run migrate` / `npm run import` | รัน migrations หรือ importer แยก |
| `npm run docs:generate` | build แล้วเขียน `api-docs/` ใหม่จาก decorators |
| `npm run format` / `npm run format:check` | Prettier |
| `npm test` หรือ `npm run test:unit` | unit specs ใน `src/` ไม่ใช้ DB |
| `npm run test:integration` | e2e กับ PostGIS จริง ยกเว้น import; ต้องตั้ง `DATABASE_URL` |
| `npm run test:import:unit` | importer unit |
| `npm run test:import:integration` | importer กับ PostGIS จริง; ต้องตั้ง `IMPORT_TEST_DATABASE_URL` ไปฐานแยกจาก API suites (ไม่ตั้ง → exit 1) |

Jest รันโหมด ESM (`node --experimental-vm-modules`) ต้องรันจาก `gis-api/` Integration suites ยอมรับเฉพาะฐานที่ชื่อมีคำว่า `test` เป็นคำเต็ม เช่น `gis_api_test`, `gis_import_test` (`test/helpers.ts`)

Auth และ session:

- `POST /auth/login` คืน `{access_token, user}` พร้อม HttpOnly cookie `gis_access` (เวลาหมดอายุอยู่ใน claim `exp` ของ JWT, 15 นาที); session ฝั่ง server ไม่ต่ออายุเมื่ออ่านข้อมูล และห้าม log token
- เมื่อมี `Authorization: Bearer` จะใช้ header ก่อน cookie แม้ header ผิดรูป (ไม่ fallback ไป cookie); public reads ตอบข้อมูล anonymous ส่วน protected endpoints ตอบ 401
- Write ที่ใช้ Bearer ไม่ต้องส่ง Origin/`X-CSRF-Protection` แต่ยังตรวจ role และสิทธิ์ราย field; ถ้าใช้ cookie ต้องส่งทั้งสองเสมอ และ `login`/`logout` ตรวจ CSRF ทุกกรณี
- login ทั้งสองแบบเพิกถอน session เดิมจาก cookie และ Bearer พร้อมสร้าง session ใหม่ใน transaction เดียวกัน; logout เลือก session จาก header ก่อน ถ้า Bearer ใช้ไม่ได้จะตอบ 204 โดยไม่ล้าง cookie
- ทุกคำขอที่ส่ง token มา API ตรวจลายเซ็นและ session ใน DB ก่อนเสมอ ถ้า session หมดอายุหรือถูกยกเลิก: endpoint ที่ต้อง login ตอบ 401 ส่วน endpoint สาธารณะตอบข้อมูลแบบ anonymous พร้อม header `X-Auth-Session: invalid` (และล้าง cookie สำหรับ GET)
- Swagger `/docs` มีทั้ง cookie และ Bearer security; เว็บใช้ cookie อย่างเดียวและเก็บเฉพาะ safe user กับ expiry

กฎ status ใช้ `src/sites/site-status.ts` เป็นแหล่ง thresholds ร่วมกับ SQL CASE: 75 → very_good, 50 → good, 25 → fair, ต่ำกว่า 25 → poor, null → no_data เปรียบเทียบค่าเฉลี่ยของ survey ทั้งหมดในวันล่าสุดโดยไม่ปัดเศษก่อน; ปัดเฉพาะค่าที่แสดง

## Web (gis-web)

Next.js + React, Tailwind CSS, shadcn/ui Button, MapLibre GL ดู [ARCHITECTURE](gis-web/ARCHITECTURE.md) สำหรับ layer rules, folder map และ flow จริง; [gis-web/DESIGN.md](gis-web/DESIGN.md) เป็น UI design system ส่วน [DESIGN.md](DESIGN.md) ที่ root ตอบแนวทางระบบ

- `app`: routes/layouts; `guards`: session visibility; `features/map` และ `features/auth`: UI, hooks, orchestration
- `services`: REST transport; `stores`: session/shared map state ผ่าน `useSyncExternalStore`
- `components/ui`: UI แสดงผล; `lib`: pure helpers/types และ server proxy; `scripts`: Tailwind/worker/env; `test`: unit + architecture boundaries
- Style/font/icon อยู่ใน `src/assets/` (`styles/globals.css`, generated `styles/tailwind.css`, `styles/maplibre.css`, `fonts/fonts.ts`, `icons/login-icons.tsx`)

รันบน host จาก `gis-web/`:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm ci --ignore-scripts
npm run dev
```

`.env` (ignored) ตั้ง `PORT=3003` เพื่อไม่ชน Docker web ที่ 3000 ตรวจ health ที่ `http://localhost:3003/health` `API_INTERNAL_URL` (ฝั่ง server เท่านั้น): `http://localhost:3002` สำหรับ host API (default) หรือ `http://localhost:3001` สำหรับ Docker API; Compose ตั้ง `http://api:3001` ถ้าใช้ host web กับ Docker API ต้องให้ `PUBLIC_WEB_ORIGIN` ของ API ตรง `http://localhost:3003` ไม่เช่นนั้น login จะได้ CSRF error

| Script | ใช้ทำอะไร |
|---|---|
| `npm run dev` / `npm run build` / `npm start` | สร้าง `src/assets/styles/tailwind.css` + copy MapLibre worker แล้วรัน Next |
| `npm run styles` | compile Tailwind ใหม่หลังแก้ CSS/class ระหว่าง dev |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (`eslint-config-next` core-web-vitals + typescript) |
| `npm run format` / `npm run format:check` | Prettier |
| `npm run test:unit` | unit tests ใน `test/` |

พฤติกรรมสำคัญ:

- Browser เรียก relative `/api/*`; proxy ตัด `/api`, ส่ง Cookie/Set-Cookie และ CSRF headers, ไม่ cache, ไม่เปิด CORS; JavaScript ไม่อ่านหรือเก็บ JWT และไม่ forward `Authorization` จาก browser
- proxy ลบ `access_token` จาก JSON response ที่สำเร็จของ `POST /api/auth/login` แล้วเติม `expires_at` จาก claim `exp` ให้ browser โดยคง user และ Set-Cookie; ส่ง `X-Auth-Session: invalid` ต่อให้ browser
- หน้า `/`: ตัวกรองจังหวัด/สถานะ/คำค้น, ตารางหน้าละ 20 (เลือก 10/20/50/100 ต่อหน้า และเลือกเลขหน้าได้), polygons ตาม bbox, province outlines, survey points, legend 5 สถานะ, รายละเอียดและประวัติการสำรวจหน้าละ 5; mobile สลับแผนที่/รายการ
- Session ฝั่งเว็บไม่เรียก `/api/auth/me`: login แล้วจำเฉพาะ id/email/role/expires_at (ไม่มี JWT) ใน localStorage เพื่อแสดงชื่อและ role หลัง refresh; เตือน 1 นาทีก่อนหมดอายุและแจ้งเมื่อหมด; ถ้า API ตอบ 401 หรือ `X-Auth-Session: invalid` เว็บล้าง identity ทันที; แท็บอื่น login/logout แล้วอัปเดตตามผ่าน storage event
- `/login`: ฟอร์มมีบัญชีสาธิตที่หน้า server อ่านจาก `DEMO_*_PASSWORD` ตอน request ผ่าน `src/lib/demo-accounts.ts` (fallback เป็นค่าใน `.env.example`) กดเพื่อกรอกโดยไม่ส่ง; ไม่มีปุ่ม login ตาม role
- จุดสำรวจที่อยู่ใกล้กัน (ภายใน 40 px) รวมเป็นวงกลมมีตัวเลขเฉพาะตอนซูมออกจนมาตราส่วนประมาณ 30 กม. ขึ้นไป (ซูม ≤ 9) ซูมเข้ามากกว่านั้นแสดงจุดและแหล่งตามปกติ คลิกวงกลมเพื่อซูมเข้า; popup ของแหล่ง/จุดมีลูกศรชี้ไปยังตำแหน่งที่เลือก
- แผนที่ฐานสลับได้ 2 แบบจากกล่อง "แผนที่ฐาน" มุมซ้ายล่างของแผนที่: แผนที่ถนน (OpenStreetMap) และภาพดาวเทียม (Esri World Imagery ซ้อนชั้นถนนและชื่อสถานที่จาก Esri Reference World Transportation / World Boundaries and Places) browser จำตัวเลือกไว้ใน localStorage (`gis-basemap`); ทั้งหมดเป็น raster tiles สำหรับ demo เท่านั้น ก่อนใช้งานจริงต้องเลือกผู้ให้บริการและปฏิบัติตามเงื่อนไขของแต่ละราย เช่น [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/); ถ้าแผนที่เปิดไม่ได้ ตารางและรายละเอียดยังใช้ได้

## CI

[GitHub Actions](.github/workflows/ci.yml) รันทุก branch push และ pull request พร้อมยกเลิก run เก่าของ ref เดียวกัน ใช้ Node22.18.0 และ npm cache ตาม lockfile ของแต่ละแอป:

- `api-test`: `npm ci --ignore-scripts`, format, build, unit/integration และ import unit/integration กับ PostGIS สองฐานแยกกัน
- `web-test`: `npm ci --ignore-scripts`, format, lint, unit, build, typecheck
- `api-image` / `web-image`: รอ test job ของแอปนั้น แล้ว `docker build --pull` โดยไม่ push image

workflow ใช้ `contents: read`, `actions/checkout@v4`, `actions/setup-node@v4`; ใช้ GitHub push protection สำหรับ public repo โดยไม่เพิ่ม third-party secret scanner

## Known Limitations

- ยังไม่มี UI สำหรับเขียนข้อมูล (วาด polygon, เพิ่ม survey บนแผนที่ เป็นงานระดับ Senior ซึ่งไม่อยู่ในขอบเขต) การเขียนทำผ่าน API/Swagger/`.http`
- `seed-data/seagrass_large_utm.zip` (UTM) ยังไม่ import; ไม่มีการแปลง CRS; งานระดับ Senior ไม่อยู่ในขอบเขต; ขั้นที่ 9 ทำข้อ CI
- แผนที่พื้นหลังใช้ tiles จาก OpenStreetMap และ Esri (ต้องมีอินเทอร์เน็ตและ WebGL) สำหรับ demo เท่านั้น
- Survey ไม่มี version: แก้พร้อมกันเป็น last-write-wins; หลัง admin ย้าย site อาจมี survey เดิมที่ห่างเกิน 50 m ค้างอยู่
- `/surveys.geojson` คืนสูงสุด 5000 จุดใหม่สุด; rate limit login คิดตาม client+email เพราะ API เห็น IP เดียวของ web proxy
- HTTP loopback เท่านั้น ไม่ใช่ production HTTPS

เอกสารเว็บ: [UI design system](gis-web/DESIGN.md) และ [Web architecture](gis-web/ARCHITECTURE.md)

## Assessment Deliverables

| Item | ที่ส่งมอบ / วิธีตรวจ |
|---|---|
| 4.1 Source + commits | repository นี้มี [gis-api/](gis-api/) และ [gis-web/](gis-web/); ประวัติรวมเป็น timeline เดียวของ commits `step-N:` ตรวจจาก root ด้วย `git log --oneline` |
| 4.2 Compose + environment | [docker-compose.yml](docker-compose.yml) เปิด db/api/web และ import อัตโนมัติด้วยคำสั่งเดียวใน Run; [.env.example](.env.example) เป็นค่า demo-only |
| 4.3 README | README นี้ (Run, Test, API (gis-api), Web (gis-web), Current Status และ Demo Accounts) ระบุวิธีเปิด/ทดสอบ ขั้นที่ทำเสร็จ และบัญชี viewer/editor/admin |
| 4.4 API docs + examples | `/docs` ตาม API Usage และ [api-examples.http](api-examples.http) |
| 4.5 Tests | [status unit](gis-api/src/sites/site-status.spec.ts), [validation unit](gis-api/src/sites/dto/create-site.dto.spec.ts), [OUTSIDE_SITE integration](gis-api/test/surveys.e2e-spec.ts), [VERSION_CONFLICT integration](gis-api/test/sites-write.e2e-spec.ts); คำสั่งอยู่ใน Test |
| 4.6 Import report | [import_report.csv](reports/import_report.csv) จากขั้น 2; จำนวนและวิธีรันซ้ำอยู่ใน Seed Import |
| 4.7 Design | [UI design system ของเว็บ](gis-web/DESIGN.md); [DESIGN.md](DESIGN.md) ตอบ a geometry/SRID/index, b invalid/missing CRS, c concurrent edits, d วิธีส่ง 500,000 polygons ไปหน้าเว็บให้แสดงภายใน 2 วินาที (โจทย์ถามแนวทาง; vector tiles จริงเป็นขั้นที่ 9 ข้อเลือกทำ), e งานที่ยังไม่ทำและแผนอีก 1 วัน; ตรวจแล้ว 2 หน้า A4 (Chrome print, 11pt, ขอบ 20 mm) |
| 9.5 CI | [GitHub Actions](.github/workflows/ci.yml) รัน test และ build image เมื่อ push/PR ตาม CI; run บน `main` ผ่าน |
