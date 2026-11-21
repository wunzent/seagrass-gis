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

`.env` (ignored) ตั้ง `PORT=3003` เพื่อไม่ชน Docker web ที่ 3000; `npm run dev`/`npm start` เรียก `scripts/next-env.mjs` ซึ่งโหลด `.env` ก่อนเปิด Next CLI ตรวจที่ `http://localhost:3003/health` ปัจจุบันมี health route เท่านั้น

## Tests

`npm run test:unit`, `npm run build`, `npm run typecheck`

## CI

`.gitlab-ci.yml`: unit/build/typecheck, build Docker image และ GitLab Secret Detection
