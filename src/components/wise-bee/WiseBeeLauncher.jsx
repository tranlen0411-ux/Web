// src/components/wise-bee/WiseBeeLauncher.jsx
// Nút nổi 🐝 ở góc dưới bên phải để mở Ong Thông Thái (R1 Isolated Frontend Mock Prototype)
// Tự động ẩn khi người dùng chưa đăng nhập, bị khóa, sai vai trò, đang ở trang thi đấu/chơi game/SCORM hoặc khi có modal/drawer khác đang mở.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import {
  resolveWiseBeeRole,
  getWiseBeeRoleConfig,
  isWiseBeeSuppressedRoute,
  detectExternalBlockingOverlay,
} from '../../services/wiseBeeClient.js';
import { WiseBeeDrawer } from './WiseBeeDrawer.jsx';

export { isWiseBeeSuppressedRoute, detectExternalBlockingOverlay };

const DEFAULT_WISE_BEE_MOCK_ENABLED =
  typeof import.meta !== 'undefined' && import.meta.env
    ? Boolean(import.meta.env.DEV)
    : true;

export const WiseBeeLauncher = ({
  mockAuthOverride = null,
  featureEnabled = DEFAULT_WISE_BEE_MOCK_ENABLED,
} = {}) => {
  const realAuth = useAuth();
  const activeAuth =
    import.meta.env.DEV && mockAuthOverride && typeof mockAuthOverride === 'object'
      ? mockAuthOverride
      : realAuth;
  const { user, profile, loading } = activeAuth;
  const location = useLocation();

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [hasBlockingOverlay, setHasBlockingOverlay] = useState(false);

  const launcherButtonRef = useRef(null);
  const previousUserIdRef = useRef(user?.id || null);

  const validRole = featureEnabled && !loading ? resolveWiseBeeRole(user, profile) : null;
  const roleConfig = validRole ? getWiseBeeRoleConfig(validRole) : null;
  const isRouteSuppressed = isWiseBeeSuppressedRoute(location?.pathname || '');

  // Khi đăng xuất, chuyển tài khoản, bị khóa hoặc chuyển sang route bị ẩn -> đóng Drawer ngay lập tức
  useEffect(() => {
    const currentUserId = user?.id || null;
    if (
      !featureEnabled ||
      !validRole ||
      isRouteSuppressed ||
      previousUserIdRef.current !== currentUserId
    ) {
      setIsDrawerOpen(false);
    }
    previousUserIdRef.current = currentUserId;
  }, [featureEnabled, validRole, isRouteSuppressed, user?.id]);

  // Theo dõi các modal/drawer khác (NotificationDrawer, Exam, Exercise, Grading, Fullscreen SCORM)
  const syncOverlayState = useCallback(() => {
    const blocked = detectExternalBlockingOverlay();
    setHasBlockingOverlay(blocked);
    if (blocked) {
      setIsDrawerOpen(false);
    }
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined' || !document.body) return undefined;

    syncOverlayState();

    let observer = null;
    if (typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(() => {
        syncOverlayState();
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }

    document.addEventListener('fullscreenchange', syncOverlayState);
    return () => {
      if (observer) observer.disconnect();
      document.removeEventListener('fullscreenchange', syncOverlayState);
    };
  }, [syncOverlayState, location?.pathname]);

  // Chỉ hiển thị khi tính năng được bật, tài khoản đã đăng nhập hợp lệ, đúng vai trò, không ở trang cấm và không có modal khác che màn hình
  if (!featureEnabled || !validRole || !roleConfig || isRouteSuppressed || hasBlockingOverlay) {
    return null;
  }

  return (
    <>
      {/* Nút nổi 🐝 ở góc dưới bên phải (z-30 nằm dưới Navbar z-40 và mọi Modal z-50+) */}
      {!isDrawerOpen && (
        <div className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-30 pointer-events-none">
          <button
            ref={launcherButtonRef}
            type="button"
            onClick={() => setIsDrawerOpen(true)}
            aria-label="Mở Ong Thông Thái"
            aria-haspopup="dialog"
            aria-expanded={isDrawerOpen}
            title={`Mở Ong Thông Thái (${roleConfig.badgeText} — Bản mô phỏng)`}
            className="pointer-events-auto group flex items-center gap-2.5 px-3.5 py-2.5 sm:px-4 sm:py-3 rounded-full bg-gradient-to-tr from-amber-400 via-yellow-300 to-amber-300 hover:from-amber-500 hover:to-yellow-400 text-amber-950 font-black text-xs sm:text-sm border-4 border-amber-600 shadow-lg hover:shadow-xl transition-all active:scale-95 focus:outline-none focus:ring-4 focus:ring-amber-400"
          >
            <span
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-white border-2 border-amber-600 flex items-center justify-center text-lg sm:text-xl shadow-xs group-hover:rotate-12 transition-transform"
              aria-hidden="true"
            >
              🐝
            </span>
            <span className="flex flex-col items-start leading-tight pr-1">
              <span className="font-black text-amber-950">Ong Thông Thái</span>
              <span className="text-[10px] font-extrabold text-amber-900">
                Mô phỏng • {roleConfig.badgeText}
              </span>
            </span>
          </button>
        </div>
      )}

      {/* Cửa sổ trò chuyện dạng Drawer */}
      <WiseBeeDrawer
        isOpen={isDrawerOpen}
        role={validRole}
        activeUserId={user?.id || null}
        onClose={() => setIsDrawerOpen(false)}
        launcherButtonRef={launcherButtonRef}
      />
    </>
  );
};
