import React, { useState, useEffect, useRef } from 'react';
import { Calendar, Plus, Play, Lock, AlertCircle, CheckCircle2, X, Clock, Settings, Award, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';

// Regex kiểm tra UUID v1-v5 chuẩn (36 ký tự hex ngăn cách bằng 4 dấu gạch ngang)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isValidClassId = (id) => {
  return Boolean(
    id &&
    typeof id === 'string' &&
    id !== 'ALL' &&
    id !== 'ALL_IN_GRADE' &&
    UUID_REGEX.test(id.trim())
  );
};

export function RankingPeriodModal({ isOpen, onClose, selectedClassId, myClasses = [], onPeriodChange }) {
  const [activeTab, setActiveTab] = useState('list'); // 'list' | 'create'
  const [periods, setPeriods] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Form state
  const [formClassId, setFormClassId] = useState(
    isValidClassId(selectedClassId) ? selectedClassId : (myClasses?.[0]?.id || '')
  );
  const [name, setName] = useState('');
  const [periodType, setPeriodType] = useState('MONTH');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Request counter ref để chống race condition khi đổi lớp nhanh liên tục
  const latestRequestIdRef = useRef(0);

  // Khi modal mở hoặc selectedClassId thay đổi: đồng bộ lớp ưu tiên và tải kỳ xếp hạng ngay lập tức
  useEffect(() => {
    if (isOpen) {
      let targetClassId = '';
      if (isValidClassId(selectedClassId)) {
        targetClassId = selectedClassId;
      } else if (isValidClassId(formClassId)) {
        targetClassId = formClassId;
      } else if (myClasses && myClasses.length > 0) {
        const firstValid = myClasses.find(c => isValidClassId(c?.id));
        if (firstValid) targetClassId = firstValid.id;
      }

      if (targetClassId) {
        setFormClassId(targetClassId);
        fetchPeriods(targetClassId);
      } else {
        setPeriods([]);
      }
    } else {
      // Khi đóng modal: hủy nhận phản hồi từ các request dở dang và dọn dẹp thông báo
      latestRequestIdRef.current++;
      setErrorMessage('');
      setSuccessMessage('');
    }
  }, [isOpen, selectedClassId]);

  const handleClassSelectChange = (newClassId) => {
    setFormClassId(newClassId);
    if (isValidClassId(newClassId)) {
      fetchPeriods(newClassId);
    } else {
      setPeriods([]);
    }
  };

  const fetchPeriods = async (targetClassId) => {
    const classIdToFetch = targetClassId || formClassId;
    if (!isValidClassId(classIdToFetch)) {
      setPeriods([]);
      return;
    }

    const currentRequestId = ++latestRequestIdRef.current;
    try {
      setLoading(true);
      setErrorMessage('');
      const { data, error } = await supabase
        .from('ranking_periods')
        .select('*')
        .eq('class_id', classIdToFetch)
        .order('created_at', { ascending: false });

      // Nếu đã có request mới hơn được gửi đi trong lúc chờ -> bỏ qua kết quả này (chống race condition)
      if (currentRequestId !== latestRequestIdRef.current) {
        return;
      }

      if (error) throw error;
      setPeriods(data || []);
    } catch (err) {
      if (currentRequestId === latestRequestIdRef.current) {
        setErrorMessage('Lỗi khi tải danh sách kỳ xếp hạng: ' + err.message);
      }
    } finally {
      if (currentRequestId === latestRequestIdRef.current) {
        setLoading(false);
      }
    }
  };

  const handleCreatePeriod = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMessage('Vui lòng nhập tên kỳ xếp hạng.');
      return;
    }
    if (!startAt || !endAt) {
      setErrorMessage('Vui lòng chọn thời gian bắt đầu và kết thúc.');
      return;
    }
    if (new Date(endAt) <= new Date(startAt)) {
      setErrorMessage('Thời gian kết thúc phải sau thời gian bắt đầu.');
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage('');
      setSuccessMessage('');

      const startDateObj = new Date(`${startAt}T00:00:00`);
      const endDateObj = new Date(`${endAt}T00:00:00`);
      endDateObj.setDate(endDateObj.getDate() + 1);

      const { data, error } = await supabase.rpc('create_ranking_period', {
        p_class_id: formClassId,
        p_name: name.trim(),
        p_period_type: periodType,
        p_start_at: startDateObj.toISOString(),
        p_end_at: endDateObj.toISOString()
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.message);

      setSuccessMessage('Tạo kỳ xếp hạng thành công!');
      setName('');
      setActiveTab('list');
      await fetchPeriods();
      if (onPeriodChange) onPeriodChange();
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleActivatePeriod = async (periodId) => {
    try {
      setIsSubmitting(true);
      setErrorMessage('');
      setSuccessMessage('');

      const { data, error } = await supabase.rpc('activate_ranking_period', {
        p_period_id: periodId
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.message);

      setSuccessMessage('Đã kích hoạt kỳ xếp hạng thành công!');
      await fetchPeriods();
      if (onPeriodChange) onPeriodChange();
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteDraftPeriod = async (periodId, periodName) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa bản nháp kỳ xếp hạng "${periodName || ''}"? Thao tác này không thể hoàn tác.`)) {
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage('');
      setSuccessMessage('');

      const { data, error } = await supabase.rpc('delete_draft_ranking_period', {
        p_period_id: periodId
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.message);

      setSuccessMessage('Đã xóa bản nháp kỳ xếp hạng thành công!');
      await fetchPeriods();
      if (onPeriodChange) onPeriodChange();
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClosePeriod = async (periodId) => {
    if (!window.confirm('Bạn có chắc chắn muốn đóng kỳ xếp hạng này? Kết quả tổng kết sẽ được lưu snapshot cố định.')) {
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage('');
      setSuccessMessage('');

      const { data, error } = await supabase.rpc('close_ranking_period', {
        p_period_id: periodId
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.message);

      setSuccessMessage('Đã đóng kỳ xếp hạng và tổng kết kết quả thành công!');
      await fetchPeriods();
      if (onPeriodChange) onPeriodChange();
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl border-4 border-indigo-200 overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* HEADER */}
        <div className="p-5 bg-gradient-to-r from-indigo-600 to-indigo-800 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="w-6 h-6 text-amber-300" />
            <h2 className="text-lg font-black tracking-wide">⚙️ Quản Lý Kỳ Xếp Hạng</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/20 rounded-2xl transition-all"
          >
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

        {/* MESSAGES */}
        {errorMessage && (
          <div className="mx-5 mt-4 p-3 bg-rose-50 border-2 border-rose-200 rounded-2xl text-xs font-black text-rose-800 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div className="mx-5 mt-4 p-3 bg-emerald-50 border-2 border-emerald-200 rounded-2xl text-xs font-black text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* SELECT CLASS & TABS */}
        <div className="p-5 border-b border-indigo-100 flex flex-col sm:flex-row items-center justify-between gap-3 bg-indigo-50/50">
          <div className="w-full sm:w-auto flex items-center gap-2">
            <label className="text-xs font-black text-indigo-950 shrink-0">Lớp học:</label>
            <select
              value={formClassId}
              onChange={(e) => handleClassSelectChange(e.target.value)}
              className="p-2 bg-white border-2 border-indigo-200 rounded-xl text-xs font-black text-indigo-950 focus:outline-none"
            >
              {(myClasses || [])
                .filter(c => isValidClassId(c?.id))
                .map(c => (
                  <option key={c.id} value={c.id}>🏫 {c.name}</option>
                ))}
            </select>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={() => setActiveTab('list')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all flex items-center gap-1 ${
                activeTab === 'list'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'bg-white text-indigo-900 border border-indigo-200'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" /> Danh sách kỳ
            </button>
            <button
              onClick={() => setActiveTab('create')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all flex items-center gap-1 ${
                activeTab === 'create'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'bg-white text-indigo-900 border border-indigo-200'
              }`}
            >
              <Plus className="w-3.5 h-3.5" /> Tạo kỳ mới
            </button>
          </div>
        </div>

        {/* BODY CONTENT */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          
          {activeTab === 'list' ? (
            loading ? (
              <div className="text-center py-8 text-xs font-bold text-slate-500">Đang tải danh sách kỳ...</div>
            ) : periods.length === 0 ? (
              <div className="text-center py-12 bg-indigo-50/50 rounded-2xl border-2 border-dashed border-indigo-200">
                <Calendar className="w-10 h-10 text-indigo-400 mx-auto mb-2" />
                <p className="text-xs font-black text-indigo-950">Chưa có kỳ xếp hạng nào cho lớp này</p>
                <p className="text-[11px] font-bold text-slate-500 mt-1">Bấm "Tạo kỳ mới" để bắt đầu kỳ thi đua cho lớp.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {periods.map(p => (
                  <div
                    key={p.id}
                    className={`p-4 rounded-2xl border-2 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                      p.status === 'ACTIVE'
                        ? 'bg-emerald-50/80 border-emerald-300'
                        : p.status === 'CLOSED'
                        ? 'bg-slate-50 border-slate-200'
                        : 'bg-white border-indigo-200'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-black text-slate-900">{p.name}</h4>
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black ${
                          p.status === 'ACTIVE'
                            ? 'bg-emerald-200 text-emerald-900'
                            : p.status === 'CLOSED'
                            ? 'bg-slate-200 text-slate-800'
                            : 'bg-indigo-100 text-indigo-900'
                        }`}>
                          {p.status === 'ACTIVE' ? '🟢 Đang diễn ra' : p.status === 'CLOSED' ? '🔒 Đã kết thúc' : '📝 Bản nháp (DRAFT)'}
                        </span>
                      </div>
                      <div className="text-[11px] font-bold text-slate-500 mt-1 flex items-center gap-2">
                        <Clock className="w-3 h-3 text-indigo-600" />
                        <span>
                          {new Date(p.start_at).toLocaleDateString('vi-VN')} → {new Date(p.end_at).toLocaleDateString('vi-VN')}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      {p.status === 'DRAFT' && (
                        <>
                          <button
                            disabled={isSubmitting}
                            onClick={() => handleActivatePeriod(p.id)}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black transition-all flex items-center gap-1 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Play className="w-3.5 h-3.5" /> Kích hoạt
                          </button>
                          <button
                            disabled={isSubmitting}
                            onClick={() => handleDeleteDraftPeriod(p.id, p.name)}
                            className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 hover:border-rose-300 rounded-xl text-xs font-black transition-all flex items-center gap-1 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Xóa bản nháp này"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-rose-600" /> Xóa nháp
                          </button>
                        </>
                      )}

                      {p.status === 'ACTIVE' && (
                        <button
                          disabled={isSubmitting}
                          onClick={() => handleClosePeriod(p.id)}
                          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-black transition-all flex items-center gap-1 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Lock className="w-3.5 h-3.5" /> Đóng kỳ & Tổng kết
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            <form onSubmit={handleCreatePeriod} className="space-y-4">
              <div>
                <label className="block text-xs font-black text-indigo-950 mb-1">Tên kỳ xếp hạng:</label>
                <input
                  type="text"
                  placeholder="Ví dụ: Thi đua Tháng 9 - Bứt Phá"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full p-2.5 bg-white border-2 border-indigo-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-black text-indigo-950 mb-1">Loại kỳ:</label>
                  <select
                    value={periodType}
                    onChange={(e) => setPeriodType(e.target.value)}
                    className="w-full p-2.5 bg-white border-2 border-indigo-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none"
                  >
                    <option value="WEEK">Tuần 📅</option>
                    <option value="MONTH">Tháng 📆</option>
                    <option value="SEMESTER">Học kỳ 🎓</option>
                    <option value="CUSTOM">Tùy chọn ⚙️</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-black text-indigo-950 mb-1">Ngày bắt đầu:</label>
                  <input
                    type="date"
                    value={startAt}
                    onChange={(e) => setStartAt(e.target.value)}
                    className="w-full p-2.5 bg-white border-2 border-indigo-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-indigo-950 mb-1">Ngày kết thúc:</label>
                  <input
                    type="date"
                    value={endAt}
                    onChange={(e) => setEndAt(e.target.value)}
                    className="w-full p-2.5 bg-white border-2 border-indigo-200 rounded-xl text-xs font-bold text-slate-900 focus:outline-none"
                    required
                  />
                </div>
              </div>

              <div className="p-3 bg-amber-50 rounded-2xl border border-amber-200 text-[11px] text-amber-900 font-bold">
                ⚠️ <strong>Lưu ý quan trọng:</strong> Tạo kỳ mới sẽ bắt đầu điểm/Sao xếp hạng kỳ mới từ 0. Tuyệt đối <strong>KHÔNG KHÓA HOẶC XÓA</strong> tổng Sao tích lũy, Xu, điểm bài tập hay lịch sử học tập của học sinh.
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('list')}
                  className="px-4 py-2 border-2 border-slate-200 text-slate-700 rounded-xl text-xs font-black"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black shadow-md"
                >
                  {isSubmitting ? 'Đang tạo...' : 'Lưu Kỳ Xếp Hạng'}
                </button>
              </div>
            </form>
          )}

        </div>

      </div>
    </div>
  );
}
