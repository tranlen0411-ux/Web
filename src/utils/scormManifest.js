import { SCORM_VERSIONS } from '../constants/scormConstants.js';

/**
 * Phân tích tệp imsmanifest.xml của gói SCORM bằng DOMParser an toàn
 * @param {string} xmlText - Nội dung XML của tệp imsmanifest.xml
 * @returns {{
 *   scormVersion: string,
 *   title: string,
 *   launchPath: string,
 *   launchUrl: string,
 *   manifestPath: string,
 *   resourcesCount: number,
 *   itemsCount: number
 * }}
 */
export function parseScormManifest(xmlText) {
  if (!xmlText || typeof xmlText !== 'string') {
    throw new Error('Nội dung imsmanifest.xml rỗng hoặc không hợp lệ.');
  }

  // Khởi tạo DOMParser an toàn trong trình duyệt hoặc Node.js (với jsdom nếu có)
  let doc;
  if (typeof window !== 'undefined' && window.DOMParser) {
    const parser = new window.DOMParser();
    doc = parser.parseFromString(xmlText, 'application/xml');
  } else {
    // Trường hợp chạy trong Node.js testing environment (sử dụng xmldom hoặc DOMParser giả lập)
    try {
      const { JSDOM } = require('jsdom');
      const dom = new JSDOM();
      const parser = new dom.window.DOMParser();
      doc = parser.parseFromString(xmlText, 'application/xml');
    } catch {
      // Fallback parser tối giản cho node testing nếu jsdom chưa import
      doc = fallbackXmlParser(xmlText);
    }
  }

  // Kiểm tra lỗi parse XML
  const parseError = doc.querySelector ? doc.querySelector('parsererror') : null;
  if (parseError) {
    throw new Error('Cấu trúc XML của imsmanifest.xml không hợp lệ: ' + parseError.textContent);
  }

  // 1. Kiểm tra root <manifest>
  const manifestEl = doc.documentElement;
  if (!manifestEl || manifestEl.nodeName.toLowerCase().includes('manifest') === false) {
    throw new Error('Thẻ gốc không phải là <manifest>.');
  }

  // 2. Xác định phiên bản SCORM (1.2 hoặc 2004)
  let scormVersion = SCORM_VERSIONS.SCORM_12;
  const manifestXmlStr = xmlText.toLowerCase();

  // Kiểm tra thẻ <schemaversion>
  const schemaVersionEl = doc.getElementsByTagName('schemaversion')[0] || 
                          doc.getElementsByTagName('adlcp:schemaversion')[0];
  if (schemaVersionEl && schemaVersionEl.textContent) {
    const versionText = schemaVersionEl.textContent.trim().toLowerCase();
    if (versionText.includes('2004') || versionText.includes('cam 1.3')) {
      scormVersion = SCORM_VERSIONS.SCORM_2004;
    } else if (versionText.includes('1.2')) {
      scormVersion = SCORM_VERSIONS.SCORM_12;
    }
  } else {
    // Kiểm tra namespace trên thẻ manifest
    if (manifestXmlStr.includes('adlcp_v1p3') || manifestXmlStr.includes('2004')) {
      scormVersion = SCORM_VERSIONS.SCORM_2004;
    }
  }

  // 3. Đọc Title của gói
  let packageTitle = 'Bài học SCORM';
  const orgsEl = doc.getElementsByTagName('organizations')[0];
  const defaultOrgId = orgsEl?.getAttribute('default');

  let defaultOrgEl = null;
  const allOrgs = doc.getElementsByTagName('organization');
  for (let i = 0; i < allOrgs.length; i++) {
    const org = allOrgs[i];
    if (!defaultOrgId || org.getAttribute('identifier') === defaultOrgId) {
      defaultOrgEl = org;
      break;
    }
  }

  if (defaultOrgEl) {
    const titleEl = defaultOrgEl.getElementsByTagName('title')[0];
    if (titleEl && titleEl.textContent) {
      packageTitle = titleEl.textContent.trim();
    }
  }

  // 4. Tìm kiếm Resource và Launch File
  // Tìm <item identifierref="..."> đầu tiên trong organization
  let resourceIdentifierRef = null;
  if (defaultOrgEl) {
    const items = defaultOrgEl.getElementsByTagName('item');
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const idRef = item.getAttribute('identifierref');
      if (idRef) {
        resourceIdentifierRef = idRef;
        const itemTitleEl = item.getElementsByTagName('title')[0];
        if (itemTitleEl && itemTitleEl.textContent && packageTitle === 'Bài học SCORM') {
          packageTitle = itemTitleEl.textContent.trim();
        }
        break;
      }
    }
  }

  // Duyệt các <resource>
  const resources = doc.getElementsByTagName('resource');
  let chosenResource = null;

  for (let i = 0; i < resources.length; i++) {
    const res = resources[i];
    const resId = res.getAttribute('identifier');
    const href = res.getAttribute('href');

    // Ưu tiên resource khớp với identifierref của default organization
    if (resourceIdentifierRef && resId === resourceIdentifierRef && href) {
      chosenResource = res;
      break;
    }

    // Hoặc resource đầu tiên có href hợp lệ
    if (!chosenResource && href && (res.getAttribute('type') === 'webcontent' || res.getAttribute('adlcp:scormtype') === 'sco' || res.getAttribute('scormtype') === 'sco')) {
      chosenResource = res;
    }
  }

  // Nếu vẫn chưa thấy, lấy bất kỳ resource nào có href
  if (!chosenResource && resources.length > 0) {
    for (let i = 0; i < resources.length; i++) {
      if (resources[i].getAttribute('href')) {
        chosenResource = resources[i];
        break;
      }
    }
  }

  if (!chosenResource) {
    throw new Error('Gói SCORM không hợp lệ: Không tìm thấy tài nguyên (<resource>) nào trong imsmanifest.xml.');
  }

  const rawHref = chosenResource.getAttribute('href');
  if (!rawHref || rawHref.trim() === '') {
    throw new Error('Tài nguyên SCORM không chứa đường dẫn khởi chạy (thuộc tính href bị rỗng).');
  }

  // 5. Xử lý xml:base nếu có
  const resourcesEl = doc.getElementsByTagName('resources')[0];
  const resourcesBase = resourcesEl?.getAttribute('xml:base') || resourcesEl?.getAttribute('base') || '';
  const resourceBase = chosenResource.getAttribute('xml:base') || chosenResource.getAttribute('base') || '';
  
  // Ghép xml:base và href
  let combinedPath = [resourcesBase, resourceBase, rawHref.trim()]
    .filter(Boolean)
    .join('/')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/');

  if (combinedPath.startsWith('/')) {
    combinedPath = combinedPath.substring(1);
  }

  // Chặn Path Traversal trong launch href
  if (combinedPath.includes('../') || combinedPath.includes('..\\') || combinedPath.includes('\0')) {
    throw new Error(`Đường dẫn khởi chạy vi phạm an toàn (Path Traversal): "${combinedPath}".`);
  }

  // Tách query string / hash nếu có
  const [filePathOnly] = combinedPath.split(/[?#]/);

  return {
    scormVersion,
    title: packageTitle,
    launchPath: filePathOnly, // Tệp thực tế trong ZIP
    launchUrl: combinedPath,   // URL đầy đủ kèm query/hash nếu có
    manifestPath: 'imsmanifest.xml',
    resourcesCount: resources.length,
    itemsCount: doc.getElementsByTagName('item').length,
  };
}

/**
 * Phân tích các thuộc tính trong chuỗi XML tag
 */
function parseAttributes(attrString) {
  const attrs = {};
  if (!attrString) return attrs;
  const attrRegex = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;
  while ((match = attrRegex.exec(attrString)) !== null) {
    const key = match[1];
    const val = match[2] !== undefined ? match[2] : (match[3] !== undefined ? match[3] : match[4]);
    attrs[key] = val;
  }
  return attrs;
}

/**
 * Tạo đối tượng Node giả lập DOM
 */
function createElementNode(tagName, attrString, innerContent = '') {
  const attrs = parseAttributes(attrString);
  return {
    nodeName: tagName,
    textContent: innerContent.replace(/<[^>]+>/g, '').trim(),
    getAttribute: (name) => attrs[name] ?? null,
    parentElement: null,
    getElementsByTagName: (childTag) => findElements(innerContent, childTag),
  };
}

/**
 * Tìm tất cả thẻ phù hợp (hỗ trợ cả self-closing <tag ... /> và paired <tag ...>...</tag>)
 */
function findElements(xml, targetTag) {
  const results = [];
  if (!xml || typeof xml !== 'string') return results;
  const cleanTag = targetTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tagRegex = new RegExp(
    `<(${cleanTag})(?:\\s+([^>]*?))?(?:\\/\\s*>|>([\\s\\S]*?)<\\/\\1\\s*>)`,
    'gi'
  );
  let match;
  while ((match = tagRegex.exec(xml)) !== null) {
    const tagName = match[1];
    const attrString = match[2] || '';
    const innerContent = match[3] || '';
    const node = createElementNode(tagName, attrString, innerContent);
    results.push(node);
  }
  return results;
}

/**
 * Fallback XML parser cho môi trường Node.js testing
 */
function fallbackXmlParser(xmlText) {
  const isManifest = /<manifest[\s>]/i.test(xmlText);
  return {
    documentElement: isManifest ? { nodeName: 'manifest' } : null,
    getElementsByTagName: (tag) => findElements(xmlText, tag),
  };
}
