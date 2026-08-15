import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Gamepad2, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { MemoryGame } from '../components/games/MemoryGame';
import { QuizRaceGame } from '../components/games/QuizRaceGame';
import { Grade12GamePlayer } from '../components/games/Grade12GamePlayer';
import { IframeGamePlayer } from '../components/games/IframeGamePlayer';
import { BadgeModal } from '../components/common/BadgeModal';
import { LoadingSkeleton } from '../components/common/LoadingSkeleton';
import { useSound } from '../context/SoundContext';
import { LEARNING_GAMES_DATA } from '../data/learningGamesData';

// Regex kiểm tra định dạng UUID v4 chính thức
const IS_UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const GamePlayView = () => {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const assignmentIdFromUrl = searchParams.get('assignment_id');

  const navigate = useNavigate();
  const { profile, refreshProfile } = useAuth();
  const { triggerSound } = useSound();

  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [isBadgeModalOpen, setIsBadgeModalOpen] = useState(false);
  const [earnedStars, setEarnedStars] = useState(0);

  useEffect(() => {
    fetchGame();
  }, [id]);

  const fetchGame = async () => {
    setLoading(true);
    setNotFound(false);

    try {
      let query = supabase.from('games').select('*');

      if (IS_UUID_REGEX.test(id)) {
        // 1. URL chứa UUID -> Lấy theo ID chính thức
        query = query.eq('id', id);
      } else {
        // 2. URL chứa slug -> Lấy theo game_url trong CSDL để lấy UUID thật
        query = query.eq('game_url', id);
      }

      const { data, error } = await query.single();

      // CHỈ MỞ GAME KHI SUPABASE TRẢ VỀ BẢN GHI THẬT CÓ GAME.ID LÀ UUID HỢP LỆ
      if (error || !data || !data.id || !IS_UUID_REGEX.test(data.id)) {
        // HOÀN TOÀN XÓA ĐOẠN SETGAME WITH ID: NULL FALLBACK
        // Không tạo game tạm, không đặt id: null, không cho chơi game chưa seed
        setGame(null);
        setNotFound(true);
      } else {
        setGame(data);
      }
    } catch (err) {
      console.error('Fetch game error:', err);
      setGame(null);
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  };

  // Xử lý khi hoàn thành trò chơi - CHỈ GỌI RPC KHI CÓ UUID HỢP LỆ
  const handleGameComplete = async (score = 100, timeSec = 60, paramAssignmentId = null) => {
    const targetAssignmentId = paramAssignmentId || assignmentIdFromUrl || null;

    // 1. Kiểm tra nếu là Admin hoặc Giáo viên xem thử (is_admin_preview)
    const isPreviewMode = profile?.role === 'admin' || profile?.role === 'teacher';
    if (isPreviewMode) {
      return {
        success: true,
        is_preview: true,
        message: 'Chế độ xem thử – không tích điểm',
        stars_earned: 0,
        coins_earned: 0
      };
    }

    if (!profile?.id) {
      return {
        success: false,
        message: 'Vui lòng đăng nhập tài khoản học sinh để lưu kết quả bài làm.'
      };
    }

    // Kiểm tra bắt buộc phải có UUID hợp lệ trong CSDL trước khi gọi RPC
    if (!game?.id || !IS_UUID_REGEX.test(game.id)) {
      return {
        success: false,
        message: 'Trò chơi chưa có mã UUID hợp lệ trong hệ thống. Thầy/Cô hãy nạp file SQL seed trò chơi nhé!'
      };
    }

    try {
      // 2. GỌI RPC SERVER-SIDE AN TOÀN `complete_game_and_award` VỚI UUID THẬT
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('complete_game_and_award', {
        p_game_id: game.id, // Luôn là UUID hợp lệ
        p_assignment_id: targetAssignmentId,
        p_score: score,
        p_completion_time_seconds: timeSec
      });

      if (rpcErr) {
        console.error('RPC complete_game_and_award error:', rpcErr);
        return {
          success: false,
          message: rpcErr.message || 'Lỗi mạng hoặc không thể kết nối máy chủ để lưu kết quả.'
        };
      }

      if (!rpcRes) {
        return {
          success: false,
          message: 'Không nhận được phản hồi xác nhận từ máy chủ.'
        };
      }

      // Đã hoàn thành trước đó
      if (rpcRes.already_completed) {
        return {
          success: true,
          already_completed: true,
          message: 'Bài giao này đã được hoàn thành trước đó.',
          stars_earned: 0,
          coins_earned: 0
        };
      }

      // Lưu thành công
      if (rpcRes.success) {
        const stars = rpcRes.stars_earned || 0;
        setEarnedStars(stars);
        
        if (refreshProfile) {
          try {
            await refreshProfile();
          } catch (e) {
            console.error('Refresh profile error:', e);
          }
        }

        // CHỈ MỜ BADGEMODAL KHI LƯU THÀNH CÔNG VÀ KHÔNG PHẢI XEM THỬ
        setIsBadgeModalOpen(true);

        return {
          success: true,
          stars_earned: stars,
          coins_earned: rpcRes.coins_earned || 0
        };
      } else {
        return {
          success: false,
          message: rpcRes.message || 'Lưu kết quả bài làm không thành công.'
        };
      }

    } catch (err) {
      console.error('Save progress unexpected exception:', err);
      return {
        success: false,
        message: err.message || 'Đã xảy ra lỗi không xác định khi lưu kết quả.'
      };
    }
  };

  if (loading) {
    return <LoadingSkeleton type="page" />;
  }

  if (notFound || !game || !game.id || !IS_UUID_REGEX.test(game.id)) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <div className="bg-white p-8 rounded-3xl border-4 border-amber-300 shadow-xl">
          <AlertCircle className="w-16 h-16 text-amber-500 mx-auto mb-4" />
          <h2 className="text-2xl font-black text-slate-800 mb-2">Không Tìm Thấy Trò Chơi</h2>
          <p className="text-xs font-bold text-slate-500 mb-6">
            Trò chơi Thầy/Cô hoặc bé chọn không tồn tại hoặc chưa được nạp mã UUID trong CSDL.
          </p>
          <button
            onClick={() => navigate('/student')}
            className="px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white font-black text-xs rounded-2xl border-b-4 border-amber-700 shadow-md inline-flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" /> Quay Lại Kho Trò Chơi
          </button>
        </div>
      </div>
    );
  }

  const isGrade12BuiltinGame = (game?.game_type === 'builtin' && LEARNING_GAMES_DATA[game?.game_url]);

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
        {isGrade12BuiltinGame ? (
          <Grade12GamePlayer 
            gameKey={game.game_url} 
            onComplete={handleGameComplete}
            assignmentId={assignmentIdFromUrl}
          />
        ) : game?.game_type === 'builtin' ? (
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
