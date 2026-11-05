// src/components/notifications/SafeNotificationContent.jsx
// Component hiển thị nội dung thông báo an toàn với hỗ trợ tự động gắn thẻ liên kết (Clickable Links - R5-B)
// Tuyệt đối không chèn HTML thô; chỉ tạo React text nodes và thẻ <a> đã qua kiểm định WHATWG URL.

import React from 'react';
import { tokenizeTextWithSafeLinks } from '../../utils/notificationLinks.js';

export const SafeNotificationContent = ({ content, linkClassName = '' }) => {
  const tokens = tokenizeTextWithSafeLinks(content);

  if (!tokens || tokens.length === 0) {
    return null;
  }

  // Trường hợp thông báo chỉ có văn bản thuần (không có URL): trả về chuỗi thuần y hệt hành vi cũ
  if (tokens.length === 1 && tokens[0].type === 'text') {
    return tokens[0].value;
  }

  const defaultLinkClasses =
    'text-sky-700 hover:text-sky-900 underline decoration-sky-500/70 hover:decoration-sky-900 underline-offset-2 font-bold break-all transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-1 rounded-sm';

  const resolvedLinkClasses = linkClassName
    ? `${defaultLinkClasses} ${linkClassName}`
    : defaultLinkClasses;

  return tokens.map((token, idx) => {
    if (token.type === 'link') {
      return React.createElement(
        'a',
        {
          key: `link-${idx}-${token.href}`,
          href: token.href,
          target: '_blank',
          rel: 'noopener noreferrer',
          onClick: (e) => e.stopPropagation(),
          className: resolvedLinkClasses
        },
        token.value
      );
    }

    return React.createElement(
      React.Fragment,
      { key: `text-${idx}` },
      token.value
    );
  });
};
