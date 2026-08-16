import React, { useState, useEffect } from 'react';
import { 
  BookOpen, 
  Search, 
  Filter, 
  Plus, 
  FileText, 
  FileCode, 
  Image as ImageIcon, 
  Video, 
  ExternalLink, 
  Download, 
  Eye, 
  Edit2, 
  Trash2, 
  Lock, 
  Sparkles, 
  GraduationCap, 
  Calendar, 
  User, 
  HardDrive,
  RefreshCw,
  Loader2,
  HardDriveUpload
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useSound } from '../context/SoundContext';
import { formatClassLabel } from '../utils/helpers';
import { LoadingSkeleton } from '../components/common/LoadingSkeleton';
import { MaterialViewerModal } from '../components/materials/MaterialViewerModal';
import { MaterialFormModal } from '../components/materials/MaterialFormModal';
import { MaterialDeleteModal } from '../components/materials/MaterialDeleteModal';
import { LegacyFilesMigrationTool } from '../components/materials/LegacyFilesMigrationTool';

export const MaterialsView = () => {
  const { profile, globalClassFilter, setGlobalClassFilter } = useAuth();
  const { triggerSound } = useSound();

  const userRole = profile?.role || 'student';
  const isAdmin = userRole === 'admin';
  const isTeacher = userRole === 'teacher';

  const [materials, setMaterials] = useState([]);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLocalClassId, setSelectedLocalClassId] = useState('ALL');
  const [selectedSubject, setSelectedSubject] = useState('ALL');
  const [selectedFileType, setSelectedFileType] = useState('ALL');

  // Modals state
  const [selectedMaterialForView, setSelectedMaterialForView] = useState(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);

  const [materialToEdit, setMaterialToEdit] = useState(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const [materialToDelete, setMaterialToDelete] = useState(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  const [downloadingId, setDownloadingId] = useState(null);
  const [toastMsg, setToastMsg] = useState('');
  const [showAdminMigrationTool, setShowAdminMigrationTool] = useState(false);

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
    fetchClassesAndMaterials();
  }, [profile?.id, userRole]);

  const fetchClassesAndMaterials = async () => {
    setLoading(true);
    try {
      // 1. Fetch Danh sách Lớp Học phù hợp với vai trò người dùng
      let fetchedClasses = [];
      if (isAdmin) {
        const { data } = await supabase.from('classes').select('id, name, grade_level').order('grade_level');
        fetchedClasses = data || [];
      } else if (isTeacher && profile?.id) {
        const { data } = await supabase.from('classes').select('id, name, grade_level').eq('teacher_id', profile.id);
        fetchedClasses = data || [];
      } else if (profile?.id) {
        const { data: memberData } = await supabase
          .from('class_members')
          .select('classes:class_id(id, name, grade_level)')
          .eq('student_id', profile.id);
        fetchedClasses = (memberData || []).map(m => m.classes).filter(Boolean);
      }
      setClasses(fetchedClasses);

      // 2. Fetch Danh sách Tài Liệu từ Supabase RLS
      const { data: matData, error: matErr } = await supabase
        .from('learning_materials')
        .select(`
          *,
          classes:class_id (id, name, grade_level),
          profiles:created_by (full_name, avatar_url, role)
        `)
        .order('created_at', { ascending: false });

      if (matErr) {
        console.error('Error fetching materials:', matErr);
      } else {
        const formatted = (matData || []).map(m => ({
          ...m,
          className: m.classes?.name,
          classGrade: m.classes?.grade_level,
          authorName: m.profiles?.full_name || 'Giáo viên',
          authorAvatar: m.profiles?.avatar_url
        }));
        setMaterials(formatted);
      }

    } catch (err) {
      console.error('Fetch materials error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Áp dụng ĐỒNG THỜI 2 tầng lọc: Bộ Lọc Header Dùng Chung (globalClassFilter) và Bộ Lọc Nội Bộ Trang
  const filteredMaterials = materials.filter(item => {
    // TẦNG 1: ĐỒNG BỘ THEO BỘ LỌC LỚP HEADER TOÀN CỤC (globalClassFilter từ AuthContext)
    if (globalClassFilter !== 'ALL') {
      if (globalClassFilter === 'NO_CLASS') {
        if (item.class_id !== null) return false;
      } else if (item.class_id !== globalClassFilter) {
        return false;
      }
    }

    // TẦNG 2: BỘ LỌC LỚP NỘI BỘ TRANG GÓC TÀI LIỆU (selectedLocalClassId)
    if (selectedLocalClassId !== 'ALL') {
      if (selectedLocalClassId === 'NO_CLASS') {
        if (item.class_id !== null) return false;
      } else if (item.class_id !== selectedLocalClassId) {
        return false;
      }
    }

    // TẦNG 3: LỌC THEO TÌM KIẾM TỪ KHÓA TÊN BÀI GIẢNG / MÔ TẢ
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchTitle = item.title?.toLowerCase().includes(q);
      const matchDesc = item.description?.toLowerCase().includes(q);
      if (!matchTitle && !matchDesc) return false;
    }

    // TẦNG 4: LỌC THEO MÔN HỌC
    if (selectedSubject !== 'ALL' && item.subject !== selectedSubject) {
      return false;
    }

    // TẦNG 5: LỌC THEO LOẠI FILE
    if (selectedFileType !== 'ALL' && item.file_type !== selectedFileType) {
      return false;
    }

    return true;
  });

  const getFileTypeBadge = (type) => {
    switch (type?.toLowerCase()) {
      case 'pdf':
        return <span className="px-2.5 py-1 bg-rose-100 text-rose-800 border border-rose-300 font-black text-[11px] rounded-xl flex items-center gap-1"><FileText className="w-3.5 h-3.5 text-rose-600" /> PDF</span>;
      case 'word':
        return <span className="px-2.5 py-1 bg-blue-100 text-blue-800 border border-blue-300 font-black text-[11px] rounded-xl flex items-center gap-1"><FileText className="w-3.5 h-3.5 text-blue-600" /> Word</span>;
      case 'powerpoint':
        return <span className="px-2.5 py-1 bg-orange-100 text-orange-800 border border-orange-300 font-black text-[11px] rounded-xl flex items-center gap-1"><FileCode className="w-3.5 h-3.5 text-orange-600" /> PowerPoint</span>;
      case 'image':
        return <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 border border-emerald-300 font-black text-[11px] rounded-xl flex items-center gap-1"><ImageIcon className="w-3.5 h-3.5 text-emerald-600" /> Hình Ảnh</span>;
      case 'video':
        return <span className="px-2.5 py-1 bg-purple-100 text-purple-800 border border-purple-300 font-black text-[11px] rounded-xl flex items-center gap-1"><Video className="w-3.5 h-3.5 text-purple-600" /> Video</span>;
      case 'link':
        return <span className="px-2.5 py-1 bg-cyan-100 text-cyan-800 border border-cyan-300 font-black text-[11px] rounded-xl flex items-center gap-1"><ExternalLink className="w-3.5 h-3.5 text-cyan-600" /> Link Bài Giảng</span>;
      default:
        return <span className="px-2.5 py-1 bg-slate-100 text-slate-800 border border-slate-300 font-black text-[11px] rounded-xl">Tài liệu</span>;
    }
  };

  // Xử lý tạo Signed URL ngắn hạn để Tải tệp tin về máy (chỉ khi allow_download !== false)
  const handleDownloadMaterial = async (item) => {
    if (item.allow_download === false) {
      showToast('Tài liệu này không cho phép tải xuống.');
      return;
    }

    if (item.external_url) {
      window.open(item.external_url, '_blank', 'noopener,noreferrer');
      return;
    }

    if (!item.file_path) return;

    setDownloadingId(item.id);
    try {
      const { data, error } = await supabase.storage
        .from('learning-materials')
        .createSignedUrl(item.file_path, 60);

      if (error || !data?.signedUrl) {
        throw new Error(error?.message || 'Không thể tạo đường dẫn tải xuống.');
      }

      const link = document.createElement('a');
      link.href = data.signedUrl;
      link.download = item.file_name || item.title;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

    } catch (err) {
      console.error('Download error:', err);
      showToast('Lỗi khi khởi tạo liên kết tải xuống.');
    } finally {
      setDownloadingId(null);
    }
  };

  const showToast = (msg) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3500);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      
      {/* TOAST NOTIFICATION */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 p-4 bg-emerald-600 text-white font-black text-xs sm:text-sm rounded-2xl shadow-2xl animate-bounce flex items-center gap-2">
          <span>✨ {toastMsg}</span>
        </div>
      )}

      {/* HEADER BANNER GÓC TÀI LIỆU */}
      <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 rounded-3xl border-4 border-amber-700 p-6 sm:p-8 text-white shadow-lg mb-6 flex flex-col md:flex-row items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="px-3 py-1 bg-amber-900/60 text-amber-100 text-xs font-black rounded-xl uppercase flex items-center gap-1">
              📚 Kho Bài Giảng & Tài Liệu Private
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black flex items-center gap-2">
            Góc Tài Liệu Học Tập <Sparkles className="w-6 h-6 text-amber-200" />
          </h1>
          <p className="text-xs sm:text-sm font-bold text-amber-100 mt-1">
            Đọc bài giảng, xem video hướng dẫn và tải tệp tài liệu được thầy cô giao cho lớp học.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* NÚT CHUYỂN ĐỔI TOOL DI CHUYỂN FILE CỦ CHO ADMIN */}
          {isAdmin && (
            <button
              onClick={() => setShowAdminMigrationTool(!showAdminMigrationTool)}
              className="px-4 py-3 bg-amber-900/70 hover:bg-amber-900 text-amber-100 font-black text-xs rounded-2xl border border-amber-400 flex items-center gap-1.5"
            >
              <HardDriveUpload className="w-4 h-4 text-amber-300" /> Tool File Cũ
            </button>
          )}

          {/* NÚT ĐĂNG TÀI LIỆU MỚI (CHỈ HIỂN THỊ CHO ADMIN & GIÁO VIÊN) */}
          {(isAdmin || isTeacher) && (
            <button
              onClick={() => {
                setMaterialToEdit(null);
                setIsFormOpen(true);
                triggerSound('click');
              }}
              className="px-6 py-3.5 bg-white text-amber-950 hover:bg-amber-50 font-black text-xs sm:text-sm rounded-2xl border-b-4 border-amber-200 shadow-md flex items-center gap-2 active:translate-y-0.5 transition-all shrink-0"
            >
              <Plus className="w-5 h-5 text-amber-600" /> + Đăng Bài Giảng / Tài Liệu
            </button>
          )}
        </div>
      </div>

      {/* CÔNG CỤ DI CHUYỂN FILE CỦ CHO ADMIN (NẾU MỞ) */}
      {isAdmin && showAdminMigrationTool && (
        <div className="mb-6">
          <LegacyFilesMigrationTool onMigrated={() => fetchClassesAndMaterials()} />
        </div>
      )}

      {/* KHU VỰC TÌM KIẾM & BỘ LỌC NỘI BỘ TRANG */}
      <div className="bg-white p-5 rounded-3xl border-4 border-amber-200 shadow-sm mb-8 space-y-4">
        
        {/* Ô TÌM KIẾM THEO TÊN BÀI GIẢNG */}
        <div className="relative">
          <Search className="w-5 h-5 text-amber-600 absolute left-4 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Tìm kiếm theo tên bài giảng hoặc nội dung tài liệu..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-amber-50/70 border-2 border-amber-200 rounded-2xl font-black text-sm text-slate-800 focus:outline-none focus:border-amber-400 shadow-inner"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 font-black text-xs"
            >
              Clear
            </button>
          )}
        </div>

        {/* CÁC BỘ LỌC NỘI BỘ TRANG */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          
          {/* 1. LỌC THEO LỚP HỌC NỘI BỘ (TÁC ĐỘNG ĐỒNG THỜI CÙNG HEADER FILTER) */}
          <div>
            <label className="block text-[11px] font-black text-slate-500 uppercase mb-1">
              Lọc lớp học nội bộ:
            </label>
            <select
              value={selectedLocalClassId}
              onChange={(e) => { 
                setSelectedLocalClassId(e.target.value); 
                triggerSound('click'); 
              }}
              className="w-full p-2.5 bg-amber-50/70 border-2 border-amber-200 rounded-xl font-bold text-xs text-slate-800"
            >
              <option value="ALL">🌐 Tất cả các lớp (Trong phạm vi Header)</option>
              <option value="NO_CLASS">📌 Bài giảng chung (Tất cả lớp)</option>
              {classes.map(c => (
                <option key={c.id} value={c.id}>
                  🏫 {formatClassLabel(c.name)} (Khối {c.grade_level})
                </option>
              ))}
            </select>
          </div>

          {/* 2. LỌC THEO MÔN HỌC */}
          <div>
            <label className="block text-[11px] font-black text-slate-500 uppercase mb-1">Môn học:</label>
            <select
              value={selectedSubject}
              onChange={(e) => { setSelectedSubject(e.target.value); triggerSound('click'); }}
              className="w-full p-2.5 bg-amber-50/70 border-2 border-amber-200 rounded-xl font-bold text-xs text-slate-800"
            >
              <option value="ALL">📖 Tất cả các môn học</option>
              {subjects.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* 3. LỌC THEO LOẠI TỆP TIN */}
          <div>
            <label className="block text-[11px] font-black text-slate-500 uppercase mb-1">Loại tài liệu:</label>
            <select
              value={selectedFileType}
              onChange={(e) => { setSelectedFileType(e.target.value); triggerSound('click'); }}
              className="w-full p-2.5 bg-amber-50/70 border-2 border-amber-200 rounded-xl font-bold text-xs text-slate-800"
            >
              <option value="ALL">📁 Tất cả loại tài liệu</option>
              <option value="pdf">📄 File PDF</option>
              <option value="word">📝 File Word</option>
              <option value="powerpoint">📊 File PowerPoint</option>
              <option value="image">🖼️ Hình Ảnh</option>
              <option value="video">🎥 Video Bài Giảng</option>
              <option value="link">🔗 Đường Liên Kết (URL)</option>
            </select>
          </div>

        </div>
      </div>

      {/* DANH SÁCH THẺ TÀI LIỆU */}
      {loading ? (
        <LoadingSkeleton />
      ) : filteredMaterials.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredMaterials.map((item) => {
            const canManage = isAdmin || (isTeacher && item.created_by === profile?.id);
            const isDownloadAllowed = item.allow_download !== false;

            return (
              <div 
                key={item.id} 
                className="bg-white p-5 rounded-3xl border-4 border-amber-200 shadow-sm hover:shadow-md transition-all flex flex-col justify-between group relative overflow-hidden"
              >
                <div>
                  {/* BADGES HÀNG ĐẦU */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    {getFileTypeBadge(item.file_type)}
                    <span className="px-2.5 py-1 bg-amber-100 text-amber-900 font-extrabold text-[11px] rounded-xl border border-amber-300">
                      {item.subject}
                    </span>
                  </div>

                  {/* TÊNBÀI GIẢNG */}
                  <h3 className="text-base font-black text-amber-950 mb-1.5 line-clamp-2 group-hover:text-amber-600 transition-colors">
                    {item.title}
                  </h3>

                  {/* LỚP HỌC ÁP DỤNG */}
                  <div className="mb-2">
                    <span className="text-[11px] font-bold text-sky-700 bg-sky-50 px-2 py-0.5 rounded-lg border border-sky-200 inline-block">
                      🏫 {item.className ? formatClassLabel(item.className) : 'Dành cho Tất cả các lớp'}
                    </span>
                  </div>

                  {/* MÔ TẢ NẮN */}
                  <p className="text-xs font-bold text-slate-500 line-clamp-2 mb-4 leading-relaxed">
                    {item.description || 'Chưa có mô tả chi tiết cho bài giảng này.'}
                  </p>
                </div>

                <div>
                  {/* TÁC GIẢ & NGÀY ĐĂNG */}
                  <div className="pt-3 border-t border-amber-100 flex items-center justify-between text-[11px] font-bold text-slate-400 mb-4">
                    <span className="flex items-center gap-1 text-slate-600">
                      <User className="w-3.5 h-3.5 text-amber-600" /> {item.authorName}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-sky-500" /> {new Date(item.created_at).toLocaleDateString('vi-VN')}
                    </span>
                  </div>

                  {/* NÚT THAO TÁC (XEM, TẢI VỀ, SỬA, XÓA) */}
                  <div className="flex items-center justify-between gap-2 pt-1">
                    
                    <button
                      onClick={() => {
                        setSelectedMaterialForView(item);
                        setIsViewerOpen(true);
                        triggerSound('click');
                      }}
                      className="flex-1 py-2 bg-amber-400 hover:bg-amber-500 text-amber-950 font-black text-xs rounded-xl border-b-2 border-amber-600 shadow-sm flex items-center justify-center gap-1 active:translate-y-0.5"
                    >
                      <Eye className="w-3.5 h-3.5" /> Xem Tài Liệu
                    </button>

                    {/* NÚT TẢI XUỐNG (NẾU ALLOW_DOWNLOAD TRUE & CÓ FILE) */}
                    {isDownloadAllowed && (item.file_path || item.external_url) ? (
                      <button
                        onClick={() => handleDownloadMaterial(item)}
                        disabled={downloadingId === item.id}
                        className="p-2 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 rounded-xl transition-colors disabled:opacity-50"
                        title="Tải xuống tài liệu qua Signed URL"
                      >
                        {downloadingId === item.id ? (
                          <Loader2 className="w-4 h-4 animate-spin text-emerald-700" />
                        ) : (
                          <Download className="w-4 h-4" />
                        )}
                      </button>
                    ) : (
                      <span 
                        className="p-2 bg-slate-100 text-slate-400 rounded-xl cursor-not-allowed"
                        title="Tài liệu này chỉ cho phép xem trực tiếp (Không cho phép tải xuống)"
                      >
                        <Lock className="w-4 h-4" />
                      </span>
                    )}

                    {/* NÚT SỬA & XÓA CHO ADMIN VÀ GIÁO VIÊN NGUỒN */}
                    {canManage && (
                      <>
                        <button
                          onClick={() => {
                            setMaterialToEdit(item);
                            setIsFormOpen(true);
                            triggerSound('click');
                          }}
                          className="p-2 bg-sky-100 hover:bg-sky-200 text-sky-800 rounded-xl transition-colors"
                          title="Sửa bài giảng"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => {
                            setMaterialToDelete(item);
                            setIsDeleteOpen(true);
                            triggerSound('click');
                          }}
                          className="p-2 bg-rose-100 hover:bg-rose-200 text-rose-800 rounded-xl transition-colors"
                          title="Xóa bài giảng"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}

                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-12 bg-white rounded-3xl border-4 border-amber-200 p-6">
          <div className="w-16 h-16 bg-amber-100 rounded-3xl border-4 border-amber-300 flex items-center justify-center mx-auto mb-3 text-3xl">
            🦉
          </div>
          <h4 className="text-lg font-black text-amber-950 mb-1">Chưa tìm thấy bài giảng / tài liệu phù hợp</h4>
          <p className="text-xs font-bold text-slate-500 mb-4 max-w-sm mx-auto">
            Thầy cô chưa tải bài giảng lên hoặc bộ lọc không khớp. Thử chọn lại xem nhé!
          </p>

          {(isAdmin || isTeacher) && (
            <button
              onClick={() => {
                setMaterialToEdit(null);
                setIsFormOpen(true);
                triggerSound('click');
              }}
              className="px-5 py-2.5 bg-amber-400 text-amber-950 font-black text-xs rounded-2xl shadow-md inline-flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" /> + Đăng Bài Giảng Đầu Tiên
            </button>
          )}
        </div>
      )}

      {/* MODAL XEM CHI TIẾT TÀI LIỆU */}
      <MaterialViewerModal
        isOpen={isViewerOpen}
        onClose={() => setIsViewerOpen(false)}
        material={selectedMaterialForView}
      />

      {/* MODAL THÊM / SỬA TÀI LIỆU */}
      <MaterialFormModal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        materialToEdit={materialToEdit}
        classesList={classes}
        onSaved={() => {
          fetchClassesAndMaterials();
          showToast(materialToEdit ? 'Đã cập nhật thông tin bài giảng thành công!' : 'Đã đăng bài giảng / tài liệu mới thành công!');
        }}
      />

      {/* MODAL XÓA TÀI LIỆU */}
      <MaterialDeleteModal
        isOpen={isDeleteOpen}
        onClose={() => setIsDeleteOpen(false)}
        material={materialToDelete}
        DELETED_CALLBACK={() => {
          fetchClassesAndMaterials();
          showToast('Đã xóa bài giảng / tài liệu thành công!');
        }}
      />

    </div>
  );
};
