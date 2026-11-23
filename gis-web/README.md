# gis-web

Web ระบบติดตามแหล่งหญ้าทะเล (Next.js + React, Tailwind CSS, shadcn/ui Button, MapLibre GL) อยู่ใน repository เดียว `wunzent/seagrass-gis` branch `main`; เอกสาร SWC, Docker Compose, seed-data, [DESIGN](../DESIGN.md) และ [api-examples.http](../api-examples.http) อยู่ที่ root

## Workspace

clone `https://github.com/wunzent/seagrass-gis.git` เพียงครั้งเดียว; รัน `docker compose up -d --build --wait` จาก repository root ซึ่ง build จาก `./gis-api` และ `./gis-web` ดู [Local Development](../docs/swc/LOCAL-DEVELOPMENT.md)

## Layout

```text
src/app/         page.tsx (แผนที่), login/, health/, api/ (proxy ไป gis-api), globals.css
src/components/  map-workspace, site-map, login-form, session-provider, session-controls, ui/
src/lib/         map-state, proxy, session, sites
scripts/         copy-maplibre-worker.mjs, next-env.mjs (โหลด .env ก่อนเรียก Next CLI)
test/            *.test.mjs (node --test)
```

## Host Development

รันคำสั่งต่อไปนี้จาก `gis-web/`:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm ci --ignore-scripts
npm run dev
```

`.env` (ignored) ตั้ง `PORT=3003` เพื่อไม่ชน Docker web ที่ 3000 ตรวจ health ที่ `http://localhost:3003/health` และเปิดแผนที่ที่ `http://localhost:3003/`
`API_INTERNAL_URL` (ฝั่ง server เท่านั้น): `http://localhost:3002` สำหรับ host API (default) หรือ `http://localhost:3001` สำหรับ Docker API; Compose ตั้ง `http://api:3001` ถ้าใช้ host web กับ Docker API ต้องให้ `PUBLIC_WEB_ORIGIN` ของ API ตรง `http://localhost:3003` ไม่เช่นนั้น login จะได้ CSRF error

| Script                                        | ใช้ทำอะไร                                                        |
| --------------------------------------------- | ---------------------------------------------------------------- |
| `npm run dev` / `npm run build` / `npm start` | สร้าง `src/app/tailwind.css` + copy MapLibre worker แล้วรัน Next |
| `npm run styles`                              | compile Tailwind ใหม่หลังแก้ CSS/class ระหว่าง dev               |
| `npm run typecheck`                           | `tsc --noEmit`                                                   |
| `npm run lint`                                | ESLint (`eslint-config-next` core-web-vitals + typescript)       |
| `npm run format` / `npm run format:check`     | Prettier                                                         |
| `npm run test:unit`                           | unit tests ใน `test/`                                            |

## Behaviour

- Browser เรียก relative `/api/*`; proxy ตัด `/api`, ส่ง Cookie/Set-Cookie และ CSRF headers, ไม่ cache, ไม่เปิด CORS JavaScript ไม่อ่านหรือเก็บ JWT
- proxy ลบ `access_token` และ `token_type` จาก JSON response ที่สำเร็จของ `POST /api/auth/login` และ `POST /api/auth/demo-login` ก่อนส่งให้ browser โดยคง user/expiry และ Set-Cookie; response อื่นยังส่งแบบ stream เดิม และไม่ forward `Authorization` จาก browser
- หน้า `/`: ตัวกรองจังหวัด (จาก `/provinces.geojson`)/สถานะ/คำค้น, ตารางหน้าละ 20, polygons ตาม bbox, province outlines, survey points, legend 5 สถานะ, รายละเอียดและประวัติการสำรวจหน้าละ 5; mobile สลับแผนที่/รายการ
- `/login` และ session: เริ่มหน้าเรียก `/api/auth/me` (401 = anonymous), logout revoke session, ไม่มี refresh token; ผู้บันทึก survey แสดงเฉพาะผู้ login
- ยังไม่มี UI เขียนข้อมูล (Step 7 deferred)
- พื้นหลังใช้ OpenStreetMap raster tiles (ต้องมีอินเทอร์เน็ตและ WebGL) สำหรับ demo เท่านั้น ก่อนใช้งานจริงต้องเลือกผู้ให้บริการและปฏิบัติตาม [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/); ถ้าแผนที่เปิดไม่ได้ ตารางและรายละเอียดยังใช้ได้

หลักฐาน browser (Docker, desktop และ 375px) ดู [WORK-STATUS](../docs/WORK-STATUS.md) (รายงาน Codex เก็บนอก repo)

## CI

[GitHub Actions](../.github/workflows/ci.yml) ที่ root รันทุก branch push และ pull request: `web-test` รัน format, lint, unit, build, typecheck แล้ว `web-image` build ด้วย `docker build --pull ./gis-web` ใช้ Node22.18.0, `npm ci --ignore-scripts` และ npm cache ตาม lockfile; ไม่ push image; รอตรวจ hosted run ของ revision ปัจจุบัน

หน้า /login แสดงปุ่ม Viewer, Editor และ Admin สำหรับบัญชีสาธิตเฉพาะเมื่อ API ตั้ง DEMO_LOGIN_ENABLED=true และ discovery สำเร็จ เมื่อปิดหรือเรียก API ไม่สำเร็จจะแสดงเฉพาะฟอร์ม email/password เดิม ปุ่มส่งเฉพาะ role โดยไม่มีรหัสผ่านใน web code
