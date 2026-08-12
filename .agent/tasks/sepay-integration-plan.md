# 📋 KẾ HOẠCH TÍCH HỢP SEPAY - THANH TOÁN TỰ ĐỘNG

> **Ngày tạo:** 2026-02-03
> **Trạng thái:** Planning
> **Độ ưu tiên:** Cao

---

## 🎯 MỤC TIÊU

Tích hợp Sepay vào quy trình thanh toán đơn hàng với các tính năng:
1. Chuyên gia tạo mã QR Banking từ số tiền đơn hàng
2. Tự động gửi QR qua email cho khách hàng
3. Cho phép tải QR về để gửi qua Zalo
4. Webhook tự động xác nhận thanh toán
5. Thông báo cho chuyên gia bắt đầu làm việc

---

## 🔄 WORKFLOW CHI TIẾT

```
┌─────────────────────────────────────────────────────────────────┐
│  1. THỎA THUẬN GIÁ                                              │
│     Chuyên gia & Khách hàng thống nhất giá qua chat             │
│     → Status: pending_approval                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  2. TẠO MÃ BANKING QR                                           │
│     - Chuyên gia nhập số tiền cần thanh toán                    │
│     - Bấm "Tạo mã Banking"                                      │
│     - Hệ thống gọi VietQR API tạo mã QR với:                    │
│       + Số tiền                                                  │
│       + Nội dung: THANHTOAN [ORDER_CODE]                        │
│     → Status: awaiting_payment                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  3. GỬI QR CHO KHÁCH HÀNG                                       │
│     - Tự động gửi email với QR + hướng dẫn                      │
│     - Hiển thị nút "Tải QR" để gửi qua Zalo                     │
│     - Lưu QR vào order record                                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  4. KHÁCH HÀNG CHUYỂN KHOẢN                                     │
│     - Quét QR hoặc chuyển khoản thủ công                        │
│     - Nội dung ghi: THANHTOAN ORD-20260203-XXXX                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  5. SEPAY WEBHOOK XÁC NHẬN                                      │
│     - Sepay gửi POST đến /api/sepay_webhook.php                 │
│     - Hệ thống parse nội dung → tìm order_code                  │
│     - Kiểm tra số tiền khớp với đơn hàng                        │
│     - Cập nhật paid_amount và status                            │
│     → Status: processing (Đang thực hiện)                       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  6. THÔNG BÁO CHUYÊN GIA                                        │
│     - Gửi email thông báo "Đã nhận thanh toán"                  │
│     - Hiển thị notification trên dashboard                      │
│     - Chuyên gia bắt đầu thực hiện đơn hàng                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🏗️ KIẾN TRÚC KỸ THUẬT

### A. Database Changes

```sql
-- Thêm fields mới vào bảng orders
ALTER TABLE orders ADD COLUMN qr_code_url TEXT NULL AFTER paid_amount;
ALTER TABLE orders ADD COLUMN payment_transaction_id VARCHAR(100) NULL AFTER qr_code_url;
ALTER TABLE orders ADD COLUMN payment_verified_at DATETIME NULL AFTER payment_transaction_id;

-- Thêm settings mới cho Sepay
INSERT INTO system_settings (setting_key, setting_value) VALUES
('sepay_api_key', ''),
('sepay_bank_code', 'MB'),
('sepay_account_number', ''),
('sepay_account_name', ''),
('sepay_webhook_secret', '');

-- Bảng log webhook (để debug và audit)
CREATE TABLE IF NOT EXISTS payment_webhooks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    transaction_id VARCHAR(100),
    order_code VARCHAR(50),
    amount DECIMAL(15,2),
    content TEXT,
    raw_payload TEXT,
    status ENUM('success', 'failed', 'pending') DEFAULT 'pending',
    processed_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### B. Files Cần Tạo Mới

| File | Mô tả |
|------|-------|
| `api/generate_qr.php` | API tạo mã QR VietQR |
| `api/sepay_webhook.php` | Endpoint nhận webhook từ Sepay |
| `classes/Sepay.php` | Class xử lý tích hợp Sepay |
| `classes/VietQR.php` | Class tạo mã QR VietQR |

### C. Files Cần Sửa Đổi

| File | Thay đổi |
|------|----------|
| `admin/settings.php` | Thêm section cấu hình Sepay API |
| `admin/order_detail.php` | Thêm nút "Tạo mã Banking" + hiển thị QR |
| `ctv/order_detail.php` | Tương tự admin |
| `classes/Order.php` | Thêm methods quản lý payment |

---

## 📝 CHI TIẾT TỪNG BƯỚC TRIỂN KHAI

### BƯỚC 1: Chuẩn Bị Database
**[ ] Task 1.1:** Chạy SQL migration thêm fields mới
**[ ] Task 1.2:** Tạo bảng payment_webhooks

### BƯỚC 2: Tạo Class VietQR
**[ ] Task 2.1:** Tạo `classes/VietQR.php` với methods:
- `generateQRUrl($bankCode, $accountNumber, $amount, $content)` - Tạo URL QR
- `generateQRImage($bankCode, $accountNumber, $amount, $content)` - Tạo ảnh QR base64

