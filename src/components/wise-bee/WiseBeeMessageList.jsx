// src/components/wise-bee/WiseBeeMessageList.jsx
// Hiển thị danh sách bong bóng hội thoại hỗ trợ định dạng Markdown an toàn (in đậm, danh sách, xuống dòng)

import React, { useEffect, useRef } from 'react';
import { User, AlertTriangle, RefreshCw } from 'lucide-react';
import {
  getWiseBeeRoleConfig,
  WISE_BEE_MOCK_IDENTITY_LABEL,
  tokenizeWiseBeeFormattedText,
} from '../../services/wiseBeeClient.js';

/**
 * Kết xuất các đoạn văn bản inline (text / **bold**) bằng phần tử React thuần túy.
 * Mọi giá trị chuỗi đều do React tự động escape chống XSS.
 */
function renderInlineSegments(segments, keyPrefix) {
  return segments.map((seg, idx) => {
    const key = `${keyPrefix}-seg-${idx}`;
    if (seg.type === 'bold') {
      return (
        <strong key={key} className="font-black text-amber-950">
          {seg.value}
        </strong>
      );
    }
    return <React.Fragment key={key}>{seg.value}</React.Fragment>;
  });
}

/**
 * Kết xuất văn bản của Ong Thông Thái với hỗ trợ:
 * - Văn bản in đậm (**...**)
 * - Danh sách đầu dòng (•, -, *) và danh sách đánh số (1., 1️⃣...)
 * - Xuống dòng dễ đọc
 */
export function renderSafeWiseBeeMarkdown(text, messageId = 'msg') {
  const blocks = tokenizeWiseBeeFormattedText(text);

  return (
    <div className="space-y-1.5 text-sm font-medium text-slate-800 leading-relaxed break-words">
      {blocks.map((block, lineIdx) => {
        const lineKey = `${messageId}-line-${lineIdx}`;

        if (block.type === 'empty') {
          return <div key={lineKey} className="h-1" aria-hidden="true" />;
        }

        if (block.type === 'bullet') {
          return (
            <div key={lineKey} className="flex items-start gap-2 pl-1">
              <span className="font-black text-amber-600 select-none shrink-0" aria-hidden="true">
                {block.marker}
              </span>
              <span className="flex-1">{renderInlineSegments(block.segments, lineKey)}</span>
            </div>
          );
        }

        if (block.type === 'numbered') {
          return (
            <div key={lineKey} className="flex items-start gap-2 pl-0.5">
              <span className="font-black text-amber-800 select-none shrink-0">
                {block.marker}
              </span>
              <span className="flex-1">{renderInlineSegments(block.segments, lineKey)}</span>
            </div>
          );
        }

        return (
          <p key={lineKey} className="leading-relaxed">
            {renderInlineSegments(block.segments, lineKey)}
          </p>
        );
      })}
    </div>
  );
}

export const WiseBeeMessageList = ({
  role,
  messages = [],
  isLoading = false,
  error = null,
  onRetryLastQuestion,
}) => {
  const bottomAnchorRef = useRef(null);
  const roleConfig = getWiseBeeRoleConfig(role);

  useEffect(() => {
    if (bottomAnchorRef.current && typeof bottomAnchorRef.current.scrollIntoView === 'function') {
      bottomAnchorRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages.length, isLoading, error]);

  if (!roleConfig) return null;

  return (
    <div
      className="flex-1 overflow-y-auto p-3.5 sm:p-4 space-y-3 bg-amber-50/30"
      role="log"
      aria-live="polite"
      aria-label="Lịch sử cuộc trò chuyện tạm thời trong phiên"
    >
      {/* Lời chào mở đầu của Ong Thông Thái */}
      <article
        className="p-3.5 rounded-2xl bg-white border-2 border-amber-300 shadow-xs text-slate-800"
        aria-label="Lời chào từ Ong Thông Thái"
      >
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="inline-flex items-center gap-1.5 text-xs font-black text-amber-950">
            <span aria-hidden="true">🐝</span>
            <span>Ong Thông Thái (Mô phỏng)</span>
          </span>
          <span className="text-[10px] font-bold text-amber-900 bg-amber-100 px-2 py-0.5 rounded-md border border-amber-200">
            {WISE_BEE_MOCK_IDENTITY_LABEL}
          </span>
        </div>

        {renderSafeWiseBeeMarkdown(roleConfig.greeting, 'greeting')}
      </article>

      {/* Danh sách tin nhắn trong phiên (Chỉ tồn tại trong RAM) */}
      {messages.map((msg) => {
        const isUser = msg.sender === 'user';

        return (
          <article
            key={msg.id}
            className={`p-3.5 rounded-2xl border-2 transition-all ${
              isUser
                ? 'ml-6 bg-sky-600 text-white border-sky-700 shadow-xs'
                : 'mr-3 bg-white text-slate-800 border-amber-300 shadow-xs'
            }`}
            aria-label={isUser ? 'Câu hỏi của bạn' : 'Câu trả lời mô phỏng từ Ong Thông Thái'}
          >
            {/* Nhãn phân biệt rõ bằng chữ & biểu tượng (không phụ thuộc màu sắc đơn thuần) */}
            <div className="flex items-center justify-between gap-2 mb-1.5">
              {isUser ? (
                <span className="inline-flex items-center gap-1 text-xs font-black text-sky-100">
                  <User className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>Câu hỏi của bạn</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs font-black text-amber-950">
                  <span aria-hidden="true">🐝</span>
                  <span>Trả lời từ Ong Thông Thái (Mô phỏng)</span>
                </span>
              )}
            </div>

            {/* Nội dung tin nhắn: User giữ thuần văn bản, Assistant hỗ trợ in đậm & danh sách an toàn */}
            {isUser ? (
              <p className="text-sm font-bold text-white whitespace-pre-line break-words leading-relaxed">
                {msg.text}
              </p>
            ) : (
              renderSafeWiseBeeMarkdown(msg.text, msg.id)
            )}

            {/* Dòng nhắc rút gọn dưới câu trả lời của Ong Thông Thái */}
            {!isUser && (
              <div className="mt-2 pt-1.5 border-t border-slate-100 text-[11px] font-semibold text-slate-500">
                {roleConfig.disclaimerText}
              </div>
            )}
          </article>
        );
      })}

      {/* Trạng thái đang trả lời (Accessibility aria-live) */}
      {isLoading && (
        <div
          role="status"
          aria-live="polite"
          className="mr-3 p-3.5 rounded-2xl bg-white border-2 border-amber-200 flex items-center gap-2.5 text-xs font-extrabold text-amber-900"
        >
          <span className="text-base animate-bounce" aria-hidden="true">
            🐝
          </span>
          <span>Ong Thông Thái đang chuẩn bị câu trả lời mô phỏng...</span>
        </div>
      )}

      {/* Trạng thái thông báo lỗi hoặc nhắc nhở an toàn */}
      {error && (
        <div
          role="alert"
          className="p-3.5 rounded-2xl bg-rose-50 border-2 border-rose-300 text-rose-900 text-xs space-y-2"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" aria-hidden="true" />
            <p className="font-bold leading-relaxed">{error.message}</p>
          </div>

          {error.retryable && typeof onRetryLastQuestion === 'function' && (
            <button
              type="button"
              onClick={onRetryLastQuestion}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-rose-100 text-rose-900 font-black border border-rose-300 transition-colors focus:outline-none focus:ring-2 focus:ring-rose-500"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Thử lại câu hỏi vừa rồi</span>
            </button>
          )}
        </div>
      )}

      <div ref={bottomAnchorRef} />
    </div>
  );
};
