/**
 * FollowLens Local data parser. Pure local processing. No network calls.
 * Uses Chrome's built-in DecompressionStream for deflated ZIP entries.
 */
const MAX_ARCHIVE_BYTES = 300 * 1024 * 1024;
const MAX_ENTRY_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED = 210 * 1024 * 1024;
const MAX_FILES = 100;
const decoder = new TextDecoder('utf-8', { fatal: true });
const FOLLOWER_RE = /^followers(?:_([1-9]\d*))?\.(json|html)$/i;
const FOLLOWING_RE = /^following\.(json|html)$/i;
const USERNAME_RE = /^[a-z0-9._]{1,30}$/i;
const RESERVED_PATHS = new Set(['accounts','explore','reels','reel','p','stories','direct','about','developer','privacy','legal','web','api','challenge']);

function fileDescriptor(path) {
  const normalized = path.replace(/\\/g, '/');
  const name = normalized.split('/').pop() || '';
  let match = FOLLOWER_RE.exec(name);
  if (match) return { kind: 'followers', part: match[1] ? Number(match[1]) : 1, format: match[2].toLowerCase(), path: normalized };
  if (FOLLOWING_RE.test(name)) return { kind: 'following', part: 0, format: name.split('.').pop().toLowerCase(), path: normalized };
  return null;
}

function normalizeUsername(value) {
  if (typeof value !== 'string') return null;
  let candidate = value.trim().replace(/^@/, '');
  if (/^https?:\/\//i.test(candidate)) {
    try {
      const u = new URL(candidate);
      if (!['instagram.com', 'www.instagram.com', 'm.instagram.com'].includes(u.hostname.toLowerCase())) return null;
      const paths = u.pathname.split('/').filter(Boolean);
      if (paths[0] === '_u') {
        if (paths.length !== 2) return null;
        candidate = paths[1];
      } else {
        if (paths.length !== 1 || RESERVED_PATHS.has(paths[0].toLowerCase())) return null;
        candidate = paths[0];
      }
    } catch { return null; }
  }
  if (candidate && USERNAME_RE.test(candidate) && candidate !== '.' && candidate !== '..') return candidate.toLowerCase();
  return null;
}

function usernameFromEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  for (const item of Array.isArray(entry.string_list_data) ? entry.string_list_data : []) {
    const user = normalizeUsername(item?.value) || normalizeUsername(item?.href);
    if (user) return user;
  }
  return normalizeUsername(entry.title) || normalizeUsername(entry.href);
}

function parseJSON(text, kind) {
  let data;
  try { data = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new Error('Tệp JSON không hợp lệ. Hãy tải lại bản export.'); }
  let entries;
  if (Array.isArray(data)) entries = data;
  else if (data && typeof data === 'object') {
    const keys = kind === 'followers'
      ? ['relationships_followers', 'followers']
      : ['relationships_following', 'following'];
    entries = keys.map(k => data[k]).find(Array.isArray);
  }
  if (!Array.isArray(entries)) throw new Error(`JSON không có danh sách ${kind} đúng cấu trúc Instagram.`);
  const names = new Set();
  let invalid = 0;
  for (const entry of entries) {
    const user = usernameFromEntry(entry);
    if (user) names.add(user);
    else invalid++;
  }
  if (entries.length > 0 && (names.size === 0 || invalid / entries.length > 0.05)) {
    throw new Error('Dữ liệu JSON có nhiều tài khoản không đọc được; từ chối để tránh báo sai.');
  }
  return { names, rawCount: entries.length, invalid };
}

