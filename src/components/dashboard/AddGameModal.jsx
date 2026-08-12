import React, { useState } from 'react';
import { X, Plus, Gamepad2, Link as LinkIcon, Image, BookOpen } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';

export const AddGameModal = ({ isOpen, onClose, onAdded }) => {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [gameType, setGameType] = useState('iframe');
  const [gameUrl, setGameUrl] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [gradeLevel, setGradeLevel] = useState(1);
  const [subject, setSubject] = useState('Toán');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title || !gameUrl) return;

    setLoading(true);
    try {
      const { data, error } = await supabase.from('games').insert({
        title,
        description,
        game_type: gameType,
        game_url: gameUrl,
        thumbnail_url: thumbnailUrl || 'https://images.unsplash.com/photo-1606326608606-aa0b62935f2b?w=500&auto=format&fit=crop&q=60',
        grade_level: parseInt(gradeLevel),
        subject,
        author_id: user?.id,
        is_public: true
      }).select().single();

      if (error) throw error;

      if (onAdded) onAdded(data);
      onClose();
    } catch (err) {
      console.error('Add game error:', err);
      alert('Không thể thêm trò chơi: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-lg bg-white rounded-3xl border-4 border-amber-300 p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 bg-slate-100 rounded-full hover:bg-slate-200 text-slate-500"
        >
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-xl font-black text-amber-900 mb-1 flex items-center gap-2">
          <Gamepad2 className="w-6 h-6 text-amber-600" /> Thêm Trò Chơi Mới Vào Kho
        </h3>
        <p className="text-xs font-bold text-slate-500 mb-4">
          Nhúng link iFrame (Wordwall, Quizizz, Kahoot...) hoặc đường dẫn Game HTML5.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-black text-slate-700 mb-1">Tên Trò Chơi:</label>
            <input
              type="text"
              placeholder="Ví dụ: Ô Chữ Tiếng Anh Lớp 3"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full p-3 bg-amber-50 border-2 border-amber-200 rounded-2xl font-bold text-sm text-slate-800"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-black text-slate-700 mb-1">Loại Game:</label>
            <select
              value={gameType}
              onChange={(e) => setGameType(e.target.value)}
              className="w-full p-3 bg-amber-50 border-2 border-amber-200 rounded-2xl font-bold text-sm text-slate-800"
            >
              <option value="iframe">iFrame Embed (Wordwall, Quizizz, Kahoot...)</option>
              <option value="builtin">Built-in React Game (Memory Match / Quiz Race)</option>
              <option value="html5_zip">HTML5 Package URL</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-black text-slate-700 mb-1 flex items-center gap-1">
              <LinkIcon className="w-3.5 h-3.5" /> Đường Dẫn Embed / URL Game:
            </label>
            <input
              type="url"
              placeholder="https://wordwall.net/embed/..."
              value={gameUrl}
              onChange={(e) => setGameUrl(e.target.value)}
              className="w-full p-3 bg-amber-50 border-2 border-amber-200 rounded-2xl font-bold text-sm text-slate-800"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-black text-slate-700 mb-1">Khối Lớp:</label>
              <select
                value={gradeLevel}
                onChange={(e) => setGradeLevel(e.target.value)}
                className="w-full p-3 bg-amber-50 border-2 border-amber-200 rounded-2xl font-bold text-sm text-slate-800"
              >
                <option value="1">Khối 1</option>
                <option value="2">Khối 2</option>
                <option value="3">Khối 3</option>
                <option value="4">Khối 4</option>
                <option value="5">Khối 5</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-black text-slate-700 mb-1">Môn Học:</label>
              <select
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full p-3 bg-amber-50 border-2 border-amber-200 rounded-2xl font-bold text-sm text-slate-800"
              >
                <option value="Toán">Toán</option>
                <option value="Tiếng Việt">Tiếng Việt</option>
                <option value="Tiếng Anh">Tiếng Anh</option>
                <option value="Tự nhiên & Xã hội">Tự nhiên & Xã hội</option>
                <option value="Lịch sử & Địa lý">Lịch sử & Địa lý</option>
                <option value="Tin học">Tin học</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-black text-slate-700 mb-1 flex items-center gap-1">
              <Image className="w-3.5 h-3.5" /> URL Ảnh Bìa Thumbnail (Tùy chọn):
            </label>
            <input
              type="url"
              placeholder="https://..."
              value={thumbnailUrl}
              onChange={(e) => setThumbnailUrl(e.target.value)}
              className="w-full p-3 bg-amber-50 border-2 border-amber-200 rounded-2xl font-bold text-sm text-slate-800"
            />
          </div>

          <div>
            <label className="block text-xs font-black text-slate-700 mb-1">Mô Tả Trò Chơi:</label>
            <textarea
              rows="2"
              placeholder="Mô tả ngắn gọn trò chơi..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-3 bg-amber-50 border-2 border-amber-200 rounded-2xl font-bold text-sm text-slate-800"
            ></textarea>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-black text-sm rounded-2xl border-b-4 border-emerald-700 shadow-md flex items-center justify-center gap-2"
          >
            <Plus className="w-5 h-5" /> {loading ? 'Đang Đăng Game...' : 'ĐĂNG GAME LÊN KHO'}
          </button>
        </form>

      </div>
    </div>
  );
};
