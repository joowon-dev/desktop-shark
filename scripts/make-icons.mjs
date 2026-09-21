// 아이콘을 그려서 만든다. 그림 파일을 저장소에 넣어 두는 대신 코드로 만든다 —
// 색 하나 바꾸면 끝이고, 무엇을 그렸는지가 코드로 남는다. 불꽃놀이의 같은 파일에서 가져왔고
//
//   node scripts/make-icons.mjs
//     build/icon.png   512×512  앱 아이콘 (mac/build.sh 가 icns 로 바꾼다)
//     build/tray.png    44×44   메뉴바 아이콘 (템플릿 — 검정 + 알파, macOS 가 색을 입힌다)
//     windows/icon.ico 256×256  윈도우 아이콘 (PNG 를 담은 ico)
//
// 그림 부분만 상어로 바꿨다. 외부 라이브러리를 쓰지 않는다. PNG 는 zlib 만으로 만들 수 있고, ico 는 PNG 를
// 그대로 담을 수 있다(Vista 이후).

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// ── PNG 쓰기 ────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let c = -1
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** RGBA 픽셀 배열(Uint8ClampedArray, 길이 w*h*4) 을 PNG 버퍼로. */
function encodePng(pixels, width, height) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // 비트 깊이
  header[9] = 6 // 컬러 타입 6 = RGBA
  // 10~12 은 압축·필터·인터레이스 방식이고 전부 0 이 표준값이다.

  // 각 줄 앞에 필터 바이트 0(=필터 없음)을 붙인다.
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0
    for (let x = 0; x < width * 4; x += 1) {
      raw[y * (width * 4 + 1) + 1 + x] = pixels[y * width * 4 + x]
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** PNG 하나를 담은 .ico. 윈도우는 Vista 부터 이 형식을 읽는다. */
function encodeIco(png, size) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // 예약
  header.writeUInt16LE(1, 2) // 1 = 아이콘
  header.writeUInt16LE(1, 4) // 이미지 한 장

  const entry = Buffer.alloc(16)
  entry[0] = size >= 256 ? 0 : size // 256 은 0 으로 적는다
  entry[1] = size >= 256 ? 0 : size
  entry.writeUInt16LE(1, 4) // 색 평면
  entry.writeUInt16LE(32, 6) // 비트 수
  entry.writeUInt32BE(0, 8)
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(6 + 16, 12)

  return Buffer.concat([header, entry, png])
}

// ── 아주 작은 소프트웨어 래스터라이저 ────────────────────────────────────────
//
// 캔버스가 없으니 직접 찍는다. 계단이 안 보이도록 4 배로 그린 뒤 줄여서 담는다.

const SS = 4 // 초과 표본 배율

function makeSurface(size) {
  const side = size * SS
  return { side, size, data: new Float32Array(side * side * 4) }
}

/** 가산으로 한 점 찍기. */
function addPixel(surface, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= surface.side || y >= surface.side) return
  const i = ((y | 0) * surface.side + (x | 0)) * 4
  surface.data[i] += r * a
  surface.data[i + 1] += g * a
  surface.data[i + 2] += b * a
  surface.data[i + 3] += a
}

/** 덮어쓰기로 한 점 찍기. 배경처럼 불투명한 것에 쓴다. */
function setPixel(surface, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= surface.side || y >= surface.side) return
  const i = ((y | 0) * surface.side + (x | 0)) * 4
  surface.data[i] = r * a + surface.data[i] * (1 - a)
  surface.data[i + 1] = g * a + surface.data[i + 1] * (1 - a)
  surface.data[i + 2] = b * a + surface.data[i + 2] * (1 - a)
  surface.data[i + 3] = a + surface.data[i + 3] * (1 - a)
}

