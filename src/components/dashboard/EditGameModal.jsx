import React, { useState, useEffect } from 'react';
import { X, Edit2, Gamepad2, Link as LinkIcon, Image as ImageIcon, Upload, Loader2, AlertCircle, Eye } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useSound } from '../../context/SoundContext';

export const EditGameModal = ({ isOpen, onClose, gameToEdit, onSaved }) => {
  const { user } = useAuth();
  const { triggerSound } = useSound();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [gameType, setGameType] = useState('iframe');
  const [gameUrl, setGameUrl] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [gradeLevel, setGradeLevel] = useState(1);
  const [subject, setSubject] = useState('Toán');
  const [isPublic, setIsPublic] = useState(true);

  // Xử lý ảnh: 'url' (Nhập link https) hoặc 'file' (Tải ảnh từ máy)
  const [imageMode, setImageMode] = useState('url');
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [imageError, setImageError] = useState(false);

  const subjects = [
    'Toán',
    'Tiếng Việt',
    'Tiếng Anh',
    'Tự nhiên & Xã hội',
    'Khoa học',
    'Lịch sử & Địa lý',
    'Tin học',
    'Đạo đức',
    'Âm nhạc',
    'Mỹ thuật',
    'Hoạt động trải nghiệm'
  ];

  useEffect(() => {
    if (gameToEdit) {
      setTitle(gameToEdit.title || '');
      setDescription(gameToEdit.description || '');
      setGameType(gameToEdit.game_type || 'iframe');
      setGameUrl(gameToEdit.game_url || '');
      setThumbnailUrl(gameToEdit.thumbnail_url || '');
      setPreviewUrl(gameToEdit.thumbnail_url || '');
      setGradeLevel(gameToEdit.grade_level || 1);
      setSubject(gameToEdit.subject || 'Toán');
      setIsPublic(gameToEdit.is_public !== false);
      
      setImageMode('url');
      setSelectedFile(null);
      setErrorMsg('');
      setImageError(false);
    }
  }, [gameToEdit, isOpen]);

  // Xử lý chọn tệp tin từ máy tính
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    setErrorMsg('');
    setImageError(false);

    if (!file) return;

    // 1. Kiểm tra định dạng đuôi file & MIME type (Cấm tuyệt đối SVG)
    const validMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    const lowerName = file.name.toLowerCase();

    if (lowerName.endsWith('.svg') || file.type === 'image/svg+xml' || !validMimes.includes(file.type)) {
      setErrorMsg('Định dạng ảnh không hỗ trợ. Chỉ chấp nhận các tệp JPG, JPEG, PNG, WebP.');
      setSelectedFile(null);
      return;
    }

    // 2. Kiểm tra dung lượng tối đa 5MB
    if (file.size > 5 * 1024 * 1024) {
      setErrorMsg('Dung lượng tệp vượt quá 5 MB. Vui lòng chọn tệp nhỏ hơn.');
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
    const localUrl = URL.createObjectURL(file);
    setPreviewUrl(localUrl);
  };

  const handleUrlChange = (val) => {
    setThumbnailUrl(val);
    setPreviewUrl(val);
    setImageError(false);
    setErrorMsg('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');

    if (!title.trim()) {
      setErrorMsg('Tên trò chơi không được để trống.');
      return;
    }

    if (!gameUrl.trim() || !gameUrl.startsWith('https://')) {
      setErrorMsg('URL trò chơi không hợp lệ. Phải bắt đầu bằng https://');
      return;
    }

    if (imageMode === 'url' && thumbnailUrl && !thumbnailUrl.startsWith('https://')) {
      setErrorMsg('URL ảnh đại diện phải bắt đầu bằng https://');
      return;
    }

    setLoading(true);
    let uploadedFilePath = null;
    let finalThumbnailUrl = thumbnailUrl;

    try {
      // 1. UPLOAD ẢNH MỚI LÊN BUCKET game-thumbnails (NẾU CHỌN TỆP TỪ MÁY)
      if (imageMode === 'file' && selectedFile) {
        const fileExt = selectedFile.name.split('.').pop().toLowerCase();
        uploadedFilePath = `${user.id}/${Date.now()}_${crypto.randomUUID().slice(0, 6)}.${fileExt}`;

        const { error: uploadErr } = await supabase.storage
          .from('game-thumbnails')
          .upload(uploadedFilePath, selectedFile, {
            contentType: selectedFile.type,
            upsert: false
          });

        if (uploadErr) {
          throw new Error('Lỗi khi tải ảnh lên Storage: ' + uploadErr.message);
        }

        const { data: publicUrlData } = supabase.storage
          .from('game-thumbnails')
          .getPublicUrl(uploadedFilePath);

        finalThumbnailUrl = publicUrlData.publicUrl;
      }

      // 2. CẬP NHẬT BẢN GHI TRONG CSDL (UPDATE PUBLIC.GAMES KHÔNG ĐỔI ID)
      const { data: updatedGame, error: updateErr } = await supabase
        .from('games')
        .update({
          title: title.trim(),
          description: description.trim(),
          game_type: gameType,
          game_url: gameUrl.trim(),
          thumbnail_url: finalThumbnailUrl || 'https://images.unsplash.com/photo-1606326608606-aa0b62935f2b?w=500&auto=format&fit=crop&q=60',
          grade_level: parseInt(gradeLevel),
          subject,
          is_public: isPublic
        })
        .eq('id', gameToEdit.id)
        .select()
        .single();

      // 3. NẾU DATABASE LỖI -> ROLLBACK XÓA FILE ẢNH MỚI VỪA UPLOAD PENDING
      if (updateErr) {
        if (uploadedFilePath) {
          await supabase.storage.from('game-thumbnails').remove([uploadedFilePath]);
        }
        throw new Error('Lỗi cập nhật CSDL: ' + updateErr.message);
      }

      // 4. DỌN DẸP ẢNH CỦ NẾU CẬP NHẬT DB THÀNH CÔNG VÀ ẢNH CỦ THUỘC BUCKET HỆ THỐNG
      if (uploadedFilePath && gameToEdit.thumbnail_url && gameToEdit.thumbnail_url.includes('/game-thumbnails/')) {
        try {
          const oldPathPart = gameToEdit.thumbnail_url.split('/game-thumbnails/')[1];
          if (oldPathPart) {
            // Kiểm tra xem ảnh cũ có còn trò chơi nào khác dùng chung không
            const { data: existUsage } = await supabase
              .from('games')
              .select('id')
              .eq('thumbnail_url', gameToEdit.thumbnail_url)
              .neq('id', gameToEdit.id);

            if (!existUsage || existUsage.length === 0) {
              await supabase.storage.from('game-thumbnails').remove([decodeURIComponent(oldPathPart)]);
            }
          }
        } catch (cleanupErr) {
          console.warn('Lỗi dọn dẹp ảnh cũ:', cleanupErr);
        }
      }

      triggerSound('victory');
      if (onSaved) onSaved(updatedGame);
      onClose();

    } catch (err) {
      console.error('Edit game error:', err);
      setErrorMsg(err.message || 'Không thể cập nhật trò chơi.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !gameToEdit) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-lg bg-white rounded-3xl border-4 border-amber-300 p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        
        <button
          onClick={onClose}
          disabled={loading}
          className="absolute top-4 right-4 p-2 bg-slate-100 rounded-full hover:bg-slate-200 text-slate-500"
        >
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-xl font-black text-amber-950 mb-1 flex items-center gap-2">
          <Edit2 className="w-5 h-5 text-amber-600" /> Chỉnh Sửa Trò Chơi
        </h3>
        <p className="text-xs font-bold text-slate-500 mb-4">
          Cập nhật thông tin và hình ảnh đại diện trò chơi (ID: <code className="text-amber-800 font-mono">{gameToEdit.id.slice(0, 8)}...</code>).
        </p>

        {errorMsg && (
          <div className="mb-4 p-3 bg-rose-50 border-2 border-rose-200 rounded-2xl text-rose-800 font-bold text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* TÊN TRÒ CHƠI */}
          <div>
            <label className="block text-xs font-black text-slate-700 mb-1">Tên Trò Chơi *:</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full p-3 bg-amber-50/70 border-2 border-amber-200 rounded-2xl font-bold text-sm text-slate-800 focus:outline-none focus:border-amber-400"
              required
            />
          </div>

          {/* MÔ TẢ NẮN */}
          <div>
            <label className="block text-xs font-black text-slate-700 mb-1">Mô Tả Trò Chơi:</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-3 bg-amber-50/70 border-2 border-amber-200 rounded-2xl font-bold text-xs text-slate-800 focus:outline-none focus:border-amber-400"
            />
          </div>

          {/* KHỐI LỚP & MÔN HỌC */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-black text-slate-700 mb-1">Khối Lớp:</label>
              <select
                value={gradeLevel}
                onChange={(e) => setGradeLevel(e.target.value)}
                className="w-full p-2.5 bg-amber-50/70 border-2 border-amber-200 rounded-xl font-bold text-xs text-slate-800"
              >
                {[1, 2, 3, 4, 5].map(g => (
                  <option key={g} value={g}>Khối {g}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-black text-slate-700 mb-1">Môn Học:</label>
              <select
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full p-2.5 bg-amber-50/70 border-2 border-amber-200 rounded-xl font-bold text-xs text-slate-800"
              >
                {subjects.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>

          {/* LOẠI GAME & URL */}
          <div>
            <label className="block text-xs font-black text-slate-700 mb-1">Loại Trò Chơi:</label>
            <select
              value={gameType}
              onChange={(e) => setGameType(e.target.value)}
              className="w-full p-2.5 bg-amber-50/70 border-2 border-amber-200 rounded-xl font-bold text-xs text-slate-800"
            >
              <option value="iframe">iFrame Embed (Wordwall, Quizizz, Kahoot...)</option>
              <option value="builtin">Built-in Game (Memory Match / Quiz Race)</option>
              <option value="html5_zip">HTML5 Package URL</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-black text-slate-700 mb-1">Đường Dẫn URL Trò Chơi (https://):</label>
            <input
              type="url"
              value={gameUrl}
              onChange={(e) => setGameUrl(e.target.value)}
              className="w-full p-3 bg-amber-50/70 border-2 border-amber-200 rounded-2xl font-bold text-xs text-slate-800 focus:outline-none focus:border-amber-400"
              required
            />
          </div>

          {/* CHỌN CÁCH CẬP NHẬT HÌNH ẢNH ĐẠI DIỆN */}
          <div className="pt-2 border-t border-amber-100">
            <label className="block text-xs font-black text-amber-950 mb-2">
              🖼️ Hình Ảnh Đại Diện Trò Chơi:
            </label>

            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={() => setImageMode('url')}
                className={`flex-1 py-1.5 text-xs font-black rounded-xl border ${
                  imageMode === 'url' ? 'bg-amber-500 text-white border-amber-600' : 'bg-slate-50 text-slate-600 border-slate-200'
                }`}
              >
                🔗 Đường dẫn URL (https://)
              </button>
              <button
                type="button"
                onClick={() => setImageMode('file')}
                className={`flex-1 py-1.5 text-xs font-black rounded-xl border ${
                  imageMode === 'file' ? 'bg-amber-500 text-white border-amber-600' : 'bg-slate-50 text-slate-600 border-slate-200'
                }`}
              >
                📁 Tải tệp từ máy (Tối đa 5MB)
              </button>
            </div>

            {imageMode === 'url' ? (
              <input
                type="url"
                placeholder="https://images.unsplash.com/..."
                value={thumbnailUrl}
                onChange={(e) => handleUrlChange(e.target.value)}
                className="w-full p-2.5 bg-amber-50/70 border-2 border-amber-200 rounded-xl font-bold text-xs text-slate-800 mb-3"
              />
            ) : (
              <div className="mb-3">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleFileChange}
                  className="w-full text-xs text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-black file:bg-amber-100 file:text-amber-900 hover:file:bg-amber-200 cursor-pointer"
                />
                <p className="text-[10px] font-bold text-slate-400 mt-1">
                  Chấp nhận JPG, PNG, WebP (Dung lượng ≤ 5MB). Cấm tệp SVG.
                </p>
              </div>
            )}

            {/* XEM TRƯỚC HÌNH ẢNH */}
            {previewUrl && (
              <div className="relative w-full h-36 rounded-2xl overflow-hidden border-2 border-amber-300 bg-slate-900 mb-3">
                {!imageError ? (
                  <img
                    src={previewUrl}
                    alt="Preview"
                    onError={() => setImageError(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-rose-400 font-bold text-xs p-2 text-center">
                    <AlertCircle className="w-6 h-6 mb-1" />
                    Không thể tải hình ảnh từ URL này. Vui lòng kiểm tra lại liên kết.
                  </div>
                )}
                <div className="absolute top-2 left-2 bg-slate-900/80 text-amber-200 font-black text-[10px] px-2 py-0.5 rounded-md">
                  Ảnh xem trước
                </div>
              </div>
            )}
          </div>

          {/* TRẠNG THÁI HIỂN THỊ */}
          <div className="flex items-center justify-between bg-amber-50/70 p-3 rounded-2xl border border-amber-200">
            <span className="text-xs font-black text-amber-950">Trạng thái công khai trong kho:</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
            </label>
          </div>

          {/* BUTTONS THAO TÁC */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-xs rounded-2xl"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 text-white font-black text-xs rounded-2xl border-b-4 border-amber-700 shadow-md flex items-center justify-center gap-2 active:translate-y-0.5 transition-all disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Edit2 className="w-4 h-4" />}
              {loading ? 'Đang Lưu...' : 'Lưu Thay Đổi'}
            </button>
          </div>

        </form>

      </div>
    </div>
  );
};
