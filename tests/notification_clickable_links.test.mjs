// tests/notification_clickable_links.test.mjs
// Bộ kiểm thử toàn diện cho Notifications V1 — Clickable Links (R5-B)
// Bao phủ:
// 1. Unit tests cho isSafeHttpUrl, stripTrailingUrlPunctuation & tokenizeTextWithSafeLinks
// 2. Bảo mật chống XSS, HTML injection, scheme nguy hiểm (javascript:, data:, file:, vbscript:, blob:, mailto:)
// 3. Chặn URL chứa thông tin đăng nhập (user:pass@host) và kiểm tra ranh giới token (javascript:https://...)
// 4. Dấu câu cuối câu Tiếng Việt, ngoặc đơn cân bằng (Wikipedia), nhiều URL, query string, hash fragment, Unicode, xuống dòng
// 5. Component tests cho SafeNotificationContent (React elements, target="_blank", rel="noopener noreferrer", stopPropagation)
// 6. Kiểm tra tích hợp đúng 5 component được phê duyệt và bảo toàn nguyên trạng NotificationDrawer.jsx

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  isSafeHttpUrl,
  stripTrailingUrlPunctuation,
  tokenizeTextWithSafeLinks
} from '../src/utils/notificationLinks.js';

// Cho phép Node.js ESM (tương thích Node 20 LTS trên CI và Node 22/24+) nạp trực tiếp file .jsx sử dụng React.createElement
const jsxLoaderSource = `
import fs from 'node:fs';
export async function load(url, context, nextLoad) {
  if (url.endsWith('.jsx')) {
    return {
      format: 'module',
      shortCircuit: true,
      source: fs.readFileSync(new URL(url), 'utf8')
    };
  }
  return nextLoad(url, context);
}
`;
register(
  `data:text/javascript;base64,${Buffer.from(jsxLoaderSource, 'utf8').toString('base64')}`,
  import.meta.url
);

const { SafeNotificationContent } = await import(
  '../src/components/notifications/SafeNotificationContent.jsx'
);

const detailModalSource = fs.readFileSync(
  'src/components/notifications/NotificationDetailModal.jsx',
  'utf8'
);
const drawerSource = fs.readFileSync(
  'src/components/notifications/NotificationDrawer.jsx',
  'utf8'
);
const teacherTabSource = fs.readFileSync(
  'src/components/dashboard/notifications/NotificationManagementTab.jsx',
  'utf8'
);
const adminTabSource = fs.readFileSync(
  'src/components/dashboard/notifications/AdminNotificationManagementTab.jsx',
  'utf8'
);
const teacherPublishModalSource = fs.readFileSync(
  'src/components/dashboard/notifications/PublishNotificationModal.jsx',
  'utf8'
);
const adminPublishModalSource = fs.readFileSync(
  'src/components/dashboard/notifications/AdminPublishNotificationModal.jsx',
  'utf8'
);
const safeContentComponentSource = fs.readFileSync(
  'src/components/notifications/SafeNotificationContent.jsx',
  'utf8'
);