/** 모서리가 둥근 네모를 채운다. */
function roundedRect(surface, x0, y0, x1, y1, radius, rgb) {
  for (let y = Math.floor(y0); y < y1; y += 1) {
    for (let x = Math.floor(x0); x < x1; x += 1) {
      const dx = Math.max(x0 + radius - x, 0, x - (x1 - radius))
      const dy = Math.max(y0 + radius - y, 0, y - (y1 - radius))
      if (Math.hypot(dx, dy) <= radius) setPixel(surface, x, y, rgb[0], rgb[1], rgb[2], 1)
    }
  }
}

/** 굵기가 있는 선분. 끝으로 갈수록 옅어진다. */
function ray(surface, x0, y0, x1, y1, width, rgb, alpha) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0))
  for (let s = 0; s <= steps; s += 1) {
    // 길이가 0 인 선분(가운데 불씨)이면 s/steps 가 0/0 = NaN 이 되어 아무것도 안 찍힌다.
    const t = steps === 0 ? 0 : s / steps
    const x = x0 + (x1 - x0) * t
    const y = y0 + (y1 - y0) * t
    const fade = alpha * (1 - t * 0.75)
    const w = width * (1 - t * 0.5)
    for (let dy = -w; dy <= w; dy += 1) {
      for (let dx = -w; dx <= w; dx += 1) {
        const d = Math.hypot(dx, dy)
        if (d > w) continue
        addPixel(surface, x + dx, y + dy, rgb[0], rgb[1], rgb[2], fade * (1 - d / (w + 1)))
      }
    }
  }
}

/** 속이 꽉 찬 원. 테두리 한 픽셀만 부드럽게 깎는다. */
function disc(surface, cx, cy, radius, rgb, alpha) {
  for (let dy = -radius - 1; dy <= radius + 1; dy += 1) {
    for (let dx = -radius - 1; dx <= radius + 1; dx += 1) {
      const d = Math.hypot(dx, dy)
      if (d > radius + 1) continue
      const edge = Math.min(1, radius + 1 - d)
      addPixel(surface, cx + dx, cy + dy, rgb[0], rgb[1], rgb[2], alpha * edge)
    }
  }
}

/** 4 배로 그린 표면을 실제 크기 RGBA 로 줄인다. */
function resolve(surface) {
  const { size, side, data } = surface
  const out = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const i = ((y * SS + sy) * side + (x * SS + sx)) * 4
          r += data[i]; g += data[i + 1]; b += data[i + 2]; a += data[i + 3]
        }
      }
      const n = SS * SS
      const o = (y * size + x) * 4
      out[o] = Math.min(255, r / n)
      out[o + 1] = Math.min(255, g / n)
      out[o + 2] = Math.min(255, b / n)
      out[o + 3] = Math.min(255, a / n * 255)
    }
  }
  return out
}


// ── 그림 ────────────────────────────────────────────────────────────────────

const SKY = [23, 54, 78]
const SEA = [108, 156, 182]
const SEA_DEEP = [72, 118, 146]
const FOAM = [235, 247, 253]
const INK = [7, 17, 26]

/** 속을 채운 다각형. 지느러미는 곧은 변으로 그린다. */
function polygon(surface, points, rgb, alpha = 1) {
  let minY = Infinity, maxY = -Infinity
  for (const [, y] of points) { minY = Math.min(minY, y); maxY = Math.max(maxY, y) }

  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y += 1) {
    const crossings = []
    for (let i = 0; i < points.length; i += 1) {
      const [x0, y0] = points[i]
      const [x1, y1] = points[(i + 1) % points.length]
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
        crossings.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0))
      }
    }
    crossings.sort((a, b) => a - b)
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      for (let x = Math.floor(crossings[i]); x <= Math.ceil(crossings[i + 1]); x += 1) {
        setPixel(surface, x, y, rgb[0], rgb[1], rgb[2], alpha)
      }
    }
  }
}

