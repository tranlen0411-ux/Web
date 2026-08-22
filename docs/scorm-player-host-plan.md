# 🏗️ SCORM PRODUCTION PLAYER HOST & SAME-ORIGIN REVERSE PROXY DESIGN

> **Tài liệu Thiết kế Kiến trúc Player Host (Origin B) và Reverse Proxy Bảo mật cho SCORM Player**
> **Mục tiêu:** Đảm bảo toàn bộ tài nguyên SCORM (HTML, JS, CSS, Media) và LMS API Runtime được thực thi trong một Origin độc lập (Origin B), tuyệt đối cách ly khỏi Ứng dụng Chính (Origin A), đồng thời không để lộ URL hạ tầng Supabase Backend ra ngoài trình duyệt.

---

## 1. TỔNG QUAN KIẾN TRÚC ORIGIN VÀ TRUST BOUNDARY

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🌐 BROWSER RUNTIME                                                         │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ 🏫 MAIN APPLICATION (ORIGIN A: https://app.apphocvui.vn)               │  │
│  │  - React Dashboard, Supabase User Auth JWT, Cookies, LocalStorage     │  │
│  │  - Giao tiếp với Player qua iframe sandbox (PostMessage an toàn)      │  │
│  │                                                                       │  │
│  │   ┌────────────────────────────────────────────────────────────────┐  │  │
│  │   │ 📦 IFRAME SANDBOX (ORIGIN B: https://player.apphocvui.vn)      │  │  │
│  │   │  src="https://player.apphocvui.vn/?session=<token>"            │  │  │
│  │   │  sandbox="allow-scripts allow-same-origin allow-forms..."      │  │  │
│  │   │                                                                │  │  │
│  │   │   [Player Wrapper (Origin B)]                                  │  │  │
│  │   │   ├── Cung cấp window.API / window.API_1484_11                 │  │  │
│  │   │   └── Iframe SCO Content (Origin B)                            │  │  │
│  │   │       src="/session/<token>/index.html"                        │  │  │
│  │   │       ├── Phát hiện tự nhiên: window.parent.API (Same-Origin)  │  │  │
│  │   │       └── Tải relative assets: /session/<token>/assets/...     │  │  │
│  │   └────────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │ Yêu cầu HTTP (Chỉ thấy Origin B)
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🚀 PLAYER HOST REVERSE PROXY (ORIGIN B: player.apphocvui.vn)                │
│                                                                             │
│  1. Phục vụ Static Player UI:                                               │
│     GET /index.html, /assets/* (HTML/JS/CSS của Player Runtime)             │
│                                                                             │
│  2. Reverse Proxy Nội bộ (Không chuyển hướng 302, không leak upstream):    │
│     GET /session-info?session=<token>                                       │
│     GET /session/<token>/<relative-path>                                    │
│     HEAD /session/<token>/<relative-path>                                   │
│     (Chuyển tiếp nguyên vẹn Range Header, 206 Partial Content, 416 RFC)     │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │ Upstream Backend Request (Server-to-Server)
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ ⚡ SUPABASE EDGE FUNCTION (PRIVATE GATEWAY)                                  │
│  URL: https://<project-ref>.supabase.co/functions/v1/scorm-asset-gateway   │
│  - verify_jwt = false (Xác thực độc quyền qua 256-bit Opaque Session Token) │
│  - Gọi RPC DB: resolve_scorm_session_asset(SHA-256(token))                  │
│  - Phân phối byte từ Private Storage: scorm-content/<owner>/<package>/...   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. SO SÁNH VÀ LỰA CHỌN CHIẾN LƯỢC HOSTING (HOSTING STRATEGY EVALUATION)

| Tiêu chí | Phương án A: Vercel Dedicated Project (ĐƯỢC CHỌN) | Phương án B: Cloudflare Worker / Edge Proxy | Phương án C: Nginx / Caddy Dedicated VPS |
| :--- | :--- | :--- | :--- |
| **Độ phức tạp hạ tầng** | 🟢 **Thấp nhất** (Cùng hệ sinh thái Vercel với Main App) | 🟡 Trung bình (Cần quản lý tài khoản Cloudflare riêng) | 🔴 Cao (Tự cấu hình VPS, Linux daemon, SSL renew) |
| **Bảo mật Origin** | 🟢 **100% Cô lập** (Subdomain riêng: `player.apphocvui.vn`) | 🟢 100% Cô lập (Subdomain riêng) | 🟢 100% Cô lập |
| **Cơ chế Reverse Proxy** | 🟢 **Vercel Rewrites / Serverless Proxy** cấu hình qua `vercel.json` | 🟢 Cloudflare Worker `fetch()` Proxy | 🟢 Nginx `proxy_pass` |
| **Hỗ trợ HTTP Range** | 🟢 **Hỗ trợ đầy đủ** (Header `Range`, `206 Partial Content`, `416`) | 🟢 Rất mạnh cho byte streaming | 🟢 Native Nginx streaming |
| **Quản lý Chứng chỉ SSL** | 🟢 **Tự động 100%** qua Vercel Let's Encrypt | 🟢 Tự động qua Cloudflare Edge SSL | 🟡 Phải cài đặt `certbot` crontab |
| **Bảo mật Secrets** | 🟢 **Không giữ Secret** (Player Host chỉ là Proxy, không giữ Service Role) | 🟢 Không giữ Service Role | 🟢 Không giữ Service Role |

### 👉 Quyết định Lựa chọn:
Chọn **Phương án A: Vercel Dedicated Project** cho thư mục `scorm-player/`.
- Phù hợp nhất với hạ tầng hiện tại của dự án.
- Triển khai độc lập: Tạo Vercel Project mới với **Root Directory** trỏ vào `scorm-player/`.
- Cấu hình domain: `player.apphocvui.vn` (Production) hoặc preview domain của Vercel (Staging).

---

## 3. CẤU HÌNH REVERSE PROXY TRÊN VERCEL (`scorm-player/vercel.json`)

Tệp `scorm-player/vercel.json` và Edge Proxy `scorm-player/api/proxy.js` đảm nhiệm 3 nhiệm vụ trọng yếu:
1. **Thiết lập Security Headers:** Áp dụng `Referrer-Policy: no-referrer` và `X-Content-Type-Options: nosniff`.
2. **Same-Origin Rewrites qua Edge Serverless:** Proxy trong suốt `/session-info` và `/session/:path*` tới upstream Gateway được cấu hình qua biến môi trường server-side `SCORM_GATEWAY_UPSTREAM` mà **không chuyển hướng 302** và **không hardcode URL dự án vào repo**.
3. **Phục vụ Static Content:** Định tuyến `/` và assets tĩnh của Player.

```json
{
  "version": 2,
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Referrer-Policy",
          "value": "no-referrer"
        },
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        }
      ]
    }
  ],
  "rewrites": [
    {
      "source": "/session-info",
      "destination": "/api/proxy"
    },
    {
      "source": "/session/:path*",
      "destination": "/api/proxy"
    }
  ]
}
```


---

## 4. BIỆN PHÁP CHỐNG RÒ RỈ TOKEN (TOKEN URL LEAK MITIGATION)

Do Session Token nằm trên URL Query (`?session=<token>`) và URL Path (`/session/<token>/...`), các biện pháp sau được thực thi bắt buộc:
1. **`Referrer-Policy: no-referrer`**: Ngăn chặn trình duyệt gửi URL chứa token sang bất kỳ liên kết ngoại lai hoặc tài nguyên ngoài nào.
2. **Zero Third-Party Trackers**: Ứng dụng SCORM Player hoàn toàn không nhúng Google Analytics, Facebook Pixel, CDN tracking scripts, hay bất kỳ thư viện bên thứ 3 nào.
3. **Không ghi Log Token ở Frontend**: Runtime JS của Player (`player.js`) không `console.log` raw session token.
4. **PostMessage Sanitization**: Thông điệp gửi từ Player sang Main App (`SCORM_LOADED`, `CMI_DATA`) chỉ truyền trạng thái học tập (passed/failed, score), tuyệt đối không gửi ngược lại Session Token.

---

## 5. HẠN CHẾ VỀ RANGE STREAMING (KNOWN LIMITATION)

> [!WARNING]
> **RANGE_MODE = `FULL_DOWNLOAD_SLICE`**
> - Gateway hiện tại tải toàn bộ đối tượng private vào bộ nhớ RAM trước khi cắt dải byte (`ArrayBuffer.slice`) để phục vụ `HTTP 206 Partial Content`.
> - **Hạn mức tệp đơn lẻ:** Tối đa **30MB** theo giới hạn bucket Storage.
> - **Đánh giá:** Đây là giải pháp phù hợp và ổn định cho các gói bài giảng SCORM tiểu học thông thường (hình ảnh, âm thanh MP3 ngắn, bài tập HTML/JS tương tác).
> - **Kế hoạch Tối ưu tương lai:** Khi hệ thống phát sinh nhu cầu phân phối video HD/4K dung lượng lớn, sẽ nâng cấp lên Upstream Range Passthrough qua Cloudflare R2 / Custom Streaming Gateway.

---

## 6. QUY TRÌNH TRIỂN KHAI VÀ STAGING GATES (9 GATES TO PRODUCTION)

Trước khi kích hoạt trên môi trường Production, quy trình nghiệm thu bắt buộc phải tuân thủ tuần tự 9 cổng (Staging Gates):

```
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
│ Gate 1: │ ──► │ Gate 2: │ ──► │ Gate 3: │ ──► │ Gate 4: │ ──► │ Gate 5: │
│ Deploy  │     │ Deploy  │     │ Config  │     │ DB SQL  │     │ Upload  │
│ Gateway │     │ Player  │     │ Proxy   │     │ Staging │     │ SCORM   │
│ Staging │     │ Staging │     │ Same-Org│     │ Preflt  │     │ Test    │
└─────────┘     └─────────┘     └─────────┘     └─────────┘     └─────────┘
                                                                     │
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐          │
│ Gate 9: │ ◄── │ Gate 8: │ ◄── │ Gate 7: │ ◄── │ Gate 6: │ ◄────────┘
│ Produc- │     │ Security│     │ Runtime │     │ Runtime │
│ tion Go │     │ Negative│     │ SCORM   │     │ SCORM   │
│ Live    │     │ Testing │     │ 2004    │     │ 1.2     │
└─────────┘     └─────────┘     └─────────┘     └─────────┘
```

1. **Gate 1 - Deploy Edge Function Staging:** Triển khai `scorm-asset-gateway` lên dự án Supabase Staging.
2. **Gate 2 - Deploy Player Staging:** Triển khai `scorm-player/` lên Vercel Preview/Staging project.
3. **Gate 3 - Same-Origin Proxy Test:** Kiểm tra rewrite `/session/*` và `/session-info` trên domain Staging.
4. **Gate 4 - Database Migration Preflight:** Chạy `ADD_SCORM_PHASE2_MVP.sql` và `ADD_SCORM_LAUNCH_SESSIONS.sql` trên DB Staging, kiểm tra `pgcrypto`.
5. **Gate 5 - Upload Real SCORM Packages:** Tải lên bài giảng SCORM chuẩn xuất bản từ iSpring Suite và Articulate Storyline.
6. **Gate 6 - Runtime SCORM 1.2 Test:** Kiểm thử hoàn thành bài học, ghi nhận điểm số và cmi.core.lesson_status.
7. **Gate 7 - Runtime SCORM 2004 Test:** Kiểm thử hoàn thành bài học SCORM 2004 4th Edition, cmi.completion_status.
8. **Gate 8 - Security Negative Testing:** Thử nghiệm tấn công path traversal, token brute-force, token hết hạn và cross-package access trên Staging.
9. **Gate 9 - Production Go-Live:** Cấu hình DNS Production Subdomain `player.apphocvui.vn` và merge PR #26.