### BƯỚC 3: Tạo Class Sepay
**[ ] Task 3.1:** Tạo `classes/Sepay.php` với methods:
- `verifyWebhook($payload, $signature)` - Xác thực webhook
- `parseTransactionContent($content)` - Parse nội dung chuyển khoản
- `findOrderByContent($content)` - Tìm đơn hàng từ nội dung

### BƯỚC 4: Tạo API Generate QR
**[ ] Task 4.1:** Tạo `api/generate_qr.php`
- Input: order_id, amount
- Output: QR image URL, QR base64

### BƯỚC 5: Tạo Webhook Endpoint
**[ ] Task 5.1:** Tạo `api/sepay_webhook.php`
- Validate webhook signature
- Parse transaction
- Update order status
- Send notifications

### BƯỚC 6: Cập Nhật Admin Settings
**[ ] Task 6.1:** Thêm section Sepay vào `admin/settings.php`
- Sepay API Key
- Bank Code
- Account Number
- Account Name

### BƯỚC 7: Cập Nhật Order Detail
**[ ] Task 7.1:** Admin - Thêm modal "Tạo mã Banking"
**[ ] Task 7.2:** CTV - Thêm nút tương tự
**[ ] Task 7.3:** Hiển thị QR + nút tải về
**[ ] Task 7.4:** Tích hợp gửi email

### BƯỚC 8: Notifications
**[ ] Task 8.1:** Email cho khách hàng khi tạo QR
**[ ] Task 8.2:** Email cho chuyên gia khi xác nhận thanh toán
**[ ] Task 8.3:** Notification trên dashboard

---

## 🔧 HƯỚNG DẪN SETUP SEPAY (SAU KHI CODE XONG)

### Bước 1: Đăng ký Sepay
1. Truy cập https://my.sepay.vn/register
2. Đăng ký tài khoản với email doanh nghiệp
3. Xác thực email và hoàn tất đăng ký

### Bước 2: Kết nối Bank Account
1. Đăng nhập Sepay → **Ngân hàng** → **Thêm tài khoản**
2. Chọn ngân hàng (ưu tiên: MB Bank, Techcombank, BIDV - hỗ trợ tốt)
3. Làm theo hướng dẫn kết nối API ngân hàng
4. Chờ Sepay xác thực (thường 1-24h)

### Bước 3: Tạo API Key
1. Vào **Tài khoản** → **API Keys**
2. Click **Tạo API Key mới**
3. Đặt tên: "CTV Platform Payment"
4. Chọn quyền: `transaction:read`
5. Copy API Key và lưu an toàn

### Bước 4: Cấu hình Webhook
1. Vào **Webhook** → **Tạo mới**
2. Điền thông tin:
   - **URL:** `https://your-domain.com/ctv/api/sepay_webhook.php`
   - **Tài khoản:** Chọn bank account đã kết nối
   - **Loại giao dịch:** Tiền vào
   - **Xác thực thanh toán:** ✅ Có
3. Lưu và copy **Webhook Secret**

### Bước 5: Cấu hình trên CTV Platform
1. Đăng nhập Admin → **Cấu hình**
2. Điền thông tin Sepay:
   - Sepay API Key
   - Bank Code (VD: MB, TCB, BIDV)
   - Số tài khoản
   - Tên chủ tài khoản
   - Webhook Secret
3. Lưu cấu hình

### Bước 6: Test
1. Tạo một đơn hàng test
2. Tạo mã QR Banking
3. Chuyển khoản một số tiền nhỏ
4. Kiểm tra webhook có nhận được không
5. Xác nhận trạng thái đơn hàng tự động cập nhật

---

## ⚠️ LƯU Ý QUAN TRỌNG

### Bảo mật
- **KHÔNG** commit API Key lên git
- Sử dụng HTTPS cho webhook URL
- Validate signature của webhook
- Rate limit webhook endpoint

### Xử lý lỗi
- Log tất cả webhook requests
- Retry mechanism cho failed notifications
- Alert khi có lỗi liên tục

### Edge Cases
- Khách chuyển thiếu tiền → Thông báo, không tự động xác nhận
- Khách chuyển thừa tiền → Ghi nhận, admin xử lý
- Khách chuyển sai nội dung → Không match, admin xác nhận thủ công
- Webhook trùng lặp → Check transaction_id để tránh duplicate

---

## 📊 TIMELINE DỰ KIẾN

| Phase | Thời gian | Tasks |
|-------|-----------|-------|
| Phase 1 | 30 phút | Database + Classes cơ bản |
| Phase 2 | 45 phút | API endpoints |
| Phase 3 | 60 phút | UI updates |
| Phase 4 | 30 phút | Email notifications |
| Phase 5 | 15 phút | Testing & Debug |

**Tổng:** ~3 giờ

---

## ✅ CHECKLIST SAU KHI HOÀN THÀNH

- [ ] Database migration đã chạy
- [ ] Sepay account đã đăng ký và xác thực
- [ ] Bank account đã kết nối Sepay
- [ ] Webhook URL đã cấu hình
- [ ] Test chuyển khoản thành công
- [ ] Email notifications hoạt động
- [ ] Production deployment ready

---

**Khầy xác nhận kế hoạch này và em sẽ bắt đầu triển khai từng bước!**