test('=== NOTIFICATIONS V1 R5-B: CLICKABLE LINKS & ZERO-XSS SECURITY SUITE ===', async (t) => {
  // =========================================================================
  // SUITE 1: KIỂM ĐỊNH URL AN TOÀN (WHATWG URL PARSER & PROTOCOL WHITELIST)
  // =========================================================================
  await t.test('Suite 1: isSafeHttpUrl chỉ chấp nhận HTTP/HTTPS hợp lệ và chặn mọi giao thức/cấu trúc nguy hiểm', () => {
    // 1.1. Các URL hợp lệ
    assert.equal(isSafeHttpUrl('https://example.com'), true);
    assert.equal(isSafeHttpUrl('https://azota.vn/de-thi/abc-123?lop=5A#cau-1'), true);
    assert.equal(isSafeHttpUrl('http://portal.school.edu.vn/thong-bao'), true);
    assert.equal(isSafeHttpUrl('https://docs.google.com/document/d/1234567890/edit?usp=sharing'), true);
    assert.equal(isSafeHttpUrl('https://vi.wikipedia.org/wiki/Toán_(tiểu_học)'), true);
    assert.equal(isSafeHttpUrl('http://localhost:3000/test'), true);
    assert.equal(isSafeHttpUrl('http://127.0.0.1:8080/health'), true);

    // 1.2. Chặn tuyệt đối các giao thức nguy hiểm
    assert.equal(isSafeHttpUrl('javascript:alert(1)'), false);
    assert.equal(isSafeHttpUrl('JAVASCRIPT:alert(document.cookie)'), false);
    assert.equal(isSafeHttpUrl('javascript://%0aalert(1)'), false);
    assert.equal(isSafeHttpUrl('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='), false);
    assert.equal(isSafeHttpUrl('file:///C:/Windows/System32/cmd.exe'), false);
    assert.equal(isSafeHttpUrl('vbscript:msgbox(1)'), false);
    assert.equal(isSafeHttpUrl('mailto:teacher@school.edu.vn'), false);
    assert.equal(isSafeHttpUrl('tel:0901234567'), false);
    assert.equal(isSafeHttpUrl('ftp://files.school.edu.vn/doc.pdf'), false);
    assert.equal(isSafeHttpUrl('blob:https://example.com/550e8400-e29b-41d4-a716-446655440000'), false);

    // 1.3. Chặn URL chứa thông tin đăng nhập (authority spoofing user:pass@host)
    assert.equal(isSafeHttpUrl('https://admin:secret@evil.com/login'), false);
    assert.equal(isSafeHttpUrl('https://google.com@evil.com/phishing'), false);
    assert.equal(isSafeHttpUrl('http://user@example.com'), false);

    // 1.4. Chặn URL thiếu scheme, rỗng, malformed hoặc hostname giả
    assert.equal(isSafeHttpUrl(''), false);
    assert.equal(isSafeHttpUrl(null), false);
    assert.equal(isSafeHttpUrl(undefined), false);
    assert.equal(isSafeHttpUrl('www.google.com'), false);
    assert.equal(isSafeHttpUrl('/dashboard/student'), false);
    assert.equal(isSafeHttpUrl('https://'), false);
    assert.equal(isSafeHttpUrl('https://.'), false);
    assert.equal(isSafeHttpUrl('https://..'), false);
    assert.equal(isSafeHttpUrl('https://---'), false);
    assert.equal(isSafeHttpUrl('https://invalid_domain_without_tld'), false);
    assert.equal(isSafeHttpUrl('https://example..com/test'), false);
    assert.equal(isSafeHttpUrl('https://example.com/path with spaces'), false);
    assert.equal(isSafeHttpUrl('https://example.com/\u0000evil'), false);
  });

  // =========================================================================
  // SUITE 2: XỬ LÝ DẤU CÂU CUỐI CÂU & NGOẶC CÂN BẰNG
  // =========================================================================
  await t.test('Suite 2: stripTrailingUrlPunctuation tách đúng dấu câu cuối câu và giữ ngoặc cân bằng', () => {
    // 2.1. Dấu chấm, phẩy, chấm than, chấm hỏi, hai chấm, chấm phẩy cuối câu
    assert.deepEqual(
      stripTrailingUrlPunctuation('https://example.com/bai-tap.'),
      { cleanUrl: 'https://example.com/bai-tap', trailingPunctuation: '.' }
    );
    assert.deepEqual(
      stripTrailingUrlPunctuation('https://example.com/bai-tap,'),
      { cleanUrl: 'https://example.com/bai-tap', trailingPunctuation: ',' }
    );
    assert.deepEqual(
      stripTrailingUrlPunctuation('https://example.com/bai-tap!'),
      { cleanUrl: 'https://example.com/bai-tap', trailingPunctuation: '!' }
    );
    assert.deepEqual(
      stripTrailingUrlPunctuation('https://example.com/bai-tap?'),
      { cleanUrl: 'https://example.com/bai-tap', trailingPunctuation: '?' }
    );
    assert.deepEqual(
      stripTrailingUrlPunctuation('https://example.com/bai-tap;'),
      { cleanUrl: 'https://example.com/bai-tap', trailingPunctuation: ';' }
    );
    assert.deepEqual(
      stripTrailingUrlPunctuation('https://example.com/bai-tap:'),
      { cleanUrl: 'https://example.com/bai-tap', trailingPunctuation: ':' }
    );

    // 2.2. Ngoặc đơn bao ngoài câu (không có ngoặc mở trong URL) -> cắt ngoặc đóng
    assert.deepEqual(
      stripTrailingUrlPunctuation('https://example.com/tai-lieu)'),
      { cleanUrl: 'https://example.com/tai-lieu', trailingPunctuation: ')' }
    );
    assert.deepEqual(
      stripTrailingUrlPunctuation('https://example.com/tai-lieu).'),
      { cleanUrl: 'https://example.com/tai-lieu', trailingPunctuation: ').' }
    );

    // 2.3. Ngoặc đơn cân bằng bên trong URL (như Wikipedia) -> giữ nguyên ngoặc đóng của URL
    assert.deepEqual(
      stripTrailingUrlPunctuation('https://vi.wikipedia.org/wiki/Toán_(tiểu_học)'),
      { cleanUrl: 'https://vi.wikipedia.org/wiki/Toán_(tiểu_học)', trailingPunctuation: '' }
    );

    // 2.4. URL có ngoặc cân bằng lại nằm trong ngoặc đơn của câu kèm dấu chấm
    assert.deepEqual(
      stripTrailingUrlPunctuation('https://vi.wikipedia.org/wiki/Toán_(tiểu_học)).'),
      { cleanUrl: 'https://vi.wikipedia.org/wiki/Toán_(tiểu_học)', trailingPunctuation: ').' }
    );
  });

  // =========================================================================
  // SUITE 3: TOKENIZER VỚI NHIỀU URL, RANH GIỚI TOKEN, UNICODE & XUỐNG DÒNG
  // =========================================================================
  await t.test('Suite 3: tokenizeTextWithSafeLinks phân tách chính xác văn bản và liên kết', () => {
    // 3.1. Văn bản thuần không có URL
    const plain = 'Ngày mai các em học sinh lớp 5A nộp bài tập đúng giờ nhé!';
    assert.deepEqual(tokenizeTextWithSafeLinks(plain), [
      { type: 'text', value: plain }
    ]);

    // 3.2. Một URL https:// nằm giữa câu
    const single = 'Các em làm bài tại https://azota.vn/de-thi/123 trước 20h nhé.';
    assert.deepEqual(tokenizeTextWithSafeLinks(single), [
      { type: 'text', value: 'Các em làm bài tại ' },
      { type: 'link', value: 'https://azota.vn/de-thi/123', href: 'https://azota.vn/de-thi/123' },
      { type: 'text', value: ' trước 20h nhé.' }
    ]);

    // 3.3. Nhiều URL (http và https) kèm dấu câu và ngoặc đơn
    const multi = 'Tài liệu 1 (https://school.edu.vn/doc-1), tài liệu 2: http://portal.edu.vn/doc-2!';
    assert.deepEqual(tokenizeTextWithSafeLinks(multi), [
      { type: 'text', value: 'Tài liệu 1 (' },
      { type: 'link', value: 'https://school.edu.vn/doc-1', href: 'https://school.edu.vn/doc-1' },
      { type: 'text', value: '), tài liệu 2: ' },
      { type: 'link', value: 'http://portal.edu.vn/doc-2', href: 'http://portal.edu.vn/doc-2' },
      { type: 'text', value: '!' }
    ]);

    // 3.4. Bảo toàn xuống dòng (\n), tiếng Việt có dấu và Emoji
    const multiline = '📢 Thông báo Lớp 4B:\n1. Học bài tại: https://hocvui.edu.vn/bai-1\n2. Chúc các em đạt điểm 10! 🌟';
    assert.deepEqual(tokenizeTextWithSafeLinks(multiline), [
      { type: 'text', value: '📢 Thông báo Lớp 4B:\n1. Học bài tại: ' },
      { type: 'link', value: 'https://hocvui.edu.vn/bai-1', href: 'https://hocvui.edu.vn/bai-1' },
      { type: 'text', value: '\n2. Chúc các em đạt điểm 10! 🌟' }
    ]);

    // 3.5. Kiểm tra ranh giới token: Chặn javascript:https://... hoặc chữ dính liền trước https://
    const spoofedBoundary = 'Không bấm vào javascript:https://evil.com hoặc foohttps://bar.com hay data:text/html,https://evil.com';
    const spoofTokens = tokenizeTextWithSafeLinks(spoofedBoundary);
    assert.equal(
      spoofTokens.some((tok) => tok.type === 'link'),
      false,
      'Tuyệt đối không được tạo link cho chuỗi giả mạo ranh giới token'
    );
    assert.deepEqual(spoofTokens, [{ type: 'text', value: spoofedBoundary }]);

    // 3.6. Chặn URL chứa user:pass@host ngay trong đoạn văn
    const embeddedCredsText = 'Link giả mạo https://bank.com:12345@attacker.com/login đã bị vô hiệu hóa.';
    const credTokens = tokenizeTextWithSafeLinks(embeddedCredsText);
    assert.equal(credTokens.some((tok) => tok.type === 'link'), false);
    assert.deepEqual(credTokens, [{ type: 'text', value: embeddedCredsText }]);
  });

  // =========================================================================
  // SUITE 4: COMPONENT SAFE NOTIFICATION CONTENT & CHỐNG XSS / TABNABBING
  // =========================================================================
  await t.test('Suite 4: SafeNotificationContent render đúng thẻ <a> an toàn và escape hoàn toàn HTML/XSS', () => {
    // 4.1. Render thông báo có link hợp lệ kèm query string & hash fragment
    const url = 'https://docs.google.com/forms/d/e/1FAIpQL/viewform?usp=sf_link&id=99#section-2';
    const html = renderToStaticMarkup(
      React.createElement(SafeNotificationContent, {
        content: `Mời các em điền biểu mẫu (${url}).`
      })
    );

    assert.ok(
      html.includes(`href="https://docs.google.com/forms/d/e/1FAIpQL/viewform?usp=sf_link&amp;id=99#section-2"`),
      'Phải render đúng thuộc tính href đã escape chuẩn HTML attribute'
    );
    assert.ok(html.includes('target="_blank"'), 'Thẻ <a> bắt buộc có target="_blank"');
    assert.ok(
      html.includes('rel="noopener noreferrer"'),
      'Thẻ <a> bắt buộc có rel="noopener noreferrer" chống Reverse Tabnabbing'
    );
    assert.ok(
      html.endsWith('</a>).'),
      'Dấu đóng ngoặc và dấu chấm cuối câu phải nằm ngoài thẻ <a>'
    );

    // 4.2. Kiểm tra sự kiện onClick trên phần tử <a> gọi e.stopPropagation()
    const renderedElements = SafeNotificationContent({
      content: 'Truy cập https://example.com/hoc-tap ngay'
    });
    assert.ok(Array.isArray(renderedElements), 'Khi có link phải trả về mảng React elements');
    const anchorElement = renderedElements.find((el) => el && el.type === 'a');
    assert.ok(anchorElement, 'Phải có phần tử React <a>');
    assert.equal(anchorElement.props.href, 'https://example.com/hoc-tap');
    assert.equal(anchorElement.props.target, '_blank');
    assert.equal(anchorElement.props.rel, 'noopener noreferrer');

    let propagationStopped = false;
    anchorElement.props.onClick({
      stopPropagation: () => {
        propagationStopped = true;
      }
    });
    assert.equal(propagationStopped, true, 'onClick của thẻ <a> phải gọi e.stopPropagation()');

    // 4.3. Kiểm tra chống XSS: HTML <script>, <img onerror>, <a href="javascript:..."> bị escape 100%
    const xssPayload = `<script>alert("xss")</script> <img src=x onerror=alert(1)> <a href="javascript:alert(1)">Bấm</a> javascript:alert(2)`;
    const xssHtml = renderToStaticMarkup(
      React.createElement(SafeNotificationContent, { content: xssPayload })
    );
    assert.equal(xssHtml.includes('<script>'), false, 'Tuyệt đối không được tạo thẻ <script>');
    assert.equal(xssHtml.includes('<img'), false, 'Tuyệt đối không được tạo thẻ <img>');
    assert.equal(xssHtml.includes('<a '), false, 'Tuyệt đối không được tạo thẻ <a> cho payload XSS');
    assert.ok(xssHtml.includes('&lt;script&gt;'), 'Chuỗi HTML độc hại phải bị React escape thành văn bản');

    // 4.4. Khi content rỗng hoặc null -> trả về null an toàn
    assert.equal(SafeNotificationContent({ content: '' }), null);
    assert.equal(SafeNotificationContent({ content: null }), null);
    assert.equal(SafeNotificationContent({ content: undefined }), null);
  });

  // =========================================================================
  // SUITE 5: KIỂM TRA TÍCH HỢP 5 COMPONENT & BẢO TOÀN NOTIFICATION DRAWER
  // =========================================================================
  await t.test('Suite 5: Tích hợp đúng 5 component đã phê duyệt và giữ nguyên NotificationDrawer.jsx', () => {
    // 5.1. Cả 5 component được phê duyệt đều import và sử dụng SafeNotificationContent
    assert.ok(
      detailModalSource.includes('SafeNotificationContent') &&
        detailModalSource.includes('<SafeNotificationContent content={notification.content} />'),
      'NotificationDetailModal.jsx phải sử dụng <SafeNotificationContent content={notification.content} />'
    );
    assert.ok(
      teacherTabSource.includes('SafeNotificationContent') &&
        teacherTabSource.includes('<SafeNotificationContent content={item.content} />'),
      'NotificationManagementTab.jsx phải sử dụng <SafeNotificationContent content={item.content} />'
    );
    assert.ok(
      adminTabSource.includes('SafeNotificationContent') &&
        adminTabSource.includes('<SafeNotificationContent content={item.content} />'),
      'AdminNotificationManagementTab.jsx phải sử dụng <SafeNotificationContent content={item.content} />'
    );
    assert.ok(
      teacherPublishModalSource.includes('SafeNotificationContent') &&
        teacherPublishModalSource.includes('<SafeNotificationContent content={draft.content} />'),
      'PublishNotificationModal.jsx phải sử dụng <SafeNotificationContent content={draft.content} />'
    );
    assert.ok(
      adminPublishModalSource.includes('SafeNotificationContent') &&
        adminPublishModalSource.includes('<SafeNotificationContent content={activeNotif.content} />'),
      'AdminPublishNotificationModal.jsx phải sử dụng <SafeNotificationContent content={activeNotif.content} />'
    );

    // 5.2. NotificationDrawer.jsx được giữ nguyên 100% (không chèn <a> lồng trong <article role="button">)
    assert.equal(
      drawerSource.includes('SafeNotificationContent'),
      false,
      'NotificationDrawer.jsx phải được giữ nguyên văn bản thuần để bảo toàn luồng click mở chi tiết và mark-as-read'
    );

    // 5.3. Không có bất kỳ file nào dùng dangerouslySetInnerHTML hoặc innerHTML
    for (const [name, src] of [
      ['SafeNotificationContent.jsx', safeContentComponentSource],
      ['NotificationDetailModal.jsx', detailModalSource],
      ['NotificationDrawer.jsx', drawerSource],
      ['NotificationManagementTab.jsx', teacherTabSource],
      ['AdminNotificationManagementTab.jsx', adminTabSource],
      ['PublishNotificationModal.jsx', teacherPublishModalSource],
      ['AdminPublishNotificationModal.jsx', adminPublishModalSource]
    ]) {
      assert.equal(
        src.includes('dangerouslySetInnerHTML'),
        false,
        `${name} tuyệt đối không được dùng dangerouslySetInnerHTML`
      );
      assert.equal(
        src.includes('.innerHTML'),
        false,
        `${name} tuyệt đối không được dùng .innerHTML`
      );
    }
  });
});
