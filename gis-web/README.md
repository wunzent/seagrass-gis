# gis-web

Web ระบบติดตามแหล่งหญ้าทะเล (Next.js) เอกสาร SWC, Docker Compose และ seed-data อยู่ใน [gis-docs](https://gitlab.com/gis450547/gis-docs)

## Workspace

clone `gis-api`, `gis-web`, `gis-docs` ไว้ในโฟลเดอร์เดียวกัน; Compose ใน `gis-docs` build จาก `../gis-web` ดูขั้นตอนเต็มที่ `gis-docs/docs/swc/LOCAL-DEVELOPMENT.md`

## Host Development

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm ci --ignore-scripts
npm run dev
```

`.env` (ignored) ตั้ง `PORT=3003` เพื่อไม่ชน Docker web ที่ 3000; `npm run dev`/`npm start` เรียก `scripts/next-env.mjs` ซึ่งโหลด `.env` ก่อนเปิด Next CLI ตรวจ health ที่ `http://localhost:3003/health` และเปิดแผนที่ที่ `http://localhost:3003/`

ตั้ง `API_INTERNAL_URL=http://localhost:3002` สำหรับ host API (default) หรือ `http://localhost:3001` สำหรับ Docker API เช่น PowerShell `$env:API_INTERNAL_URL='http://localhost:3001'; npm.cmd run dev`. Compose ตั้ง `API_INTERNAL_URL=http://api:3001` ให้ service web. ค่านี้อยู่ฝั่ง server เท่านั้น Browser ใช้ relative `/api/*`; proxy strip `/api`, ส่ง Cookie/Set-Cookie และ CSRF headers, ไม่ cache responses และไม่เปิด CORS. ไม่อ่าน/เก็บ JWT ใน JavaScript/storage

หน้า `/` มีตัวกรองจังหวัด/สถานะ/คำค้น (300ms), รายการหน้า20แหล่ง, polygons ตาม bbox เมื่อเลื่อนแผนที่, legend5สถานะ และรายละเอียดเมื่อเลือกแหล่ง. Mobile สลับแผนที่/รายการได้ รายละเอียดอยู่ด้านล่าง. T011 เพิ่ม `/login` และ safe email/role; ประวัติการสำรวจยังไม่พร้อม ไม่สร้างข้อมูลจำลองแทน API

แผนที่พื้นหลังใช้ OpenStreetMap raster tiles แบบไม่ใช้ API key และแสดง attribution; ต้องเชื่อมต่ออินเทอร์เน็ตและ WebGL. ใช้สำหรับ demo เท่านั้น ก่อนใช้งานจริงต้องเลือกผู้ให้บริการ tiles และปฏิบัติตาม [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/). หากพื้นหลัง/แผนที่เปิดไม่ได้ ยังใช้ตารางและรายละเอียดได้ พร้อมข้อความแจ้ง. จังหวัดในตัวกรองใช้รหัสอ้างอิงของชุดข้อมูลปัจจุบัน81/82/92 (กระบี่/พังงา/ตรัง); ไม่ดึง geometry ทั้งหมดเพื่อสร้างตัวกรอง. Province outlines/survey points เป็นงานถัดไปตาม API ที่พร้อม

ใช้ Tailwind CSS3.4.19 CLI เพื่อเก็บ config ใน scope ที่อนุญาต; `npm run styles` compile `src/app/globals.css` เป็น `src/app/tailwind.css` (เก็บใน source เพื่อ import ได้ทันที). Dev/build สร้างใหม่อัตโนมัติ; ระหว่าง dev หลังแก้ CSS/class ให้รัน styles อีกครั้ง. ใช้ shadcn/ui Button แบบปรับเฉพาะ variants ที่ใช้ (MIT): [upstream](https://github.com/shadcn-ui/ui/blob/main/apps/v4/public/r/styles/default/button.json). MapLibre API อ้างอิง [official raster example](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-raster-tile-source/) และ [Map API](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/)

## Login and Session

API ต้องตั้ง `PUBLIC_WEB_ORIGIN` ให้ตรง browser origin จริง: Docker web `http://localhost:3000` หรือ host web `http://localhost:3003`. ระหว่าง T011 ตรวจพบ Docker API ปัจจุบันยอมรับ3000และปฏิเสธ3003; host web ที่ชี้ Docker API จึงแสดง CSRF error จนผู้ดูแลตั้งค่า API ให้ตรง. Web ไม่สร้าง/แก้ Origin header เพื่อข้ามการตรวจสอบ

เริ่มหน้า/refresh เรียก `/api/auth/me` ก่อนโหลดข้อมูลที่ขึ้นกับผู้ใช้;401เป็น anonymous. POST login/logout ใช้ `X-CSRF-Protection: 1`, browser จัดการ Origin/Cookie เอง. State เก็บเฉพาะ safe user และ expires_at พร้อมสถานะคำขอ ไม่มี JWT หรือ auth storage. ไม่มี refresh token/ต่ออายุอัตโนมัติ

เมื่อ expiry/logout/identity เปลี่ยน จะยกเลิกหรือ ignore request เก่าและสร้าง map workspace ใหม่เพื่อทิ้ง private cache (ตัวกรอง/selection/viewport จะเริ่มใหม่ด้วย). Focus/visibility ตรวจ session ซ้ำแบบเงียบ; หาก id/email/role เดิมจะคง workspace และปรับเฉพาะ expires_at กับ timer. หากตรวจไม่สำเร็จจะคง session และปุ่มตรวจสอบผู้ใช้อีกครั้งเรียก restore. Network/503 ตอน logout ซ่อน private UI และ retryหลัง3/6/12/24วินาที สูงสุด30วินาที จน204หรือ expires_at เดิม;429รออย่างน้อย60วินาทีและเคารพ Retry-After ทั้ง delay-seconds และ HTTP-date ที่ proxy ส่งต่อ โดยปิดปุ่มลองออกจากระบบระหว่างรอพร้อมข้อความกรุณารอสักครู่. ระหว่างรอห้าม login/restore identity และตัด created_by/updated_by จาก public payload.403ไม่ถือว่า logout สำเร็จและคง session. อย่าปิดหรือ refresh หน้าระหว่างรอ logout หากต้องการให้ retry ต่อเนื่อง; pending retry อยู่ใน memory และ cookie อาจยัง valid จน API ยืนยันหรือหมดอายุ

หลักฐาน T011: unit lifecycle และ real HTTP cookie jar ผ่านทั้ง3บทบาท. Claude Code ตรวจ browser บน Docker วันที่2026-11-21 หลัง fix-1 (ตาม brief fix-2): refocus คงตัวกรองพังงา 9 แหล่งและ logout button element เดิม; คลิกเมาส์ logout จริงส่งหนึ่งคำขอ; refresh หลัง logout เป็น anonymous; ไม่มี token ใน JS storage; 375px ไม่มี horizontal scroll; map region role มีอยู่; worker ตอบ200; anonymous ไม่มี request loop. Codex fix-2 ไม่ได้ตรวจ browser ซ้ำ; keyboard และ fault injection ยังไม่มีหลักฐาน. ดู `gis-docs/docs/handoff/codex-T010-T011-fix-2-report.md`

## Tests

`npm run test:unit`, `npm run build`, `npm run typecheck`

## CI

`.gitlab-ci.yml`: unit/build/typecheck, build Docker image และ GitLab Secret Detection
