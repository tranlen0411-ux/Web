import JSZip from 'jszip';
import { SCORM_LIMITS } from '../constants/scormConstants.js';

/**
 * Kiểm tra tính hợp lệ và an toàn của tệp ZIP SCORM trước khi giải nén
 * @param {File|Blob|ArrayBuffer|Uint8Array} zipData
 * @returns {Promise<{ isValid: boolean, zip: JSZip, manifestXmlText: string, fileEntries: Array, totalUncompressedSize: number }>}
 */
export async function validateScormZip(zipData) {
  // 1. Kiểm tra dung lượng file đầu vào
  const byteLength = zipData.size || zipData.byteLength || 0;
  if (byteLength > SCORM_LIMITS.MAX_ZIP_SIZE) {
    throw new Error(`Dung lượng tệp SCORM (.zip) vượt quá giới hạn cho phép (${Math.round(SCORM_LIMITS.MAX_ZIP_SIZE / 1024 / 1024)}MB).`);
  }

  // 2. Nạp file zip bằng JSZip
  let zip;
  try {
    zip = await JSZip.loadAsync(zipData);
  } catch (err) {
    throw new Error('Tệp không đúng định dạng ZIP hoặc đã bị hỏng: ' + (err.message || 'Lỗi nạp ZIP'));
  }

  const entries = Object.keys(zip.files);

  // 3. Kiểm tra số lượng entry tối đa
  if (entries.length === 0) {
    throw new Error('Gói ZIP rỗng, không chứa bất kỳ tệp nào.');
  }

  if (entries.length > SCORM_LIMITS.MAX_ENTRY_COUNT) {
    throw new Error(`Số lượng tệp bên trong gói SCORM vượt quá giới hạn tối đa (${SCORM_LIMITS.MAX_ENTRY_COUNT} tệp).`);
  }

  // 4. Kiểm tra sự tồn tại của imsmanifest.xml
  let manifestEntryName = null;
  for (const name of entries) {
    if (name.toLowerCase() === SCORM_LIMITS.MANIFEST_FILENAME.toLowerCase()) {
      manifestEntryName = name;
      break;
    }
  }

  if (!manifestEntryName) {
    throw new Error('Gói SCORM không hợp lệ: Không tìm thấy tệp imsmanifest.xml tại thư mục gốc.');
  }

  // 5. Kiểm tra an toàn cho từng tệp (Path traversal, Depth, Kích thước)
  let totalUncompressedSize = 0;
  const fileEntries = [];

  for (const entryName of entries) {
    const fileObj = zip.files[entryName];

    // 5.1. Chặn Path Traversal (Tuyệt đối không cho ../ hoặc ..\)
    if (
      entryName.includes('../') ||
      entryName.includes('..\\') ||
      entryName.startsWith('/') ||
      entryName.startsWith('\\') ||
      /^[a-zA-Z]:/.test(entryName) ||
      entryName.includes('\0')
    ) {
      throw new Error(`Phát hiện đường dẫn tệp không an toàn trong gói ZIP: "${entryName}".`);
    }

    // 5.2. Chặn thư mục lồng quá sâu
    const pathDepth = entryName.split(/[/\\]/).filter(Boolean).length;
    if (pathDepth > SCORM_LIMITS.MAX_PATH_DEPTH) {
      throw new Error(`Độ sâu thư mục vượt quá giới hạn cho phép (${SCORM_LIMITS.MAX_PATH_DEPTH} cấp): "${entryName}".`);
    }

    if (!fileObj.dir) {
      // 5.3. Kiểm tra kích thước từng file
      // JSZip lưu uncompressed size trong _data.uncompressedSize (nếu có)
      const uncompressedSize = fileObj._data?.uncompressedSize ?? fileObj.uncompressedSize ?? 0;
      if (uncompressedSize > SCORM_LIMITS.MAX_SINGLE_FILE_SIZE) {
        throw new Error(`Tệp "${entryName}" vượt quá dung lượng cho phép của 1 tệp (${Math.round(SCORM_LIMITS.MAX_SINGLE_FILE_SIZE / 1024 / 1024)}MB).`);
      }

      totalUncompressedSize += uncompressedSize;

      // 5.4. Chặn Zip Bomb (Tỷ lệ nén quá cao)
      const compressedSize = fileObj._data?.compressedSize ?? 1;
      if (compressedSize > 0 && uncompressedSize / compressedSize > SCORM_LIMITS.MAX_COMPRESSION_RATIO) {
        throw new Error(`Phát hiện tệp có tỷ lệ nén bất thường (nguy cơ Zip Bomb): "${entryName}".`);
      }

      fileEntries.push(entryName);
    }
  }

  // 5.5. Kiểm tra tổng dung lượng giải nén
  if (totalUncompressedSize > SCORM_LIMITS.MAX_TOTAL_UNCOMPRESSED_SIZE) {
    throw new Error(`Tổng dung lượng sau giải nén (${Math.round(totalUncompressedSize / 1024 / 1024)}MB) vượt quá giới hạn tối đa (${Math.round(SCORM_LIMITS.MAX_TOTAL_UNCOMPRESSED_SIZE / 1024 / 1024)}MB).`);
  }

  // 6. Đọc nội dung imsmanifest.xml
  const manifestFile = zip.file(manifestEntryName);
  const manifestXmlText = await manifestFile.async('string');

  if (!manifestXmlText || manifestXmlText.trim() === '') {
    throw new Error('Tệp imsmanifest.xml bị rỗng.');
  }

  return {
    isValid: true,
    zip,
    manifestXmlText,
    manifestEntryName,
    fileEntries,
    totalUncompressedSize,
    filesCount: fileEntries.length,
  };
}
