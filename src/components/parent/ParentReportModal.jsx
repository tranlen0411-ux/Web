import React, { useState } from 'react';
import { X, Search, Trophy, Star, Award, BookOpen, Clock, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useSound } from '../../context/SoundContext';

export const ParentReportModal = ({ isOpen, onClose }) => {
  const { triggerSound } = useSound();
  const [accessCode, setAccessCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [reportData, setReportData] = useState(null);

  const handleLookup = async (e) => {
    e?.preventDefault();
    if (!accessCode.trim()) return;

    setErrorMsg('');
    setLoading(true);
    triggerSound('click');
    setReportData(null);

    const cleanCode = accessCode.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

    try {
      // 1. Tìm thông tin học sinh theo mã hoặc email
      const { data: profiles, error: profileErr } = await supabase
        .from('profiles')
        .select('*')
        .or(`email.ilike.%${cleanCode}%,full_name.ilike.%${cleanCode}%`)
        .eq('role', 'student')
        .limit(1);

      if (profileErr) throw profileErr;

      let studentProfile = profiles && profiles.length > 0 ? profiles[0] : null;

      // Tìm qua mã mẫu nếu tìm theo từ khóa
      if (!studentProfile) {
        const sampleEmails = {
          'hs101': 'hs_nam@hoclapvui.edu.vn',
          'hs202': 'hs_an@hoclapvui.edu.vn',
          'hs303': 'hs_duc@hoclapvui.edu.vn',
          'hs404': 'hs_bao@hoclapvui.edu.vn',
          'hs505': 'hs_mai@hoclapvui.edu.vn',
        };
        const mappedEmail = sampleEmails[cleanCode];

        if (mappedEmail) {
          const { data: mappedProfiles } = await supabase
            .from('profiles')
            .select('*')
            .eq('email', mappedEmail)
            .single();
          studentProfile = mappedProfiles;
        }
      }

      if (!studentProfile) {
        setErrorMsg('Không tìm thấy học sinh với Mã/PIN này. Thử lại với mã: HS101, HS202, HS303!');
        setLoading(false);
        return;
      }

      // 2. Lấy lịch sử tiến độ học tập
      const { data: progress } = await supabase
        .from('student_progress')
        .select('*, games(title, subject, grade_level)')
        .eq('student_id', studentProfile.id)
        .order('completed_at', { ascending: false })
        .limit(10);

      // 3. Lấy danh sách huy hiệu
      const { data: badges } = await supabase
        .from('student_badges')
        .select('*, badges(title, icon_url, description)')
        .eq('student_id', studentProfile.id);

      triggerSound('victory');
      setReportData({
        profile: studentProfile,
        progress: progress || [],
        badges: badges || []
      });

    } catch (err) {
      console.error('Parent lookup error:', err);
      setErrorMsg('Không thể tra cứu báo cáo học tập. Vui lòng thử lại sau.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-2xl bg-white rounded-3xl border-4 border-amber-300 p-6 sm:p-8 shadow-2xl max-h-[90vh] overflow-y-auto">
        
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 bg-slate-100 rounded-full hover:bg-slate-200 text-slate-500"
        >
          <X className="w-5 h-5" />
        </button>

        {/* TIÊU ĐỀ TRA CỨU PHỤ HUYNH */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-amber-400 rounded-2xl border-2 border-amber-500 flex items-center justify-center text-amber-950 font-black text-xl shadow-md">
            👨‍👩‍👧
          </div>
          <div>
            <h3 className="text-xl font-black text-amber-950">MÃ TRUY CẬP PHỤ HUYNH (AUTH-04)</h3>
            <p className="text-xs font-bold text-slate-500">
              Tra cứu báo cáo kết quả học tập của con mà không cần tạo tài khoản!
            </p>
          </div>
        </div>

        {/* FORM NHẬP MÃ BẢO MẬT PHỤ HUYNH */}
        <form onSubmit={handleLookup} className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Nhập Mã Học Sinh (Ví dụ: HS101, HS202, HS303...)"
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value)}
              className="w-full p-3.5 pl-11 bg-amber-50 border-2 border-amber-300 rounded-2xl font-black text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-amber-500"
              required
            />
            <Search className="w-5 h-5 text-amber-600 absolute left-3.5 top-3.5" />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="px-6 py-3.5 bg-amber-500 hover:bg-amber-600 text-white font-black text-sm rounded-2xl border-b-4 border-amber-700 shadow-md active:translate-y-0.5 whitespace-nowrap"
          >
            {loading ? 'Đang Tra Cứu...' : '🔍 TRA CỨU BÁO CÁO'}
          </button>
        </form>

        {errorMsg && (
          <div className="p-3 bg-rose-100 border-2 border-rose-300 text-rose-800 text-xs font-bold rounded-xl mb-4 text-center">
            ⚠️ {errorMsg}
          </div>
        )}

        {/* THÔNG TIN BÁO CÁO PHỤ HUYNH */}
        {reportData && (
          <div className="space-y-6 animate-fadeIn border-t-2 border-slate-100 pt-6">
            
            {/* THẺ TỔNG QUAN HỌC SINH */}
            <div className="bg-gradient-to-r from-amber-100 via-sky-100 to-emerald-100 p-5 rounded-3xl border-2 border-amber-200 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <img
                  src={reportData.profile.avatar_url}
                  alt="Avatar"
                  className="w-16 h-16 rounded-2xl border-4 border-white bg-white shadow-md"
                />
                <div>
                  <h4 className="text-lg font-black text-amber-950 flex items-center gap-2">
                    {reportData.profile.full_name}
                    <span className="px-2.5 py-0.5 bg-sky-500 text-white text-[10px] font-black rounded-full uppercase">
                      Khối {reportData.profile.grade_level || 1}
                    </span>
                  </h4>
                  <p className="text-xs font-bold text-slate-600 mt-0.5">
                    Học sinh chăm chỉ tiểu học
                  </p>
                </div>
              </div>

              <div className="flex gap-4 bg-white/80 backdrop-blur-sm p-3 rounded-2xl border border-amber-200 text-center">
                <div>
                  <span className="text-xs text-slate-500 font-bold block">Tổng Sao</span>
                  <span className="text-lg font-black text-amber-600 flex items-center justify-center gap-1">
                    <Star className="w-5 h-5 fill-amber-400" /> {reportData.profile.total_stars || 0}
                  </span>
                </div>
                <div className="w-px bg-slate-200" />
                <div>
                  <span className="text-xs text-slate-500 font-bold block">Số Huy Hiệu</span>
                  <span className="text-lg font-black text-emerald-600 flex items-center justify-center gap-1">
                    <Award className="w-5 h-5 text-emerald-500" /> {reportData.badges.length}
                  </span>
                </div>
              </div>
            </div>

            {/* HUY HIỆU ĐẠT ĐƯỢC */}
            <div>
              <h5 className="text-sm font-black text-slate-800 mb-3 flex items-center gap-2">
                <Trophy className="w-4 h-4 text-amber-500" /> Huy Hiệu Đã Mở Khóa ({reportData.badges.length})
              </h5>
              {reportData.badges.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {reportData.badges.map((b, idx) => (
                    <div key={idx} className="p-3 bg-amber-50 border-2 border-amber-200 rounded-2xl flex items-center gap-2">
                      <span className="text-2xl">{b.badges?.icon_url || '🏅'}</span>
                      <div>
                        <p className="text-xs font-black text-amber-900 leading-tight">{b.badges?.title}</p>
                        <p className="text-[10px] font-bold text-amber-700">{b.badges?.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs font-bold text-slate-400 italic bg-slate-50 p-3 rounded-2xl text-center">
                  Bé chưa mở khóa huy hiệu nào. Hãy khuyến khích bé tích lũy thêm Sao nhé!
                </p>
              )}
            </div>

            {/* LỊCH SỬ HOÀN THÀNH BÀI HỌC */}
            <div>
              <h5 className="text-sm font-black text-slate-800 mb-3 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-sky-500" /> Lịch Sử Chơi Game Học Tập Gần Đây
              </h5>
              {reportData.progress.length > 0 ? (
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {reportData.progress.map((p, idx) => (
                    <div key={idx} className="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between">
                      <div>
                        <p className="text-xs font-black text-slate-800">
                          {p.games?.title || 'Trò chơi học tập'}
                        </p>
                        <p className="text-[11px] font-bold text-slate-500">
                          Môn: {p.games?.subject || 'Tổng hợp'} • Điểm: <strong className="text-emerald-600">{p.score}</strong>
                        </p>
                      </div>

                      <div className="text-right">
                        <span className="px-2.5 py-1 bg-amber-100 text-amber-900 text-xs font-black rounded-xl inline-flex items-center gap-1">
                          + {p.stars_earned} 🌟
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs font-bold text-slate-400 italic bg-slate-50 p-3 rounded-2xl text-center">
                  Chưa có lịch sử làm bài gần đây.
                </p>
              )}
            </div>

          </div>
        )}

      </div>
    </div>
  );
};
