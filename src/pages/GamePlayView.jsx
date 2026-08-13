import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Sparkles, Trophy, Gamepad2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { MemoryGame } from '../components/games/MemoryGame';
import { QuizRaceGame } from '../components/games/QuizRaceGame';
import { IframeGamePlayer } from '../components/games/IframeGamePlayer';
import { BadgeModal } from '../components/common/BadgeModal';
import { LoadingSkeleton } from '../components/common/LoadingSkeleton';
import { useSound } from '../context/SoundContext';

export const GamePlayView = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile, awardStars } = useAuth();
  const { triggerSound } = useSound();

  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isBadgeModalOpen, setIsBadgeModalOpen] = useState(false);
  const [earnedStars, setEarnedStars] = useState(0);

  useEffect(() => {
    fetchGame();
  }, [id]);

  const fetchGame = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('games')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !data) {
        // Fallback cho game mẫu nếu chưa gõ ID từ DB
        setGame({
          id,
          title: 'Thử Thách Trò Chơi Học Vui',
          description: 'Rèn luyện tư duy toán học và từ vựng sinh động.',
          game_type: id === '22222222-2222-2222-2222-222222222222' ? 'builtin' : 'builtin',
          game_url: id === '22222222-2222-2222-2222-222222222222' ? 'quiz-race' : 'memory-game',
          grade_level: 1,
          subject: 'Toán'
        });
      } else {
        setGame(data);
        // Tăng lượt chơi
        await supabase
          .from('games')
          .update({ play_count: (data.play_count || 0) + 1 })
          .eq('id', id);
      }
    } catch (err) {
      console.error('Fetch game error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Xử lý khi bé hoàn thành trò chơi
  const handleGameComplete = async (score = 100, timeSec = 60, assignmentId = null) => {
    triggerSound('victory');

    if (profile?.id && game?.id) {
      try {
        // 1. Thực thi RPC complete_game_and_award an toàn tuyệt đối ở Server-side
        const { data: rpcRes, error: rpcErr } = await supabase.rpc('complete_game_and_award', {
          p_game_id: game.id,
          p_assignment_id: assignmentId,
          p_score: score,
          p_completion_time_seconds: timeSec
        });

        if (!rpcErr && rpcRes && rpcRes.success) {
          setEarnedStars(rpcRes.stars_earned || 10);
          refreshProfile();
        } else {
          // Fallback nếu RPC chưa được tạo
          await awardStars(10, 5);
          await supabase.from('student_progress').insert({
            game_id: game.id,
            student_id: profile.id,
            status: 'completed',
            score: score,
            stars_earned: 10,
            completion_time_seconds: timeSec
          });
          refreshProfile();
        }
      } catch (err) {
        console.error('Save progress error:', err);
      }
    }

    setIsBadgeModalOpen(true);
  };

  if (loading) {
    return <LoadingSkeleton type="page" />;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      
      {/* NAVIGATION TOP BAR */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => { triggerSound('click'); navigate(-1); }}
          className="px-4 py-2 bg-white hover:bg-amber-50 text-amber-900 font-extrabold text-xs rounded-2xl border-2 border-amber-300 shadow-sm flex items-center gap-1.5 transition-all"
        >
          <ArrowLeft className="w-4 h-4" /> Quay Lại Kho Game
        </button>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1 bg-amber-400 text-amber-950 font-black text-xs rounded-xl border border-amber-500">
            Khối {game?.grade_level || 1}
          </span>
          <span className="px-3 py-1 bg-sky-100 text-sky-900 font-black text-xs rounded-xl border border-sky-300">
            Môn {game?.subject || 'Học Tập'}
          </span>
        </div>
      </div>

      {/* GAME TITLE HEADER */}
      <div className="text-center mb-6">
        <h1 className="text-2xl sm:text-3xl font-black text-amber-950 flex items-center justify-center gap-2">
          <Gamepad2 className="w-7 h-7 text-amber-500" /> {game?.title}
        </h1>
        <p className="text-xs font-bold text-slate-500 max-w-lg mx-auto mt-1">
          {game?.description}
        </p>
      </div>

      {/* COMPONENT GAME VỚI PHÂN CHOẠN THEO GAME_TYPE & GAME_URL */}
      <div className="flex justify-center mb-10">
        {game?.game_type === 'builtin' ? (
          game?.game_url === 'quiz-race' ? (
            <QuizRaceGame onComplete={handleGameComplete} />
          ) : (
            <MemoryGame onComplete={handleGameComplete} />
          )
        ) : (
          <IframeGamePlayer game={game} onComplete={handleGameComplete} />
        )}
      </div>

      {/* MODAL MỜI NHẬN HUY HIỆU */}
      <BadgeModal
        isOpen={isBadgeModalOpen}
        onClose={() => setIsBadgeModalOpen(false)}
        starsEarned={earnedStars}
      />

    </div>
  );
};