/** 수면 아래를 채운다. 사인 한 번으로 물결을 준다. */
function water(surface, baseline, amplitude, rgb, alpha = 1) {
  for (let x = 0; x < surface.side; x += 1) {
    const top = baseline + Math.sin((x / surface.side) * Math.PI * 2.4 + 0.6) * amplitude
    for (let y = Math.floor(top); y < surface.side; y += 1) {
      setPixel(surface, x, y, rgb[0], rgb[1], rgb[2], alpha)
    }
  }
}

/**
 * 등지느러미. 뒤(왼쪽)로 눕고 **뒷변이 오목하다** — 이 오목한 변 하나가
 * 삼각형과 상어 지느러미를 가른다.
 */
function dorsal(surface, side, tipX, tipY, baseLeft, baseRight, baseY, rgb) {
  const points = [[baseRight, baseY], [tipX, tipY]]
  // 뒷변을 여러 점으로 나눠 안쪽으로 휘게 한다.
  const steps = 12
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps
    const x = tipX + (baseLeft - tipX) * t
    const y = tipY + (baseY - tipY) * t
    // 오목하게 — 직선에서 오른쪽(앞쪽)으로 밀어낸다.
    points.push([x + Math.sin(t * Math.PI) * side * 0.055, y])
  }
  polygon(surface, points, rgb)
}

/**
 * 앱 아이콘 — 수면 위로 등지느러미 하나.
 *
 * 상어를 통째로 그리지 않는다. **지느러미만 보이는 것**이 이 게임이고,
 * 16 픽셀로 줄여도 알아볼 수 있는 실루엣도 그것뿐이다.
 */
function appIcon(size) {
  const s = makeSurface(size)
  const side = s.side
  roundedRect(s, 0, 0, side, side, side * 0.22, SKY)

  // 물. 아래로 갈수록 짙다.
  water(s, side * 0.58, side * 0.022, SEA)
  water(s, side * 0.78, side * 0.030, SEA_DEEP)

  // 지느러미 — 밑동이 수면 아래로 조금 잠긴다.
  dorsal(s, side, side * 0.58, side * 0.22, side * 0.28, side * 0.66, side * 0.62, INK)

  // 물살 — 지느러미 **뒤에서** 벌어지는 두 줄. 앞에서 모이면 화살표가 된다.
  for (const sign of [-1, 1]) {
    ray(s, side * 0.30, side * 0.60 + sign * side * 0.012,
        side * 0.04, side * 0.60 + sign * side * 0.125,
        side * 0.013, FOAM, 0.9)
  }

  return encodePng(resolve(s), size, size)
}

/**
 * 메뉴바 아이콘 — 템플릿이라 **검정 + 알파로만** 그린다. macOS 가 색을 입힌다.
 * 색을 넣으면 다크 모드에서 안 보인다.
 */
function trayIcon(size) {
  const s = makeSurface(size)
  const side = s.side

  dorsal(s, side, side * 0.64, side * 0.14, side * 0.26, side * 0.74, side * 0.66, [0, 0, 0])

  // 물살 두 줄
  for (const [y, alpha] of [[side * 0.80, 0.85], [side * 0.93, 0.5]]) {
    for (let x = side * 0.06; x < side * 0.80; x += 1) {
      for (let dy = -side * 0.02; dy <= side * 0.02; dy += 1) {
        setPixel(s, x, y + dy, 0, 0, 0, alpha)
      }
    }
  }

  return encodePng(resolve(s), size, size)
}

// ── 내보내기 ────────────────────────────────────────────────────────────────

mkdirSync(join(root, 'build'), { recursive: true })
mkdirSync(join(root, 'windows'), { recursive: true })

const app512 = appIcon(512)
writeFileSync(join(root, 'build/icon.png'), app512)

writeFileSync(join(root, 'build/tray.png'), trayIcon(22))
writeFileSync(join(root, 'build/tray@2x.png'), trayIcon(44))

writeFileSync(join(root, 'windows/icon.ico'), encodeIco(appIcon(256), 256))

console.log('› build/icon.png · build/tray.png · build/tray@2x.png · windows/icon.ico')
