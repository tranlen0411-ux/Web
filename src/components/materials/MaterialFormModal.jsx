import React, { useState, useEffect } from 'react';
import {
  X,
  UploadCloud,
  Link as LinkIcon,
  FileText,
  CheckCircle2,
  AlertCircle,
  BookOpen,
  GraduationCap,
  Lock,
  HardDrive,
  Loader2,
  Share2,
  Layers
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { formatClassLabel } from '../../utils/helpers';
import { validateScormZip } from '../../utils/scormZipValidator';
import { parseScormManifest } from '../../utils/scormManifest';
import { cleanupScormPackageStorage } from '../../services/scormLaunchService';

export const MaterialFormModal = ({ isOpen, onClose, materialToEdit, classesList = [], onSaved }) => {
  const { profile } = useAuth();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [subject, setSubject] = useState('Toán');
  const [classId, setClassId] = useState('');
  const [fileType, setFileType] = useState('pdf');
  const [sourceType, setSourceType] = useState('file'); // 'file' | 'link'
  const [externalUrl, setExternalUrl] = useState('');
  const [allowDownload, setAllowDownload] = useState(true);

  // Material Visibility Phase 1
  const [visibility, setVisibility] = useState('class'); // 'class' | 'school' | 'public'
  const [sharedClassIds, setSharedClassIds] = useState([]);

  // SCORM Phase 2A
  const [scormState, setScormState] = useState(null); // { zip, manifestInfo, fileEntries, totalSize }
  const [progressText, setProgressText] = useState('');

  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

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

  // Danh sách các MIME type và Extension hợp lệ
  const ALLOWED_MIME_TYPES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
    'application/zip', 'application/x-zip-compressed', 'application/x-zip'
  ];

  const ALLOWED_EXTENSIONS = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'webm', 'mov', 'zip'];

  useEffect(() => {
    if (isOpen) {
      if (materialToEdit) {
        setTitle(materialToEdit.title || '');
        setDescription(materialToEdit.description || '');
        setSubject(materialToEdit.subject || 'Toán');
        setClassId(materialToEdit.class_id || '');
        setFileType(materialToEdit.file_type || 'pdf');
        setSourceType(materialToEdit.external_url ? 'link' : 'file');
        setExternalUrl(materialToEdit.external_url || '');
        setAllowDownload(materialToEdit.allow_download !== false);
        setVisibility(materialToEdit.visibility || 'class');
        setFile(null);
        setScormState(null);

        // Load existing shared classes if editing (Phase 1 contract: class_id)
        if (materialToEdit.id && materialToEdit.visibility === 'class') {
          supabase
            .from('learning_material_shares')
            .select('class_id')
            .eq('material_id', materialToEdit.id)
            .then(({ data }) => {
              if (data) setSharedClassIds(data.map((r) => r.class_id));
            });
        } else {
          setSharedClassIds([]);
        }
      } else {
        setTitle('');
        setDescription('');
        setSubject('Toán');
        setClassId(classesList.length > 0 ? classesList[0].id : '');
        setFileType('pdf');
        setSourceType('file');
        setExternalUrl('');
        setAllowDownload(true);
        setVisibility('class');
        setSharedClassIds([]);
        setFile(null);
        setScormState(null);
      }
      setErrorMsg('');
      setProgressText('');
    }
  }, [isOpen, materialToEdit, classesList]);

  if (!isOpen) return null;

  // Kiểm tra định dạng Extension và MIME Type của file
  const handleFileChange = async (e) => {
    const selectedFile = e.target.files[0];
    setErrorMsg('');
    setScormState(null);
    if (!selectedFile) return;

    // 1. Kiểm tra Extension
    const ext = selectedFile.name.split('.').pop().toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      setErrorMsg(`Định dạng tệp .${ext} không hợp lệ. Hệ thống chấp nhận PDF, Word, PowerPoint, Hình ảnh, Video và SCORM (.zip).`);
      e.target.value = '';
      return;
    }

    // 2. Nếu là gói SCORM (.zip) -> Validate và Parse Manifest
    if (ext === 'zip') {
      try {
        setLoading(true);
        setProgressText('Đang kiểm tra tính hợp lệ của gói SCORM...');

        const zipValidation = await validateScormZip(selectedFile);
        const manifestInfo = parseScormManifest(zipValidation.manifestXmlText);

        setFileType('scorm');
        setScormState({
          ...zipValidation,
          manifestInfo,
        });

        // Tự động điền tên nếu chưa nhập
        if (!title.trim() && manifestInfo.title) {
          setTitle(manifestInfo.title);
        }

        setFile(selectedFile);
      } catch (err) {
        console.error('SCORM validation error:', err);
        setErrorMsg('Lỗi gói SCORM: ' + (err.message || 'Không hợp lệ'));
        e.target.value = '';
        setFile(null);
        setScormState(null);
      } finally {
        setLoading(false);
        setProgressText('');
      }
      return;
    }

    // 3. Với các file thông thường khác
    const MAX_SIZE = 50 * 1024 * 1024;
    if (selectedFile.size > MAX_SIZE) {
      setErrorMsg('Dung lượng tệp tin vượt quá 50MB. Vui lòng chọn tệp nhỏ hơn.');
      e.target.value = '';
      return;
    }

    if (['pdf'].includes(ext)) {
      setFileType('pdf');
    } else if (['doc', 'docx'].includes(ext)) {
      setFileType('word');
    } else if (['ppt', 'pptx'].includes(ext)) {
      setFileType('powerpoint');
    } else if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
      setFileType('image');
    } else if (['mp4', 'webm', 'mov'].includes(ext)) {
      setFileType('video');
    }

    setFile(selectedFile);
  };

  const validateHttpsUrl = (urlStr) => {
    if (!urlStr) return false;
    try {
      const parsed = new URL(urlStr);
      return parsed.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const toggleSharedClass = (cId) => {
    setSharedClassIds((prev) =>
      prev.includes(cId) ? prev.filter((id) => id !== cId) : [...prev, cId]
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');

    if (!title.trim()) {
      setErrorMsg('Vui lòng nhập tên bài giảng / tài liệu.');
      return;
    }

    if (visibility === 'class' && !classId) {
      setErrorMsg('Vui lòng chọn lớp chính cho tài liệu khi chọn phạm vi Theo lớp.');
      return;
    }

    if (sourceType === 'link') {
      if (!externalUrl.trim()) {
        setErrorMsg('Vui lòng nhập đường liên kết bài giảng bên ngoài.');
        return;
      }
      if (!validateHttpsUrl(externalUrl.trim())) {
        setErrorMsg('Đường liên kết bài giảng phải là địa chỉ HTTPS hợp lệ (bắt đầu bằng https://...).');
        return;
      }
    }

    if (sourceType === 'file' && !file && !materialToEdit?.file_path) {
      setErrorMsg('Vui lòng chọn tệp tài liệu để tải lên.');
      return;
    }

    setLoading(true);

    let newlyUploadedPath = null;
    let newlyCreatedPackageId = null;
    const oldFilePath = materialToEdit?.file_path;

    try {
      let finalFilePath = oldFilePath || null;
      let finalFileName = materialToEdit?.file_name || null;
      let finalFileSize = materialToEdit?.file_size || 0;

      const isScormUpload = sourceType === 'file' && file && fileType === 'scorm' && scormState;
      let packageId = null;
      let contentRoot = null;
      let zipStoragePath = null;

      if (isScormUpload) {
        packageId = crypto.randomUUID();
        newlyCreatedPackageId = packageId;
        contentRoot = `${profile.id}/${packageId}`;
        zipStoragePath = `scorm-zips/${profile.id}/${packageId}.zip`;
      }

      // ====================================================================
      // BƯỚC 1: LƯU BẢN GHI LEARNING_MATERIALS VÀO DATABASE ĐỂ TẠO ANCHOR
      // ====================================================================
      setProgressText('Đang khởi tạo bản ghi bài giảng trong hệ thống...');

      // Xử lý share_token khớp ràng buộc check_share_token_consistency:
      // 1. Khi visibility === 'public':
      //    - Edit bài đang public: giữ nguyên share_token cũ
      //    - Tạo mới hoặc chuyển từ class/school sang public: tạo token ngẫu nhiên mới
      // 2. Khi visibility === 'class' hoặc 'school':
      //    - Bắt buộc share_token = null
      let computedShareToken = null;
      if (visibility === 'public') {
        if (materialToEdit && materialToEdit.visibility === 'public' && materialToEdit.share_token) {
          computedShareToken = materialToEdit.share_token;
        } else {
          computedShareToken = crypto.randomUUID().replace(/-/g, '');
        }
      } else {
        computedShareToken = null;
      }

      const payload = {
        title: title.trim(),
        description: description.trim(),
        subject: subject,
        class_id: visibility === 'class' ? classId : null,
        file_name: sourceType === 'file' ? (file ? file.name : finalFileName) : null,
        file_path: sourceType === 'file' ? (isScormUpload ? zipStoragePath : finalFilePath) : null,
        file_type: fileType,
        file_size: sourceType === 'file' ? (file ? file.size : finalFileSize) : 0,
        external_url: sourceType === 'link' ? externalUrl.trim() : null,
        allow_download: allowDownload,
        visibility: visibility,
        share_token: computedShareToken,
        updated_at: new Date().toISOString(),
      };

      let savedMaterialId = materialToEdit?.id;

      if (materialToEdit) {
        const { error: updateErr } = await supabase
          .from('learning_materials')
          .update(payload)
          .eq('id', materialToEdit.id);

        if (updateErr) throw updateErr;
      } else {
        payload.created_by = profile.id;
        const { data: insertData, error: insertErr } = await supabase
          .from('learning_materials')
          .insert([payload])
          .select('id')
          .single();

        if (insertErr) throw insertErr;
        savedMaterialId = insertData.id;
      }

      // ====================================================================
      // BƯỚC 2: NẾU LÀ SCORM -> KHỞI TẠO SCORM_PACKAGES VỚI STATUS='PROCESSING'
      // ====================================================================
      if (isScormUpload) {
        const scormPkgInitPayload = {
          id: packageId,
          material_id: savedMaterialId,
          package_version: '1.0',
          scorm_version: scormState.manifestInfo?.scormVersion || '1.2',
          manifest_path: scormState.manifestInfo?.manifestPath || 'imsmanifest.xml',
          launch_path: scormState.manifestInfo?.launchPath || 'index.html',
          content_root: contentRoot,
          status: 'processing',
          original_zip_path: zipStoragePath,
          created_by: profile.id,
        };

        const { error: scormInitErr } = await supabase
          .from('scorm_packages')
          .upsert(scormPkgInitPayload, { onConflict: 'material_id' });

        if (scormInitErr) throw scormInitErr;

        // ====================================================================
        // BƯỚC 3: TẢI TỆP ZIP GỐC LÊN BUCKET LEARNING-MATERIALS
        // ====================================================================
        setProgressText('Đang lưu tệp nén gốc SCORM...');
        const { error: zipUploadErr } = await supabase.storage
          .from('learning-materials')
          .upload(zipStoragePath, file, { contentType: 'application/zip', cacheControl: '3600', upsert: false });

        if (zipUploadErr) {
          throw new Error('Không thể tải tệp ZIP SCORM lên Storage: ' + zipUploadErr.message);
        }
        newlyUploadedPath = zipStoragePath;

        // ====================================================================
        // BƯỚC 4: GIẢI NÉN & TẢI ASSETS LÊN BUCKET SCORM-CONTENT (<user-id>/<package-id>/...)
        // ====================================================================
        setProgressText(`Đang giải nén & tải lên ${scormState.fileEntries.length} tệp nội dung...`);
        for (let i = 0; i < scormState.fileEntries.length; i++) {
          const entryName = scormState.fileEntries[i];
          const fileData = await scormState.zip.file(entryName).async('blob');
          const assetStoragePath = `${contentRoot}/${entryName}`;

          const { error: assetErr } = await supabase.storage
            .from('scorm-content')
            .upload(assetStoragePath, fileData, { cacheControl: '3600', upsert: true });

          if (assetErr) {
            throw new Error(`Lỗi nạp tệp "${entryName}" vào Storage: ` + assetErr.message);
          }
        }

        // ====================================================================
        // BƯỚC 5: CẬP NHẬT SCORM_PACKAGES SANG STATUS='READY'
        // ====================================================================
        setProgressText('Đang hoàn thiện gói bài học SCORM...');
        const { error: readyErr } = await supabase
          .from('scorm_packages')
          .update({ status: 'ready', updated_at: new Date().toISOString() })
          .eq('id', packageId);

        if (readyErr) throw readyErr;

        finalFilePath = zipStoragePath;
        finalFileName = file.name;
        finalFileSize = file.size;
      }
      // ====================================================================
      // XỬ LÝ UPLOAD FILE THƯỜNG KHÁC (PDF, Word, Powerpoint...)
      // ====================================================================
      else if (sourceType === 'file' && file) {
        setProgressText('Đang tải tệp tin lên hệ thống...');
        const cleanName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const userFolder = profile.id;
        const storagePath = `${userFolder}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${cleanName}`;

        const { error: uploadErr } = await supabase.storage
          .from('learning-materials')
          .upload(storagePath, file, { cacheControl: '3600', upsert: false });

        if (uploadErr) {
          throw new Error('Lỗi khi tải file lên Storage: ' + uploadErr.message);
        }

        newlyUploadedPath = storagePath;
        finalFilePath = storagePath;
        finalFileName = file.name;
        finalFileSize = file.size;

        // Cập nhật lại file_path cho material
        await supabase
          .from('learning_materials')
          .update({ file_path: finalFilePath, file_name: finalFileName, file_size: finalFileSize })
          .eq('id', savedMaterialId);
      }

      // ====================================================================
      // BƯỚC 6: CẬP NHẬT BẢNG CHIA SẺ LIÊN LỚP (SHARES - KHỚP PHASE 1: CLASS_ID)
      // ====================================================================
      if (visibility === 'class') {
        // Xóa các liên kết cũ
        await supabase
          .from('learning_material_shares')
          .delete()
          .eq('material_id', savedMaterialId);

        // Thêm liên kết lớp được chọn (trừ lớp chính)
        const otherClassIds = sharedClassIds.filter((id) => id !== classId);
        if (otherClassIds.length > 0) {
          const shareRows = otherClassIds.map((tId) => ({
            material_id: savedMaterialId,
            class_id: tId,
          }));
          await supabase.from('learning_material_shares').insert(shareRows);
        }
      }

      // Dọn dẹp file cũ nếu có thay thế file
      if (oldFilePath && oldFilePath !== finalFilePath) {
        await supabase.storage.from('learning-materials').remove([oldFilePath]);
      }

      onSaved?.();
      onClose();
    } catch (err) {
      console.error('Save material error:', err);

      // Rollback dọn dẹp Storage nếu fail
      if (newlyUploadedPath) {
        await supabase.storage.from('learning-materials').remove([newlyUploadedPath]);
      }
      if (newlyCreatedPackageId && profile?.id) {
        await cleanupScormPackageStorage(`${profile.id}/${newlyCreatedPackageId}`);
        // Đánh dấu status='failed' để không usable
        await supabase
          .from('scorm_packages')
          .update({ status: 'failed' })
          .eq('id', newlyCreatedPackageId);
      }

      setErrorMsg(err.message || 'Lỗi khi lưu thông tin tài liệu.');
    } finally {
      setLoading(false);
      setProgressText('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/65 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-2xl bg-white rounded-3xl border-4 border-amber-300 p-6 sm:p-8 shadow-2xl max-h-[92vh] overflow-y-auto custom-scrollbar">
        <button
          onClick={onClose}
          disabled={loading}
          className="absolute top-4 right-4 p-2 bg-slate-100 rounded-full hover:bg-slate-200 text-slate-500"
        >
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-xl font-black text-amber-950 mb-1 flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-amber-600" />
          {materialToEdit ? 'Sửa Thông Tin Bài Giảng / Tài Liệu' : 'Thêm Bài Giảng / Tài Liệu Mới'}
        </h3>
        <p className="text-xs font-bold text-slate-500 mb-5">
          Đăng bài giảng, tệp tài liệu, gói SCORM hoặc liên kết trực tuyến HTTPS cho học sinh.
        </p>

        {errorMsg && (
          <div className="mb-4 p-3 bg-rose-100 border-2 border-rose-300 text-rose-800 text-xs font-bold rounded-xl flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* TÊN BÀI GIẢNG / TÀI LIỆU */}
          <div>
            <label className="block text-xs font-black text-slate-700 mb-1">
              Tên Bài Giảng / Tài Liệu <span className="text-rose-500">*</span>:
            </label>
            <input
              type="text"
              placeholder="Ví dụ: Bài giảng Toán Lớp 1 — Phép cộng trong phạm vi 10..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full p-3 bg-amber-50/80 border-2 border-amber-200 rounded-2xl font-bold text-sm text-slate-800 focus:outline-none focus:border-amber-400"
              required
            />
          </div>

          {/* MÔ TẢ NGẮN */}
          <div>
            <label className="block text-xs font-black text-slate-700 mb-1">Mô tả ngắn / Hướng dẫn học sinh:</label>
            <textarea
              rows={2}
              placeholder="Nhập ghi chú hoặc dặn dò học sinh khi xem tài liệu..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-3 bg-amber-50/80 border-2 border-amber-200 rounded-2xl font-bold text-xs text-slate-800 focus:outline-none focus:border-amber-400"
            />
          </div>

          {/* PHẠM VI CHIA SẺ (VISIBILITY PHASE 1) */}
          <div className="p-4 bg-amber-50/60 rounded-2xl border-2 border-amber-200 space-y-3">
            <label className="block text-xs font-black text-amber-950 uppercase flex items-center gap-1.5">
              <Share2 className="w-4 h-4 text-amber-700" /> Phạm vi chia sẻ bài giảng:
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setVisibility('class')}
                className={`p-2.5 rounded-xl border-2 font-bold text-xs flex flex-col items-center gap-1 transition-all ${
                  visibility === 'class'
                    ? 'bg-amber-500 text-white border-amber-600 shadow-md'
                    : 'bg-white text-slate-700 border-amber-200 hover:bg-amber-50'
                }`}
              >
                <Lock className="w-4 h-4" />
                <span>🔒 Theo lớp</span>
              </button>

              <button
                type="button"
                onClick={() => setVisibility('school')}
                className={`p-2.5 rounded-xl border-2 font-bold text-xs flex flex-col items-center gap-1 transition-all ${
                  visibility === 'school'
                    ? 'bg-amber-500 text-white border-amber-600 shadow-md'
                    : 'bg-white text-slate-700 border-amber-200 hover:bg-amber-50'
                }`}
              >
                <BookOpen className="w-4 h-4" />
                <span>🏫 Toàn trường</span>
              </button>

              <button
                type="button"
                onClick={() => setVisibility('public')}
                className={`p-2.5 rounded-xl border-2 font-bold text-xs flex flex-col items-center gap-1 transition-all ${
                  visibility === 'public'
                    ? 'bg-amber-500 text-white border-amber-600 shadow-md'
                    : 'bg-white text-slate-700 border-amber-200 hover:bg-amber-50'
                }`}
              >
                <Share2 className="w-4 h-4" />
                <span>🌐 Công khai</span>
              </button>
            </div>

            {visibility === 'class' && (
              <div className="pt-2 space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Lớp chính áp dụng <span className="text-rose-500">*</span>:
                  </label>
                  <select
                    value={classId}
                    onChange={(e) => setClassId(e.target.value)}
                    className="w-full p-2.5 bg-white border-2 border-amber-200 rounded-xl font-bold text-xs text-slate-800"
                    required
                  >
                    <option value="">-- Chọn lớp chính --</option>
                    {classesList.map((c) => (
                      <option key={c.id} value={c.id}>
                        🏫 {formatClassLabel(c.name)} (Khối {c.grade_level})
                      </option>
                    ))}
                  </select>
                </div>

                {classesList.length > 1 && (
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      Chia sẻ thêm tới các lớp khác (Liên lớp):
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {classesList
                        .filter((c) => c.id !== classId)
                        .map((c) => {
                          const isSelected = sharedClassIds.includes(c.id);
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => toggleSharedClass(c.id)}
                              className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold transition-colors ${
                                isSelected
                                  ? 'bg-amber-500 text-white border-amber-600'
                                  : 'bg-white text-slate-600 border-slate-200 hover:border-amber-300'
                              }`}
                            >
                              {isSelected ? '✓ ' : '+ '}
                              {formatClassLabel(c.name)}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* MÔN HỌC */}
          <div>
            <label className="block text-xs font-black text-slate-700 mb-1">
              Môn Học <span className="text-rose-500">*</span>:
            </label>
            <select
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full p-3 bg-amber-50/80 border-2 border-amber-200 rounded-2xl font-bold text-xs text-slate-800"
            >
              {subjects.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* LOẠI TÀI LIỆU & NGUỒN TẢI LÊN */}
          <div className="p-4 bg-amber-100/50 rounded-2xl border-2 border-amber-200 space-y-3">
            <label className="block text-xs font-black text-amber-950 uppercase">Nguồn tài liệu bài giảng:</label>

            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-xs font-black text-slate-700 cursor-pointer">
                <input
                  type="radio"
                  name="sourceType"
                  value="file"
                  checked={sourceType === 'file'}
                  onChange={() => setSourceType('file')}
                  className="w-4 h-4 text-amber-600"
                />
                <UploadCloud className="w-4 h-4 text-amber-600" /> Tải tệp từ máy tính
              </label>

              <label className="flex items-center gap-2 text-xs font-black text-slate-700 cursor-pointer">
                <input
                  type="radio"
                  name="sourceType"
                  value="link"
                  checked={sourceType === 'link'}
                  onChange={() => {
                    setSourceType('link');
                    setFileType('link');
                  }}
                  className="w-4 h-4 text-sky-600"
                />
                <LinkIcon className="w-4 h-4 text-sky-600" /> Đường liên kết bài giảng (HTTPS)
              </label>
            </div>

            {sourceType === 'file' ? (
              <div className="space-y-3 pt-2">
                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1">Loại Tệp Tin:</label>
                  <select
                    value={fileType}
                    onChange={(e) => setFileType(e.target.value)}
                    className="w-full p-2.5 bg-white border-2 border-amber-200 rounded-xl font-bold text-xs"
                  >
                    <option value="pdf">📄 PDF (Tài liệu bài giảng)</option>
                    <option value="word">📝 Word (.doc, .docx)</option>
                    <option value="powerpoint">📊 PowerPoint (.ppt, .pptx)</option>
                    <option value="image">🖼️ Hình Ảnh (PNG, JPG...)</option>
                    <option value="video">🎥 Video (MP4...)</option>
                    <option value="scorm">📦 SCORM Package (.zip 1.2 / 2004)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1">
                    Chọn Tệp Tin Tải Lên {fileType === 'scorm' ? '(Gói .zip chuẩn SCORM)' : '(Tối đa 50MB)'}:
                  </label>
                  <input
                    type="file"
                    onChange={handleFileChange}
                    accept={
                      fileType === 'scorm'
                        ? '.zip,application/zip,application/x-zip-compressed'
                        : '.pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp,.mp4,.webm,.mov'
                    }
                    className="w-full text-xs font-bold text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-black file:bg-amber-400 file:text-amber-950 hover:file:bg-amber-500 cursor-pointer"
                  />

                  {scormState && (
                    <div className="mt-2 p-2.5 bg-emerald-50 border border-emerald-300 rounded-xl text-[11px] font-bold text-emerald-800 space-y-0.5">
                      <p className="flex items-center gap-1.5 font-black text-emerald-900">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        Gói SCORM hợp lệ: Phiên bản {scormState.manifestInfo?.scormVersion} ({scormState.filesCount} tệp)
                      </p>
                      <p className="text-slate-600">
                        🚀 Launch File: <code className="bg-white px-1.5 py-0.5 rounded text-emerald-950">{scormState.manifestInfo?.launchPath}</code>
                      </p>
                    </div>
                  )}

                  {materialToEdit?.file_name && !file && (
                    <p className="text-[11px] font-extrabold text-emerald-700 mt-1">
                      📄 File hiện tại: {materialToEdit.file_name} (Chọn file mới nếu muốn thay thế)
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="pt-2">
                <label className="block text-xs font-black text-slate-700 mb-1">
                  Đường Liên Kết Bài Giảng (Bắt buộc địa chỉ HTTPS):
                </label>
                <input
                  type="url"
                  placeholder="https://youtube.com/watch?... hoặc https://drive.google.com/..."
                  value={externalUrl}
                  onChange={(e) => setExternalUrl(e.target.value)}
                  className="w-full p-3 bg-white border-2 border-amber-200 rounded-2xl font-bold text-xs text-slate-800"
                />
              </div>
            )}
          </div>

          {/* QUYỀN TẢI VỀ CỦA HỌC SINH */}
          <div className="p-3 bg-amber-50 rounded-2xl border border-amber-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-amber-700" />
              <div>
                <p className="text-xs font-black text-amber-950">Cho phép học sinh tải tài liệu về máy:</p>
                <p className="text-[10px] font-bold text-slate-500">
                  Nếu tắt, hệ thống sẽ ẩn nút tải và không phát hành Signed URL tải về.
                </p>
              </div>
            </div>

            <input
              type="checkbox"
              checked={allowDownload}
              onChange={(e) => setAllowDownload(e.target.checked)}
              className="w-5 h-5 text-amber-600 rounded cursor-pointer"
            />
          </div>

          {/* TRẠNG THÁI TIẾN TRÌNH TẢI LÊN */}
          {loading && (
            <div className="p-3 bg-amber-100 rounded-2xl border border-amber-300 flex items-center gap-3">
              <Loader2 className="w-5 h-5 text-amber-700 animate-spin shrink-0" />
              <p className="text-xs font-bold text-amber-950">
                {progressText || 'Đang xử lý tệp tin & lưu bài giảng vào hệ thống... Vui lòng chờ.'}
              </p>
            </div>
          )}

          {/* FOOTER NÚT LƯU */}
          <div className="pt-3 flex justify-end gap-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs rounded-xl"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-black text-xs sm:text-sm rounded-xl border-b-4 border-amber-700 shadow-md active:translate-y-0.5 flex items-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Đang Xử Lý...
                </>
              ) : materialToEdit ? (
                '💾 CẬP NHẬT TÀI LIỆU'
              ) : (
                '🚀 ĐĂNG BÀI GIẢNG / TÀI LIỆU'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
