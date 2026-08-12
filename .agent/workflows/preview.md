---
description: Preview server start, stop, and status check. Local development server management.
---

# /preview - Preview Management (SKKN)

$ARGUMENTS

---

## Thông tin dự án
- **Frontend**: Vite + React → http://localhost:3000
- **Backend API**: Express server → http://localhost:3001
- **Cần chạy cả 2** để app hoạt động đầy đủ

## Commands

```
/preview           - Show current status
/preview start     - Start cả Frontend + Backend
/preview stop      - Stop tất cả
/preview restart   - Restart tất cả
```

---

## Start Server

// turbo-all

### Bước 1: Start Backend (server/index.js)
```bash
cd d:\Nodejs\AppSKKN\server && node index.js
```
> Chạy background, port 3001

### Bước 2: Start Frontend (Vite dev server)
```bash
cd d:\Nodejs\AppSKKN && npm run dev
```
> Chạy background, port 3000. Proxy /api → localhost:3001

### Bước 3: Thông báo cho user
```
✅ Preview ready!
   🌐 Frontend: http://localhost:3000
   🔌 Backend:  http://localhost:3001
   📋 Health:   http://localhost:3001/api/health
```

---

## Stop Server

### Bước 1: Tìm và kill processes
```powershell
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force
```

---

## Status Check

### Bước 1: Check processes
```powershell
Get-Process -Name node -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, CPU
```

### Bước 2: Health check
```powershell
curl -s http://localhost:3001/api/health
```
