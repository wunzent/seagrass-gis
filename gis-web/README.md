# gis-web

Web ระบบติดตามแหล่งหญ้าทะเล (Next.js + React, Tailwind CSS, shadcn/ui Button, MapLibre GL) เอกสาร SWC, Docker Compose และ seed-data อยู่ใน [gis-docs](https://gitlab.com/gis450547/gis-docs)

## Workspace

clone `gis-api`, `gis-web`, `gis-docs` ไว้ในโฟลเดอร์เดียวกัน; Compose ใน `gis-docs` build จาก `../gis-web` ดูขั้นตอนเต็มที่ `gis-docs/docs/swc/LOCAL-DEVELOPMENT.md`

## Layout

```text
src/app/         page.tsx (แผนที่), login/, health/, api/ (proxy ไป gis-api), globals.css
src/components/  map-workspace, site-map, login-form, session-provider, session-controls, ui/
src/lib/         map-state, proxy, session, sites
scripts/         copy-maplibre-worker.mjs, next-env.mjs (โหลด .env ก่อนเรียก Next CLI)
test/            *.test.mjs (node --test)
```

## Host Development

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
| `npm run format` / `npm run format:check`     | Prettier                                                         |
| `npm run test:unit`                           | unit tests ใน `test/`                                            |

## Behaviour

- Browser เรียก relative `/api/*`; proxy ตัด `/api`, ส่ง Cookie/Set-Cookie และ CSRF headers, ไม่ cache, ไม่เปิด CORS JavaScript ไม่อ่านหรือเก็บ JWT
- หน้า `/`: ตัวกรองจังหวัด (จาก `/provinces.geojson`)/สถานะ/คำค้น, ตารางหน้าละ 20, polygons ตาม bbox, province outlines, survey points, legend 5 สถานะ, รายละเอียดและประวัติการสำรวจหน้าละ 5; mobile สลับแผนที่/รายการ
- `/login` และ session: เริ่มหน้าเรียก `/api/auth/me` (401 = anonymous), logout revoke session, ไม่มี refresh token; ผู้บันทึก survey แสดงเฉพาะผู้ login
- ยังไม่มี UI เขียนข้อมูล (Step 7 deferred)
- พื้นหลังใช้ OpenStreetMap raster tiles (ต้องมีอินเทอร์เน็ตและ WebGL) สำหรับ demo เท่านั้น ก่อนใช้งานจริงต้องเลือกผู้ให้บริการและปฏิบัติตาม [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/); ถ้าแผนที่เปิดไม่ได้ ตารางและรายละเอียดยังใช้ได้

หลักฐาน browser (Docker, desktop และ 375px) และรายงาน Codex ดู `gis-docs/docs/WORK-STATUS.md` และ `gis-docs/docs/handoff/`

## CI

`.gitlab-ci.yml` มี 3 jobs ตามลำดับ: `test` (node 22.18.0; `npm ci`, `format:check`, `test:unit`, `build`, `typecheck`) → `docker-image` (build Dockerfile ด้วย dind) → `secret_detection` (GitLab template) จำลอง job `test` ใน Docker ผ่านแล้ว; ผล hosted pipeline ยังไม่ได้ตรวจ
