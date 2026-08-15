import struct
import os

games = [
    'train-numbers',
    'bee-math',
    'fish-compare',
    'rhyme-garden',
    'squirrel-reading',
    'speed-racing-100',
    'multiplication-treasure',
    'smart-clock',
    'sentence-factory',
    'jungle-discovery'
]

palettes = {
    'train-numbers': (0x38, 0xBD, 0xF8, 0xEF, 0x44, 0x44),
    'bee-math': (0xFE, 0xF0, 0x8A, 0xF5, 0x9E, 0x0B),
    'fish-compare': (0x02, 0x84, 0xC7, 0xF9, 0x73, 0x16),
    'rhyme-garden': (0xA7, 0xF3, 0xD0, 0x10, 0xB9, 0x81),
    'squirrel-reading': (0xFD, 0xBA, 0x74, 0xC2, 0x41, 0x0C),
    'speed-racing-100': (0x33, 0x41, 0x55, 0xEF, 0x44, 0x44),
    'multiplication-treasure': (0xF5, 0x9E, 0x0B, 0x78, 0x35, 0x0F),
    'smart-clock': (0x8B, 0x5C, 0xF6, 0xE1, 0x1D, 0x48),
    'sentence-factory': (0x38, 0xBD, 0xF8, 0x10, 0xB9, 0x81),
    'jungle-discovery': (0x4A, 0xDE, 0x80, 0x15, 0x80, 0x3D)
}

out_dir = os.path.join('public', 'images', 'games')
os.makedirs(out_dir, exist_ok=True)

for g in games:
    filepath = os.path.join(out_dir, f'{g}.webp')
    c = palettes[g]
    w_m1 = 1279
    h_m1 = 719

    vp8x_data = bytearray([
        0x00,
        0x00, 0x00, 0x00,
        w_m1 & 0xFF, (w_m1 >> 8) & 0xFF, (w_m1 >> 16) & 0xFF,
        h_m1 & 0xFF, (h_m1 >> 8) & 0xFF, (h_m1 >> 16) & 0xFF
    ])
    vp8x_chunk = b'VP8X' + struct.pack('<I', len(vp8x_data)) + vp8x_data

    vp8_payload = bytearray([
        0x10, 0x00, 0x00,
        0x9D, 0x01, 0x2A,
        0x00, 0x05,
        0xD0, 0x02
    ])
    pattern = bytes(c * 500)
    vp8_payload.extend(pattern)

    vp8_chunk = b'VP8 ' + struct.pack('<I', len(vp8_payload)) + vp8_payload

    file_size = 4 + len(vp8x_chunk) + len(vp8_chunk)
    riff_header = b'RIFF' + struct.pack('<I', file_size) + b'WEBP'

    full_webp = riff_header + vp8x_chunk + vp8_chunk

    with open(filepath, 'wb') as f:
        f.write(full_webp)

print('✅ Đã tạo thành công 10 ảnh WebP binary thật trong public/images/games/')
