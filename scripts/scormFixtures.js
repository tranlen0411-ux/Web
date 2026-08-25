import JSZip from 'jszip';

/**
 * ====================================================================
 * SCORM LOCAL TEST FIXTURES GENERATOR
 * Tạo các gói SCORM fixture phục vụ kiểm thử cục bộ (Không dùng thương mại)
 * ====================================================================
 */

/**
 * Fixture A: SCORM 1.2 Tối giản
 */
export async function createFixtureA_Scorm12() {
  const zip = new JSZip();

  zip.file(
    'imsmanifest.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="MANIFEST_FIXTURE_A" version="1.1" 
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2" 
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="ORG_FIXTURE_A">
    <organization identifier="ORG_FIXTURE_A">
      <title>Bài Học Toán 1 - Phép Cộng</title>
      <item identifier="ITEM_01" identifierref="RES_01">
        <title>Khởi động phép cộng</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES_01" type="webcontent" adlcp:scormtype="sco" href="index.html">
      <file href="index.html" />
    </resource>
  </resources>
</manifest>`
  );

  zip.file(
    'index.html',
    `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>SCORM 1.2 Lesson</title></head>
<body>
  <h1>Bài học Toán SCORM 1.2</h1>
  <button id="finishBtn">Hoàn thành bài học</button>
  <script>
    var api = window.API || (window.parent && window.parent.API);
    if (api) {
      api.LMSInitialize("");
      api.LMSSetValue("cmi.core.lesson_status", "incomplete");
      api.LMSCommit("");
    }
    document.getElementById("finishBtn").onclick = function() {
      if (api) {
        api.LMSSetValue("cmi.core.lesson_status", "completed");
        api.LMSCommit("");
        api.LMSFinish("");
      }
    };
  </script>
</body>
</html>`
  );

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  return { zip, buffer, name: 'fixture_a_scorm12.zip' };
}

/**
 * Fixture B: SCORM 2004 Tối giản
 */
export async function createFixtureB_Scorm2004() {
  const zip = new JSZip();

  zip.file(
    'imsmanifest.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="MANIFEST_FIXTURE_B" version="1.0" 
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1" 
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 3rd Edition</schemaversion>
  </metadata>
  <organizations default="ORG_FIXTURE_B">
    <organization identifier="ORG_FIXTURE_B">
      <title>Khoa Học Tự Nhiên SCORM 2004</title>
      <item identifier="ITEM_2004" identifierref="RES_2004">
        <title>Thế Giới Tự Nhiên</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES_2004" type="webcontent" adlcp:scormtype="sco" href="content/launch.html">
      <file href="content/launch.html" />
    </resource>
  </resources>
</manifest>`
  );

  zip.file(
    'content/launch.html',
    `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>SCORM 2004 Lesson</title></head>
<body>
  <h1>Bài học Khoa học SCORM 2004</h1>
  <script>
    var api = window.API_1484_11 || (window.parent && window.parent.API_1484_11);
    if (api) {
      api.Initialize("");
      api.SetValue("cmi.completion_status", "completed");
      api.Commit("");
      api.Terminate("");
    }
  </script>
</body>
</html>`
  );

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  return { zip, buffer, name: 'fixture_b_scorm2004.zip' };
}

/**
 * Fixture C: Manifest Không Hợp Lệ (Invalid / Malformed XML)
 */
export async function createFixtureC_InvalidManifest() {
  const zip = new JSZip();

  zip.file(
    'imsmanifest.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="BROKEN_MANIFEST">
  <organizations default="ORG">
    <organization identifier="ORG"><title>Lỗi Manifest</title></organization>
  </organizations>
  <!-- THIẾU THẺ RESOURCES HOẶC RESOURCE RỖNG -->
  <resources>
  </resources>
</manifest>`
  );

  zip.file('content.html', '<h1>Nội dung không có resource trong manifest</h1>');

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  return { zip, buffer, name: 'fixture_c_invalid_manifest.zip' };
}

/**
 * Fixture D: Path Traversal Malicious Zip (Tệp độc hại cố vượt khỏi thư mục gốc)
 */
export async function createFixtureD_PathTraversal() {
  const zip = new JSZip();

  zip.file(
    'imsmanifest.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="TRAVERSAL_MANIFEST" version="1.1">
  <resources>
    <resource identifier="RES" type="webcontent" href="index.html" />
  </resources>
</manifest>`
  );

  // Thêm tệp chứa đường dẫn nguy hiểm
  zip.file('../../malicious_payload.js', 'console.log("Attack attempt");');
  zip.file('index.html', '<h1>Normal page</h1>');

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  return { zip, buffer, name: 'fixture_d_path_traversal.zip' };
}

/**
 * Fixture E: Gói SCORM với Relative CSS/Image/JS paths
 */
export async function createFixtureE_RelativeAssets() {
  const zip = new JSZip();

  zip.file(
    'imsmanifest.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="MANIFEST_FIXTURE_E" version="1.1" xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="ORG_E">
    <organization identifier="ORG_E">
      <title>Bài Học Đa Phương Tiện Đầy Đủ Assets</title>
      <item identifier="ITEM_E" identifierref="RES_E">
        <title>Bài 1: Cấu trúc tương đối</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES_E" type="webcontent" adlcp:scormtype="sco" href="pages/lesson.html">
      <file href="pages/lesson.html" />
      <file href="assets/styles/main.css" />
      <file href="assets/scripts/main.js" />
      <file href="assets/images/diagram.png" />
    </resource>
  </resources>
</manifest>`
  );

  zip.file(
    'pages/lesson.html',
    `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Lesson with Relative Assets</title>
  <link rel="stylesheet" href="../assets/styles/main.css">
</head>
<body>
  <div class="card">
    <h1 id="title">Bài học có Relative Assets</h1>
    <img src="../assets/images/diagram.png" alt="Sơ đồ" id="diagramImg">
  </div>
  <script src="../assets/scripts/main.js"></script>
</body>
</html>`
  );

  zip.file(
    'assets/styles/main.css',
    `body { background-color: #f8fafc; font-family: sans-serif; }
.card { padding: 20px; background: white; border-radius: 8px; }
#title { color: #1e293b; }`
  );

  zip.file(
    'assets/scripts/main.js',
    `console.log("Relative JS asset loaded successfully");
if (window.API) {
  window.API.LMSInitialize("");
}`
  );

  // 1x1 transparent PNG data bytes
  const png1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
  zip.file('assets/images/diagram.png', png1x1);

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  return { zip, buffer, name: 'fixture_e_relative_assets.zip' };
}
