import React from 'react';
import {
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';

/**
 * HostAudioLobbyBanner Component
 * Renders the authoritative audio configuration status banner in the Waiting Lobby.
 *
 * Distinctly renders:
 * 1. 'saving': In-progress spinner
 * 2. 'failed': Failure alert with explicit "Thử lại lưu âm thanh" retry action
 * 3. 'legacy_missing': Migration alert for legacy R18 sessions with explicit Host confirmation button
 * 4. 'saved': Verified persisted confirmation
 */
export function HostAudioLobbyBanner({
  audioConfigStatus = 'idle',
  audioConfigError = null,
  competitionAudioMode = 'in_class',
  onRetrySave,
  onApplyDefault,
  disabled = false,
}) {
  if (audioConfigStatus === 'idle') {
    return null;
  }

  const modeLabel = competitionAudioMode === 'in_class'
    ? 'Thi tại lớp (Chỉ phát trên máy Giáo viên)'
    : 'Thi trực tuyến (Phát trên máy Giáo viên & Học sinh)';

  if (audioConfigStatus === 'saving') {
    return React.createElement(
      'div',
      {
        'data-testid': 'audio-banner-saving',
        className: 'flex items-center gap-2 p-3 bg-sky-50 border border-sky-200 rounded-xl text-xs text-sky-800 font-semibold animate-pulse',
      },
      React.createElement(RefreshCw, { className: 'w-4 h-4 animate-spin text-sky-600 shrink-0' }),
      React.createElement(
        'span',
        null,
        `Đang lưu và xác thực cấu hình âm thanh phòng thi (${competitionAudioMode === 'in_class' ? 'Thi tại lớp' : 'Thi trực tuyến'})...`
      )
    );
  }

  if (audioConfigStatus === 'failed') {
    return React.createElement(
      'div',
      {
        'data-testid': 'audio-banner-failed',
        className: 'flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800',
      },
      React.createElement(
        'div',
        { className: 'flex items-center gap-2 font-semibold' },
        React.createElement(AlertCircle, { className: 'w-4 h-4 text-rose-600 shrink-0' }),
        React.createElement(
          'span',
          null,
          `Chưa lưu được cấu hình âm thanh: ${audioConfigError || 'Lỗi mạng hoặc timeout'}.`
        )
      ),
      React.createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'btn-retry-save-audio',
          onClick: onRetrySave,
          disabled: disabled,
          className: 'px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold text-xs shadow-xs transition shrink-0 disabled:opacity-50',
        },
        'Thử lại lưu âm thanh'
      )
    );
  }

  if (audioConfigStatus === 'legacy_missing') {
    return React.createElement(
      'div',
      {
        'data-testid': 'audio-banner-legacy-missing',
        className: 'flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-900',
      },
      React.createElement(
        'div',
        { className: 'flex items-start sm:items-center gap-2' },
        React.createElement(AlertTriangle, { className: 'w-5 h-5 text-amber-600 shrink-0 mt-0.5 sm:mt-0' }),
        React.createElement(
          'div',
          null,
          React.createElement('div', { className: 'font-bold' }, 'Phòng thi từ phiên bản trước chưa có cấu hình âm thanh.'),
          React.createElement(
            'div',
            { className: 'text-[11px] text-amber-700' },
            'Vui lòng xác nhận áp dụng cấu hình mặc định (Thi tại lớp - In Class) hoặc lưu cấu hình mới để sẵn sàng bắt đầu trận đấu.'
          )
        )
      ),
      React.createElement(
        'div',
        { className: 'flex items-center gap-2 shrink-0' },
        React.createElement(
          'button',
          {
            type: 'button',
            'data-testid': 'btn-apply-legacy-default',
            onClick: onApplyDefault,
            disabled: disabled,
            className: 'px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold text-xs shadow-xs transition disabled:opacity-50',
          },
          'Áp dụng cấu hình mặc định'
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            'data-testid': 'btn-save-current-audio',
            onClick: onRetrySave,
            disabled: disabled,
            className: 'px-2.5 py-1.5 bg-white hover:bg-amber-100 border border-amber-300 text-amber-800 rounded-lg font-medium text-xs transition disabled:opacity-50',
          },
          'Lưu cấu hình đã chọn'
        )
      )
    );
  }

  if (audioConfigStatus === 'saved') {
    return React.createElement(
      'div',
      {
        'data-testid': 'audio-banner-saved',
        className: 'flex items-center gap-2 p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-medium',
      },
      React.createElement(CheckCircle2, { className: 'w-4 h-4 text-emerald-600 shrink-0' }),
      React.createElement(
        'span',
        null,
        'Cấu hình âm thanh: ',
        React.createElement('strong', null, modeLabel),
        ' đã được xác nhận.'
      )
    );
  }

  return null;
}
