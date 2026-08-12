---
description: Deploy code lên VPS Hostinger. Push code lên GitHub rồi SSH vào VPS để pull và build.
---

# Deploy lên VPS Production

$ARGUMENTS

## ⚠️ ĐIỀU KIỆN BẮT BUỘC
**KHÔNG được deploy nếu Khầy chưa test trên localhost!**
Nếu Khầy chưa nói "OK", "test xong", "lên thôi" hoặc tương tự → HỎI trước: "Khầy đã test trên localhost chưa ạ?"

## Thông tin VPS
- **IP**: 187.77.139.235
- **User**: root (SSH key, không cần password)
- **Domain**: https://skkn.aiphocap.vn
- **Thư mục code**: /var/www/skkn-app
- **Backend**: PM2 process `skkn-api` (port 3001)

## Luồng làm việc chuẩn

```
📝 Khầy yêu cầu
   ↓
🤖 Em code trên Local
   ↓
🧪 Khầy test localhost: /test start → http://localhost:3000
   ↓  (Khầy nói "OK" hoặc "test xong")
📤 /deploy
   ↓
🌐 App Live tại https://skkn.aiphocap.vn
```

## Quy trình deploy

// turbo-all

### Bước 1: Commit và push code lên GitHub
```bash
cd d:\Nodejs\AppSKKN
git add .
git commit -m "<mô tả thay đổi>"
git push origin main
```

### Bước 2: SSH vào VPS và chạy deploy script
```bash
ssh -o StrictHostKeyChecking=no root@187.77.139.235 "cd /var/www/skkn-app && ./deploy.sh"
```

### Bước 3: Kiểm tra kết quả
```bash
ssh -o StrictHostKeyChecking=no root@187.77.139.235 "pm2 status && curl -s http://localhost:3001/api/health"
```

### Bước 4: Thông báo kết quả cho user
- Hiển thị trạng thái PM2
- Hiển thị kết quả health check
- Cung cấp link: https://skkn.aiphocap.vn
- Hiển thị danh sách file đã thay đổi

## Ghi chú
- Nếu chỉ thay đổi Frontend (file .tsx, .css): chỉ cần build lại, không cần restart PM2
- Nếu thay đổi Backend (server/index.js): PM2 sẽ tự restart trong deploy.sh
- File .env KHÔNG được push lên GitHub, nếu cần thay đổi .env phải SSH vào sửa trực tiếp
