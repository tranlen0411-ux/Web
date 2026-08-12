---
description: Start/stop local dev servers để test trước khi deploy. Chạy Frontend (3000) và Backend (3001) ở 2 terminal riêng.
---

# /test - Local Testing

$ARGUMENTS

## Commands

```
/test start     - Start cả 2 server (2 terminal riêng)
/test stop      - Stop tất cả
/test restart   - Restart tất cả
```

---

## Start Server

### Bước 1: Start Backend API (Terminal 1)
```bash
cd d:\Nodejs\AppSKKN\server && node index.js
```
> Terminal riêng, port 3001

### Bước 2: Start Frontend Vite (Terminal 2)
```bash
cd d:\Nodejs\AppSKKN && npm run dev
```
> Terminal riêng, port 3000. Proxy /api → localhost:3001

### Bước 3: Thông báo cho user
```
✅ Local servers ready!
   🌐 Frontend: http://localhost:3000
   🔌 Backend:  http://localhost:3001/api/health
   
   👉 Khầy test xong thì nói "OK" hoặc "/deploy" để đẩy lên VPS!
```

## Stop Server

### Bước 1: Kill node processes
```powershell
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force
echo "All servers stopped"
```
