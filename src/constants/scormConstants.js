/**
 * Hằng số cấu hình và giới hạn an toàn cho SCORM Package Parser / Validator
 */
export const SCORM_LIMITS = {
  // Dung lượng tối đa của file .zip tải lên (20 MB)
  MAX_ZIP_SIZE: 20 * 1024 * 1024,

  // Tổng dung lượng sau khi giải nén tối đa (80 MB)
  MAX_TOTAL_UNCOMPRESSED_SIZE: 80 * 1024 * 1024,

  // Dung lượng tối đa của 1 file đơn lẻ bên trong gói (30 MB)
  MAX_SINGLE_FILE_SIZE: 30 * 1024 * 1024,

  // Số lượng file tối đa bên trong 1 gói SCORM (chống zip bomb)
  MAX_ENTRY_COUNT: 1000,

  // Độ sâu tối đa của thư mục bên trong gói
  MAX_PATH_DEPTH: 10,

  // Tỷ lệ nén tối đa cho phép (chống zip bomb)
  MAX_COMPRESSION_RATIO: 100,

  // Tên tệp manifest bắt buộc
  MANIFEST_FILENAME: 'imsmanifest.xml',
};

export const SCORM_VERSIONS = {
  SCORM_12: '1.2',
  SCORM_2004: '2004',
};

export const SCORM_STATUS = {
  PROCESSING: 'processing',
  READY: 'ready',
  FAILED: 'failed',
};
