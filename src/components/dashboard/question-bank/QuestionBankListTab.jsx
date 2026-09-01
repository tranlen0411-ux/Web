import React, { useState, useEffect, useCallback } from 'react';
import {
  Search,
  RefreshCw,
  Filter,
  Layers,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  BookOpen,
  GraduationCap,
  Sparkles,
  HelpCircle,
  CheckCircle2,
  Lock,
  Globe
} from 'lucide-react';
import { listQuestions } from '../../../services/questionBankService';

const DIFFICULTY_LABELS = {
  easy: { label: 'Nhận biết', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  medium: { label: 'Thông hiểu', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  hard: { label: 'Vận dụng', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  expert: { label: 'Vận dụng cao', color: 'bg-rose-50 text-rose-700 border-rose-200' }
};

const TYPE_LABELS = {
  single_choice: 'Trắc nghiệm một đáp án',
  multiple_choice: 'Trắc nghiệm nhiều đáp án',
  fill_blank: 'Điền khuyết',
  short_answer: 'Trả lời ngắn',
  essay: 'Tự luận',
  image_upload: 'Tải ảnh',
  file_upload: 'Tải tệp'
};

const VISIBILITY_LABELS = {
  private: { label: 'Cá nhân', icon: Lock, color: 'text-slate-500 bg-slate-100' },
  school_shared: { label: 'Toàn trường', icon: Globe, color: 'text-indigo-600 bg-indigo-50' },
  public_template: { label: 'Mẫu công khai', icon: Globe, color: 'text-emerald-600 bg-emerald-50' }
};

export const QuestionBankListTab = ({ role = 'teacher' }) => {
  const [questions, setQuestions] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Search and filters state
  const [searchText, setSearchText] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [selectedGrade, setSelectedGrade] = useState('');
  const [selectedDifficulty, setSelectedDifficulty] = useState('');
  const [selectedType, setSelectedType] = useState('');

  const fetchQuestions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filters = {
        page,
        page_size: pageSize,
        search: appliedSearch || undefined,
        subject: selectedSubject || undefined,
        grade_level: selectedGrade ? Number(selectedGrade) : undefined,
        difficulty: selectedDifficulty || undefined,
        question_type: selectedType || undefined
      };

      const result = await listQuestions(filters);
      setQuestions(result?.items || []);
      setTotalCount(result?.total_count || 0);
    } catch (err) {
      console.error('Lỗi khi tải Question Bank:', err);
      setError(err?.message || 'Không thể tải danh sách câu hỏi. Vui lòng thử lại.');
      setQuestions([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, appliedSearch, selectedSubject, selectedGrade, selectedDifficulty, selectedType]);

  useEffect(() => {
    fetchQuestions();
  }, [fetchQuestions]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setPage(1);
    setAppliedSearch(searchText.trim());
  };

  const handleResetFilters = () => {
    setSearchText('');
    setAppliedSearch('');
    setSelectedSubject('');
    setSelectedGrade('');
    setSelectedDifficulty('');
    setSelectedType('');
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return (
    <div className="bg-white rounded-3xl border-4 border-amber-200 p-4 sm:p-6 shadow-sm mb-8 animate-fadeIn">
      {/* HEADER KHU VỰC */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-amber-100 mb-6">
        <div>
          <div className="flex items-center gap-2 text-indigo-900 font-black text-lg sm:text-xl">
            <Layers className="w-6 h-6 text-indigo-600" />
            <span>Ngân Hàng Câu Hỏi Chuẩn Hóa</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-indigo-100 text-indigo-700">
              V1 Read-Only
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Tra cứu và xem kho câu hỏi học thuật ({role === 'admin' ? 'Quyền Quản trị viên' : 'Quyền Giáo viên'})
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchQuestions()}
            disabled={loading}
            className="px-3.5 py-2 text-xs font-black rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-900 transition-colors flex items-center gap-1.5 disabled:opacity-50"
            title="Tải lại danh sách"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Làm mới
          </button>
        </div>
      </div>

      {/* THANH TÌM KIẾM VÀ BỘ LỌC */}
      <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200/80 mb-6">
        <form onSubmit={handleSearchSubmit} className="flex flex-col md:flex-row gap-3 mb-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Tìm kiếm theo tiêu đề, nội dung câu hỏi..."
              className="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-300 rounded-xl text-xs sm:text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            />
          </div>
          <button
            type="submit"
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs sm:text-sm font-black rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2"
          >
            <Search className="w-4 h-4" />
            Tìm Kiếm
          </button>
        </form>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs font-bold text-slate-700">
          <div>
            <label className="block text-[11px] font-black text-slate-500 mb-1">Môn học</label>
            <select
              value={selectedSubject}
              onChange={(e) => { setSelectedSubject(e.target.value); setPage(1); }}
              className="w-full bg-white border border-slate-300 rounded-xl px-2.5 py-2 text-xs focus:outline-none focus:border-indigo-500"
            >
              <option value="">Tất cả môn học</option>
              <option value="Toán">Toán</option>
              <option value="Tiếng Việt">Tiếng Việt</option>
              <option value="Tiếng Anh">Tiếng Anh</option>
              <option value="Khoa học">Khoa học</option>
              <option value="Lịch sử & Địa lý">Lịch sử & Địa lý</option>
              <option value="Tin học">Tin học</option>
              <option value="Đạo đức">Đạo đức</option>
              <option value="Tự nhiên & Xã hội">Tự nhiên & Xã hội</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-black text-slate-500 mb-1">Khối lớp</label>
            <select
              value={selectedGrade}
              onChange={(e) => { setSelectedGrade(e.target.value); setPage(1); }}
              className="w-full bg-white border border-slate-300 rounded-xl px-2.5 py-2 text-xs focus:outline-none focus:border-indigo-500"
            >
              <option value="">Tất cả khối lớp</option>
              <option value="1">Lớp 1</option>
              <option value="2">Lớp 2</option>
              <option value="3">Lớp 3</option>
              <option value="4">Lớp 4</option>
              <option value="5">Lớp 5</option>
              <option value="6">Lớp 6</option>
              <option value="7">Lớp 7</option>
              <option value="8">Lớp 8</option>
              <option value="9">Lớp 9</option>
              <option value="10">Lớp 10</option>
              <option value="11">Lớp 11</option>
              <option value="12">Lớp 12</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-black text-slate-500 mb-1">Độ khó</label>
            <select
              value={selectedDifficulty}
              onChange={(e) => { setSelectedDifficulty(e.target.value); setPage(1); }}
              className="w-full bg-white border border-slate-300 rounded-xl px-2.5 py-2 text-xs focus:outline-none focus:border-indigo-500"
            >
              <option value="">Tất cả độ khó</option>
              <option value="easy">Nhận biết (Easy)</option>
              <option value="medium">Thông hiểu (Medium)</option>
              <option value="hard">Vận dụng (Hard)</option>
              <option value="expert">Vận dụng cao (Expert)</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-black text-slate-500 mb-1">Dạng câu hỏi</label>
            <select
              value={selectedType}
              onChange={(e) => { setSelectedType(e.target.value); setPage(1); }}
              className="w-full bg-white border border-slate-300 rounded-xl px-2.5 py-2 text-xs focus:outline-none focus:border-indigo-500"
            >
              <option value="">Tất cả dạng câu</option>
              <option value="single_choice">Trắc nghiệm một đáp án</option>
              <option value="multiple_choice">Trắc nghiệm nhiều đáp án</option>
              <option value="fill_blank">Điền khuyết</option>
              <option value="short_answer">Trả lời ngắn</option>
              <option value="essay">Tự luận</option>
              <option value="image_upload">Tải ảnh</option>
              <option value="file_upload">Tải tệp</option>
            </select>
          </div>
        </div>

        {(searchText || appliedSearch || selectedSubject || selectedGrade || selectedDifficulty || selectedType) && (
          <div className="mt-3 pt-2 border-t border-slate-200 flex justify-end">
            <button
              onClick={handleResetFilters}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-bold underline"
            >
              Xóa bộ lọc
            </button>
          </div>
        )}
      </div>

      {/* ERROR STATE */}
      {error && (
        <div className="bg-rose-50 border-2 border-rose-200 rounded-2xl p-4 mb-6 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="text-xs sm:text-sm font-black text-rose-800">Đã xảy ra lỗi khi tải dữ liệu</h4>
            <p className="text-xs text-rose-600 font-medium mt-0.5">{error}</p>
            <button
              onClick={() => fetchQuestions()}
              className="mt-2 px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white text-xs font-black rounded-lg transition-colors"
            >
              Thử lại
            </button>
          </div>
        </div>
      )}

      {/* LOADING STATE */}
      {loading ? (
        <div className="py-16 text-center">
          <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mx-auto mb-3" />
          <p className="text-sm font-black text-slate-700">Đang tải danh sách câu hỏi...</p>
          <p className="text-xs text-slate-400 mt-1">Đang đồng bộ dữ liệu từ ngân hàng câu hỏi đám mây</p>
        </div>
      ) : questions.length === 0 ? (
        /* EMPTY STATE */
        <div className="py-16 text-center bg-slate-50/50 rounded-2xl border-2 border-dashed border-slate-200">
          <BookOpen className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h4 className="text-base font-black text-slate-700 mb-1">Ngân hàng câu hỏi hiện chưa có dữ liệu.</h4>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Chưa có câu hỏi nào phù hợp với bộ lọc hiện tại hoặc kho câu hỏi đang được cập nhật.
          </p>
        </div>
      ) : (
        /* QUESTION LIST TABLE */
        <div>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 mb-4">
            <table className="w-full text-left text-xs font-semibold">
              <thead className="bg-slate-100/80 text-slate-700 font-black uppercase text-[10px] tracking-wider border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Tiêu đề câu hỏi</th>
                  <th className="py-3 px-3">Môn học</th>
                  <th className="py-3 px-3">Khối lớp</th>
                  <th className="py-3 px-3">Dạng câu</th>
                  <th className="py-3 px-3">Độ khó</th>
                  <th className="py-3 px-3">Phạm vi</th>
                  <th className="py-3 px-3 text-center">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {questions.map((item, idx) => {
                  const diffInfo = DIFFICULTY_LABELS[item.difficulty] || { label: item.difficulty || 'Chưa phân loại', color: 'bg-slate-100 text-slate-600 border-slate-200' };
                  const typeLabel = TYPE_LABELS[item.question_type] || item.question_type || 'Trắc nghiệm';
                  const visInfo = VISIBILITY_LABELS[item.visibility] || { label: item.visibility || 'Cá nhân', color: 'text-slate-500 bg-slate-100' };
                  const VisIcon = visInfo.icon || Lock;

                  return (
                    <tr key={item.id || item.item_id || idx} className="hover:bg-amber-50/40 transition-colors">
                      <td className="py-3 px-4 max-w-xs sm:max-w-md">
                        <div className="font-bold text-slate-900 line-clamp-2">
                          {item.title || item.prompt || '(Không có tiêu đề)'}
                        </div>
                        {item.id && (
                          <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                            ID: {item.id.slice(0, 8)}...
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className="font-bold text-slate-700">{item.subject || 'Chung'}</span>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        {item.grade_level ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md font-bold text-[11px] bg-slate-100 text-slate-700">
                            Lớp {item.grade_level}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className="text-slate-600 text-[11px]">{typeLabel}</span>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md font-bold text-[10px] border ${diffInfo.color}`}>
                          {diffInfo.label}
                        </span>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-bold text-[10px] ${visInfo.color}`}>
                          <VisIcon className="w-3 h-3" />
                          {visInfo.label}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-center whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {item.status === 'published' ? 'Đã duyệt' : item.status || 'Khả dụng'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* PHÂN TRANG */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 text-xs font-bold text-slate-600">
            <div className="flex items-center gap-2">
              <span>Hiển thị</span>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                className="bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs focus:outline-none"
              >
                <option value="5">5</option>
                <option value="10">10</option>
                <option value="20">20</option>
                <option value="50">50</option>
              </select>
              <span>trên tổng số <strong className="text-slate-900">{totalCount}</strong> câu hỏi</span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-3 py-1 bg-slate-100 rounded-lg text-slate-800">
                Trang {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QuestionBankListTab;
