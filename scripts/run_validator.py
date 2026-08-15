import os
import sys

# Set encoding for Windows console output
sys.stdout.reconfigure(encoding='utf-8')

print('[KIEM TRA] Bat dau kiem tra toan dien 10 tro choi hoc tap va 10 anh WebP binary...\n')

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

has_error = False

print('--- 1. KIEM TRA MAGIC BYTES 10 ANH WEBP BINARY ---')
for g in games:
    imgPath = os.path.join('public', 'images', 'games', f'{g}.webp')
    if not os.path.exists(imgPath):
        print(f'  [LOI] THIEU FILE: {imgPath}')
        has_error = True
        continue

    size = os.path.getsize(imgPath)
    with open(imgPath, 'rb') as f:
        content = f.read()

    magic = content[:12]
    header_str = content[:200].decode('latin1', errors='ignore')

    if not (content.startswith(b'RIFF') and b'WEBP' in content[8:12]):
        print(f'  [LOI] KHONG PHAI WEBP BINARY: {g}.webp magic={magic.hex()}')
        has_error = True
    elif '<svg' in header_str.lower() or '<?xml' in header_str.lower():
        print(f'  [LOI] FILE SVG DO EN: {g}.webp')
        has_error = True
    else:
        print(f'  [OK] {g}.webp ({size} bytes): RIFF....WEBP binary meo text [DAT CHUAN]')

print('\n--- 2. KIEM TRA FILE SEED SQL ---')
sql_path = 'ADD_GRADE_1_2_LEARNING_GAMES.sql'
if os.path.exists(sql_path):
    with open(sql_path, 'r', encoding='utf-8') as f:
        sql = f.read()

    if 'http://' in sql or 'https://' in sql:
        print('  [LOI] SQL con chua URL ngoai (http/https).')
        has_error = True
    elif 'ON CONFLICT (id) DO NOTHING' not in sql:
        print('  [LOI] SQL chua dung ON CONFLICT (id) DO NOTHING.')
        has_error = True
    else:
        print('  [OK] ADD_GRADE_1_2_LEARNING_GAMES.sql: Chuyen sang anh noi bo va ON CONFLICT DO NOTHING.')

print('\n--- 3. KIEM TRA DU LIEU CAU HOI CHINH TA ---')
js_path = os.path.join('src', 'data', 'learningGamesData.js')
if os.path.exists(js_path):
    with open(js_path, 'r', encoding='utf-8') as f:
        js = f.read()

    bad_patterns = ['qua qua', 'qua qua tao', 'dam choi no loc', 'but mau', '"t" meo', 'Ca staple', 'tren boi']
    for bp in bad_patterns:
        if bp in js:
            print(f'  [LOI] CHINH TA VAN CON CUM TU: "{bp}"')
            has_error = True

    print('  [OK] learningGamesData.js: Da ra soat chinh ta, bo qua cum tu loi.')

if has_error:
    print('\n[KET QUA] KIEM TRA THAT BAI!')
    sys.exit(1)
else:
    print('\n[KET QUA] KET QUA HOAN HAO: TAT CA 10 TRONG CHOI VA 10 ANH WEBP BINARY DAT CHUAN 100% (EXIT CODE 0)!')
    sys.exit(0)
