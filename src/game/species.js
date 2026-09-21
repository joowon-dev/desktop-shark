// 상어 종류. **모양만 다르고 규칙은 같다** — 어떤 종이든 밥을 먹고 여섯 단계로 자란다.
//
// 실루엣은 숫자 몇 개로 정한다. 종마다 윤곽을 통째로 그려 두면 여섯 벌을 따로 손봐야
// 하고, 한 종만 고쳐도 나머지가 어긋난다. 몸의 비율을 조절하는 값으로 두면 한 벌이
// 여섯 마리를 만든다.
//
// 값은 전부 손맛이다. 실제 상어의 비율을 재서 넣은 것이 아니라, **작게 줄여도 서로
// 구별되는가**만 보고 정했다.

/**
 * @typedef {object} Species
 * @property {string} name  도감에 적는 이름
 * @property {string} hint  도감에 적는 한 줄
 * @property {number} size  몸 길이 배율
 * @property {number} speed 헤엄 속력 배율
 * @property {number} depth 몸통 두께 배율 (1 보다 크면 통통하다)
 * @property {number} snout 코 길이 배율
 * @property {number} dorsal 등지느러미 높이 배율
 * @property {number} tail  꼬리 위 갈래 길이 배율
 * @property {string[]} extras 특수한 모양 ('hammer' · 'saw')
 */

export const SPECIES = {
  white: {
    name: '백상아리',
    hint: '가장 흔하고 가장 상어답다. 처음 만나는 상어.',
    size: 1.0, speed: 1.0, depth: 0.95, snout: 1.15, dorsal: 1.0, tail: 1.0, extras: [],
  },
  tiger: {
    name: '뱀상어',
    hint: '통통하고 코가 뭉툭하다. 아무거나 먹는 것으로 유명하다.',
    size: 1.05, speed: 0.92, depth: 1.30, snout: 0.60, dorsal: 0.78, tail: 1.05, extras: [],
  },
  hammer: {
    name: '귀상어',
    hint: '머리가 옆으로 뻗었다. 실루엣만 봐도 안다.',
    size: 0.95, speed: 1.05, depth: 0.88, snout: 0.55, dorsal: 1.35, tail: 0.95,
    extras: ['hammer'],
  },
  thresher: {
    name: '환도상어',
    hint: '꼬리가 몸만큼 길다. 그 꼬리로 먹이를 친다.',
    size: 1.0, speed: 1.1, depth: 0.85, snout: 0.8, dorsal: 0.8, tail: 2.4, extras: [],
  },
  saw: {
    name: '톱상어',
    hint: '코가 톱이다. 바닥을 훑어 먹는다.',
    size: 0.85, speed: 0.88, depth: 0.78, snout: 1.0, dorsal: 0.7, tail: 1.0,
    extras: ['saw'],
  },
  whale: {
    name: '고래상어',
    hint: '가장 크고 가장 느리다. 그리고 아무도 해치지 않는다.',
    size: 1.45, speed: 0.62, depth: 1.35, snout: 0.5, dorsal: 0.75, tail: 1.15, extras: [],
  },
}

/** 도감에 적히는 순서. 객체 키 순서에 기대지 않는다. */
export const SPECIES_ORDER = ['white', 'tiger', 'hammer', 'thresher', 'saw', 'whale']

/** 처음 만나는 종. 백상아리로 고정한다 — 첫 상어가 톱상어면 「상어」로 안 읽힌다. */
export const FIRST_SPECIES = 'white'

export function speciesOf(key) {
  return SPECIES[key] ?? SPECIES[FIRST_SPECIES]
}

/**
 * 다음에 맞이할 종을 고른다.
 *
 * **아직 도감에 없는 종을 먼저 준다.** 다 모으기 전에 같은 종이 또 오면 도감이
 * 채워지지 않고, 그러면 모으는 일이 운에 맡겨진다. 다 모았으면 아무거나 준다.
 *
 * @param {() => number} rng
 * @param {string[]} collected 이미 도감에 있는 종
 */
export function pickSpecies(rng, collected = []) {
  const left = SPECIES_ORDER.filter((key) => !collected.includes(key))
  const pool = left.length > 0 ? left : SPECIES_ORDER
  return pool[Math.floor(rng() * pool.length) % pool.length]
}

/** 도감을 다 채웠는가. */
export function isComplete(collected = []) {
  return SPECIES_ORDER.every((key) => collected.includes(key))
}

/** 도감에 한 종을 더한다. 중복은 안 넣는다. */
export function collect(collected, key) {
  if (!SPECIES_ORDER.includes(key) || collected.includes(key)) return collected
  return [...collected, key]
}
