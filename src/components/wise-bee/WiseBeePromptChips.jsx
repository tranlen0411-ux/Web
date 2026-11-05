// src/components/wise-bee/WiseBeePromptChips.jsx
// Bộ nút câu hỏi gợi ý theo đúng vai trò Học sinh / Giáo viên / Admin (R1)

import React from 'react';
import { Sparkles } from 'lucide-react';
import { getWiseBeeRoleConfig } from '../../services/wiseBeeClient.js';

export const WiseBeePromptChips = ({ role, onSelectPrompt, disabled = false }) => {
  const roleConfig = getWiseBeeRoleConfig(role);
  if (!roleConfig || !Array.isArray(roleConfig.promptChips) || roleConfig.promptChips.length === 0) {
    return null;
  }

  const handleChipClick = (promptText) => {
    if (disabled || typeof onSelectPrompt !== 'function') return;
    onSelectPrompt(promptText);
  };

  return (
    <div
      className="px-4 py-2.5 bg-white border-b border-slate-200"
      role="region"
      aria-label="Gợi ý câu hỏi nhanh theo vai trò"
    >
      <div className="flex items-center gap-1.5 text-[11px] font-black text-amber-900 uppercase tracking-wide mb-2">
        <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" aria-hidden="true" />
        <span>Gợi ý câu hỏi mẫu ({roleConfig.badgeText}):</span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {roleConfig.promptChips.map((chipText) => (
          <button
            key={chipText}
            type="button"
            disabled={disabled}
            onClick={() => handleChipClick(chipText)}
            className="text-left text-xs font-bold px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-950 border-2 border-amber-200 hover:border-amber-400 transition-all active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {chipText}
          </button>
        ))}
      </div>
    </div>
  );
};