function parseHTML(text) {
  if (typeof DOMParser === 'undefined') throw new Error('Đọc HTML cần trình duyệt Chrome.');
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const names = new Set();
  for (const a of doc.querySelectorAll('a[href]')) {
    const user = normalizeUsername(a.getAttribute('href'));
    if (user) names.add(user);
  }
  if (names.size === 0) throw new Error('Không tìm thấy tài khoản trong HTML. Hãy export dạng JSON để chính xác hơn.');
  return { names, rawCount: names.size, invalid: 0 };
}

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(data) {
  let crc = 0xffffffff;
  for (const x of data) crc = crcTable[(crc ^ x) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function extractZip(file) {
  if (file.size > MAX_ARCHIVE_BYTES) {
    throw new Error('ZIP quá lớn (>300 MB). Hãy export riêng Followers and following để nhẹ và riêng tư.');
  }
  const data = await file.arrayBuffer();
  const view = new DataView(data);
  let eocd = -1;
  for (let p = data.byteLength - 22; p >= Math.max(0, data.byteLength - 65557); p--) {
    if (view.getUint32(p, true) === 0x06054b50 && p + 22 + view.getUint16(p + 20, true) === data.byteLength) {
      eocd = p; break;
    }
  }
  if (eocd < 0) throw new Error('ZIP bị lỗi hoặc không đúng định dạng.');
  const entriesCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const cdSize = view.getUint32(eocd + 12, true);
  if (entriesCount === 0xffff || offset === 0xffffffff || cdSize === 0xffffffff) {
    throw new Error('ZIP64 chưa hỗ trợ. Hãy giải nén và chọn các tệp followers*.json + following.json.');
  }
  if (offset + cdSize > eocd || entriesCount > 100000) throw new Error('ZIP có thư mục tệp không hợp lệ.');
  const matches = [];
  let total = 0;
  for (let i = 0; i < entriesCount; i++) {
    if (offset + 46 > data.byteLength || view.getUint32(offset, true) !== 0x02014b50) throw new Error('ZIP có chỉ mục bị lỗi.');
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const expectedCRC = view.getUint32(offset + 16, true);
    const compressed = view.getUint32(offset + 20, true);
    const uncompressed = view.getUint32(offset + 24, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const next = offset + 46 + nameLen + extraLen + commentLen;
    if (next > data.byteLength) throw new Error('ZIP có tên tệp bị lỗi.');
    let filename;
    try { filename = decoder.decode(new Uint8Array(data, offset + 46, nameLen)); }
    catch { filename = ''; }
    const descriptor = fileDescriptor(filename);
    if (descriptor) {
      if (matches.length >= MAX_FILES) throw new Error('Có quá nhiều tệp followers.');
      if ((flags & 1) || ![0, 8].includes(method)) throw new Error('ZIP mã hóa hoặc nén không hỗ trợ.');
      if (uncompressed === 0xffffffff || compressed === 0xffffffff) throw new Error('ZIP64 chưa hỗ trợ.');
      if (uncompressed > MAX_ENTRY_BYTES) throw new Error('Một tệp trong ZIP quá lớn (>100 MB).');
      total += uncompressed;
      if (total > MAX_TOTAL_UNCOMPRESSED) throw new Error('Dữ liệu giải nén quá lớn (>210 MB).');
      matches.push({ descriptor, method, compressed, uncompressed, localOffset, expectedCRC });
    }
    offset = next;
  }
  if (!matches.length) throw new Error('Không thấy followers*.json hoặc following.json trong ZIP.');
  const out = [];
  for (const info of matches) {
    const loc = info.localOffset;
    if (loc + 30 > data.byteLength || view.getUint32(loc, true) !== 0x04034b50) throw new Error('ZIP có vị trí dữ liệu bị lỗi.');
    const payloadAt = loc + 30 + view.getUint16(loc + 26, true) + view.getUint16(loc + 28, true);
    if (payloadAt + info.compressed > data.byteLength) throw new Error('ZIP bị thiếu dữ liệu.');
    const compressedBytes = new Uint8Array(data, payloadAt, info.compressed);
    let bytes;
    if (info.method === 0) bytes = compressedBytes;
    else {
      try {
        const stream = new Blob([compressedBytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        bytes = new Uint8Array(await new Response(stream).arrayBuffer());
      } catch { throw new Error('Không giải nén được ZIP. Hãy giải nén thủ công rồi chọn JSON.'); }
    }
    if (bytes.length !== info.uncompressed || crc32(bytes) !== info.expectedCRC) {
      throw new Error('CRC/độ dài ZIP không khớp: từ chối dùng dữ liệu lỗi.');
    }
    let content;
    try { content = decoder.decode(bytes); }
    catch { throw new Error('Tệp trong ZIP không phải UTF-8 hợp lệ.'); }
    out.push({ ...info.descriptor, content });
  }
  return out;
}

async function readInputs(files) {
  const found = [];
  for (const file of files) {
    if (file.name.toLowerCase().endsWith('.zip')) {
      found.push(...await extractZip(file));
    } else {
      const descriptor = fileDescriptor(file.name);
      if (!descriptor) continue;
      if (file.size > MAX_ENTRY_BYTES) throw new Error('Tệp quá lớn (>100 MB).');
      found.push({ ...descriptor, content: await file.text() });
    }
  }
  return found;
}

export async function parseImport(files, { requireFollowing = true } = {}) {
  if (!files?.length) throw new Error('Chưa chọn file.');
  const found = await readInputs(Array.from(files));
  const followers = found.filter(f => f.kind === 'followers');
  const following = found.filter(f => f.kind === 'following');
  if (!followers.length) throw new Error('Thiếu followers_1.json (hoặc followers.json).');
  if (requireFollowing && !following.length) throw new Error('Thiếu following.json. Hãy chọn ZIP hoặc cả hai tệp JSON.');
  // Prevent mixed or duplicate snapshots, which would silently corrupt results.
  if (new Set(followers.map(f => f.part)).size !== followers.length || following.length > 1) {
    throw new Error('Phát hiện tệp trùng. Hãy chỉ chọn 1 bản export cho mỗi ô.');
  }
  const parts = followers.map(f => f.part).sort((a,b) => a-b);
  if (parts.some((p,i) => p !== i+1)) throw new Error('Thiếu một phần followers_N.json. Cần chọn đủ tất cả các phần.');
  const followerNames = new Set();
  const followingNames = new Set();
  for (const f of found) {
    const result = f.format === 'json' ? parseJSON(f.content, f.kind) : parseHTML(f.content);
    const dst = f.kind === 'followers' ? followerNames : followingNames;
    for (const n of result.names) dst.add(n);
  }
  if (!followerNames.size) throw new Error('Followers rỗng/không nhận dạng được; dừng để tránh kết quả sai.');
  if (requireFollowing && !followingNames.size) {
    throw new Error('Following rỗng/không nhận dạng được; dừng để tránh kết quả sai.');
  }
  return {
    followers: [...followerNames].sort(), following: [...followingNames].sort(),
    importedAt: new Date().toISOString(),
    source: files.length === 1 ? files[0].name : `${files.length} tệp`,
    followerParts: followers.length,
    format: found.some(f => f.format === 'html') ? 'HTML / JSON' : 'JSON'
  };
}

export function computeLists(current, baseline) {
  if (!current) return null;
  const F = new Set(current.followers);
  const G = new Set(current.following);
  const oldF = baseline ? new Set(baseline.followers) : null;
  const result = {
    notFollowingBack: current.following.filter(n => !F.has(n)),
    youDontFollowBack: current.followers.filter(n => !G.has(n)),
    mutual: current.following.filter(n => F.has(n)),
    lost: oldF ? baseline.followers.filter(n => !F.has(n)) : [],
    gained: oldF ? current.followers.filter(n => !oldF.has(n)) : [],
  };
  return result;
}
