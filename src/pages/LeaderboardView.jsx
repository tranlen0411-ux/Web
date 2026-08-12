import React, { useState, useEffect } from 'react';
import { Trophy, Medal, Star, Sparkles, Award } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LoadingSkeleton } from '../components/common/LoadingSkeleton';
import { useSound } from '../context/SoundContext';

export const LeaderboardView = () => {
  const { triggerSound } = useSound();
  const [gradeFilter, setGradeFilter] = useState('ALL');
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLeaderboard();
  }, [gradeFilter]);

  const fetchLeaderboard = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('profiles')
        .select('*')
        .eq('role', 'student')
        .order('total_stars', { ascending: false })
        .limit(20);

      if (gradeFilter !== 'ALL') {
        query = query.eq('grade_level', parseInt(gradeFilter));
      }

      const { data } = await query;
      setStudents(data || []);
    } catch (err) {
      console.error('Fetch leaderboard error:', err);
    } finally {
      setLoading(false);
    }
  };

  const getRankBadge = (rank) => {
    switch (rank) {
      case 0:
        return <span className="text-3xl">🥇</span>;
      case 1:
        return <span className="text-3xl">🥈</span>;
      case 2:
        return <span className="text-3xl">🥉</span>;
      default:
        return (
          <span className="w-8 h-8 rounded-full bg-amber-100 border-2 border-amber-300 flex items-center justify-center font-black text-amber-900 text-sm">
            {rank + 1}
          </span>
        );
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      
      {/* HEADER BẢNG XẾP HẠNG */}
      <div className="bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 rounded-3xl border-4 border-amber-600 p-6 sm:p-8 text-center text-amber-950 shadow-xl mb-8">
        <Trophy className="w-16 h-16 text-amber-900 mx-auto mb-2 animate-bounce" />
        <h1 className="text-3xl font-black">BẢNG XẾP HẠNG VUI HỌC TIỂU HỌC</h1>
        <p className="text-xs sm:text-sm font-bold text-amber-900 mt-1 max-w-md mx-auto">
          Tuyên dương các bé học sinh có tổng số Sao Thưởng 🌟 và Xu Tích Lũy 🪙 cao nhất toàn trường!
        </p>

        {/* LỌC KHỐI LỚP */}
        <div className="mt-6 flex justify-center gap-1.5 flex-wrap">
          {['ALL', 1, 2, 3, 4, 5].map((g) => (
            <button
              key={g}
              onClick={() => { setGradeFilter(g); triggerSound('click'); }}
              className={`px-4 py-2 rounded-2xl font-black text-xs transition-all ${
                gradeFilter == g
                  ? 'bg-amber-950 text-amber-300 border-2 border-amber-900 shadow-md'
                  : 'bg-white/80 text-amber-900 hover:bg-white border border-amber-300'
              }`}
            >
              {g === 'ALL' ? 'Toàn Trường' : `Khối Lớp ${g}`}
            </button>
          ))}
        </div>
      </div>

      {/* DANH SÁCH TOP HỌC SINH */}
      {loading ? (
        <LoadingSkeleton type="page" />
      ) : students.length > 0 ? (
        <div className="space-y-3">
          {students.map((st, idx) => (
            <div
              key={st.id || idx}
              className={`p-4 rounded-3xl border-4 transition-all flex items-center justify-between shadow-sm ${
                idx === 0
                  ? 'bg-gradient-to-r from-amber-100 to-yellow-100 border-amber-400 shadow-md scale-[1.02]'
                  : idx === 1
                  ? 'bg-gradient-to-r from-slate-100 to-slate-200 border-slate-300'
                  : idx === 2
                  ? 'bg-gradient-to-r from-orange-100 to-amber-100 border-orange-300'
                  : 'bg-white border-amber-100 hover:border-amber-300'
              }`}
            >
              {/* XẾP HẠNG & AVATAR */}
              <div className="flex items-center gap-4">
                <div className="w-10 text-center font-black">
                  {getRankBadge(idx)}
                </div>

                <img
                  src={st.avatar_url || 'https://api.dicebear.com/7.x/bottts/svg?seed=Pikachu'}
                  alt=""
                  className="w-12 h-12 rounded-2xl border-2 border-amber-300 bg-white"
                />

                <div>
                  <h4 className="text-base font-black text-slate-800">{st.full_name || 'Học Sinh'}</h4>
                  <span className="inline-block px-2 py-0.5 bg-amber-200 text-amber-900 font-extrabold text-[10px] rounded-lg">
                    Lớp {st.grade_level || 1}
                  </span>
                </div>
              </div>

              {/* TỔNG SAO VÀ XU */}
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-base font-black text-amber-600 flex items-center gap-1 justify-end">
                    <Star className="w-4 h-4 fill-amber-400" /> {st.total_stars || 0} 🌟
                  </p>
                  <p className="text-xs font-bold text-slate-500">{st.total_coins || 0} 🪙 Xu</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 bg-white rounded-3xl border-4 border-amber-200">
          <Award className="w-12 h-12 text-amber-400 mx-auto mb-2" />
          <h3 className="text-lg font-black text-amber-900">Chưa có bảng xếp hạng</h3>
          <p className="text-xs font-bold text-slate-500">Hãy là người đầu tiên chơi game để leo top nhé!</p>
        </div>
      )}

    </div>
  );
};
