import React, { useState } from 'react';
import { RefreshCw, CheckCircle2, AlertCircle, HardDrive, ShieldAlert, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export const LegacyFilesMigrationTool = ({ onMigrated }) => {
  const [loading, setLoading] = useState(false);
  const [logMsgs, setLogMsgs] = useState([]);
  const [summary, setSummary] = useState(null);

  const runMigration = async () => {
    setLoading(true);
    setLogMsgs([]);
    setSummary(null);

    const logs = [];
    const addLog = (msg) => {
      logs.push(msg);
      setLogMsgs([...logs]);
    };

    addLog('🔍 Đang kiểm tra các bản ghi tài liệu cũ nằm ở root Storage...');

    try {
      // 1. Lấy danh sách các tài liệu có file_path không có dấu '/' (file cũ ở root)
      const { data: legacyItems, error: queryErr } = await supabase
        .from('learning_materials')
        .select('*')
        .not('file_path', 'is', null);

      if (queryErr) throw queryErr;

      const itemsToMove = (legacyItems || []).filter(item => item.file_path && !item.file_path.includes('/'));

      if (itemsToMove.length === 0) {
        addLog('✅ Không có file cũ nào ở root Storage cần di chuyển. Tất cả tệp tin đã nằm đúng cấu trúc thư mục {created_by}/{filename}.');
        setSummary({ success: 0, cleanupWarning: 0, failed: 0, total: 0 });
        setLoading(false);
        return;
      }

      addLog(`📌 Tìm thấy ${itemsToMove.length} tệp tin cũ ở root Storage. Bắt đầu di chuyển...`);

      let successCount = 0;
      let cleanupWarningCount = 0;
      let failCount = 0;

      for (const item of itemsToMove) {
        const oldPath = item.file_path;
        const newPath = `${item.created_by}/${Date.now()}_${crypto.randomUUID().slice(0, 6)}_${oldPath}`;

        addLog(`⏳ Đang di chuyển: "${item.title}" (${oldPath} ➔ ${newPath})...`);

        // A. Copy file sang path mới trong Storage
        const { error: copyErr } = await supabase.storage
          .from('learning-materials')
          .copy(oldPath, newPath);

        if (copyErr) {
          addLog(`❌ Lỗi copy Storage cho "${item.title}": ${copyErr.message}`);
          failCount++;
          continue;
        }

        // B. Cập nhật file_path mới vào DB
        const { error: dbErr } = await supabase
          .from('learning_materials')
          .update({ file_path: newPath })
          .eq('id', item.id);

        if (dbErr) {
          addLog(`❌ Lỗi cập nhật DB cho "${item.title}": ${dbErr.message}. Đang dọn dẹp file copy mới...`);
          
          // Kiểm tra lỗi khi rollback xóa newPath
          const { error: rollbackErr } = await supabase.storage
            .from('learning-materials')
            .remove([newPath]);

          if (rollbackErr) {
            addLog(`⚠️ Cảnh báo Rollback: Không thể xóa file mới [${newPath}] vừa copy (Lỗi: ${rollbackErr.message}).`);
          }
          failCount++;
          continue;
        }

        // C. Xóa file cũ ở root Storage & KIỂM TRA LỖI KHI XÓA OLD PATH
        const { error: removeOldErr } = await supabase.storage
          .from('learning-materials')
          .remove([oldPath]);

        if (removeOldErr) {
          addLog(`⚠️ Đã di chuyển đường dẫn CSDL sang tệp mới thành công, nhưng không thể xóa tệp cũ ở root [${oldPath}] (Lỗi: ${removeOldErr.message}). Cần Admin dọn dẹp tệp cũ thủ công.`);
          cleanupWarningCount++;
          // KHÔNG rollback DB vì file mới đã hoạt động trong CSDL
          // KHÔNG tăng successCount!
        } else {
          addLog(`✅ Di chuyển hoàn toàn thành công: "${item.title}"`);
          successCount++;
        }
      }

      setSummary({ 
        total: itemsToMove.length, 
        success: successCount, 
        cleanupWarning: cleanupWarningCount, 
        failed: failCount 
      });
      onMigrated?.();

    } catch (err) {
      console.error('Migration error:', err);
      addLog(`❌ Lỗi hệ thống khi di chuyển: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 bg-amber-50 rounded-2xl border-2 border-amber-300 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HardDrive className="w-5 h-5 text-amber-700" />
          <div>
            <h4 className="text-xs font-black text-amber-950">Công cụ Di Chuyển File Cũ (Admin Tools)</h4>
            <p className="text-[11px] font-bold text-slate-500">
              Chuẩn hóa các tệp tin cũ ở root Storage sang cấu trúc thư mục riêng <code className="bg-amber-100 px-1 rounded">{'{created_by}/{filename}'}</code>.
            </p>
          </div>
        </div>

        <button
          onClick={runMigration}
          disabled={loading}
          className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-black text-xs rounded-xl shadow-md flex items-center gap-1.5 shrink-0"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {loading ? 'Đang Di Chuyển...' : 'Quét & Di Chuyển File Cũ'}
        </button>
      </div>

      {logMsgs.length > 0 && (
        <div className="p-3 bg-slate-900 text-emerald-400 font-mono text-[11px] rounded-xl max-h-40 overflow-y-auto custom-scrollbar space-y-1">
          {logMsgs.map((msg, i) => (
            <div key={i}>{msg}</div>
          ))}
        </div>
      )}

      {summary && (
        <div className="p-2.5 bg-white rounded-xl border border-amber-200 text-xs font-bold text-slate-700 flex items-center justify-between flex-wrap gap-2">
          <span>Tổng số tệp quét: {summary.total}</span>
          <span className="text-emerald-700 font-black">Hoàn toàn thành công: {summary.success}</span>
          {summary.cleanupWarning > 0 && (
            <span className="text-amber-700 font-black">Cần dọn file cũ: {summary.cleanupWarning}</span>
          )}
          {summary.failed > 0 && (
            <span className="text-rose-600 font-black">Thất bại: {summary.failed}</span>
          )}
        </div>
      )}
    </div>
  );
};
