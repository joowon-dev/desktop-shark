import { describe, expect, it } from 'vitest'
import {
  collect, FIRST_SPECIES, isComplete, pickSpecies, SPECIES, SPECIES_ORDER, speciesOf,
} from '../src/game/species.js'
import { createEngine, lengthNow, releaseAndNext, snapshot, step } from '../src/game/engine.js'
import { DT, STAGE_THRESHOLDS } from '../src/game/constants.js'

const bounds = { w: 16 / 9, h: 1 }

describe('도감 목록', () => {
  it('여섯 종이고 순서가 못 박혀 있다', () => {
    expect(SPECIES_ORDER).toEqual(['white', 'tiger', 'hammer', 'thresher', 'saw', 'whale'])
    expect(Object.keys(SPECIES).sort()).toEqual([...SPECIES_ORDER].sort())
  })

  it('첫 상어는 백상아리다 — 첫 상어가 톱상어면 「상어」로 안 읽힌다', () => {
    expect(FIRST_SPECIES).toBe('white')
  })

  it('모든 종이 이름과 한 줄을 갖는다', () => {
    for (const key of SPECIES_ORDER) {
      expect(SPECIES[key].name, key).toBeTruthy()
      expect(SPECIES[key].hint, key).toBeTruthy()
    }
  })

  it('모르는 종을 물으면 첫 상어로 돌아간다 — 저장값이 낡아도 안 깨진다', () => {
    expect(speciesOf('없는종')).toBe(SPECIES[FIRST_SPECIES])
    expect(speciesOf(undefined)).toBe(SPECIES[FIRST_SPECIES])
  })

  it('종마다 실루엣이 실제로 다르다', () => {
    // 비율이 전부 같으면 여섯 마리가 한 마리다. 모양을 정하는 값의 조합이 다 달라야 한다.
    const shapes = SPECIES_ORDER.map((key) => {
      const s = SPECIES[key]
      return [s.size, s.depth, s.snout, s.dorsal, s.tail, s.extras.join('+')].join('/')
    })
    expect(new Set(shapes).size).toBe(SPECIES_ORDER.length)
  })

  it('고래상어가 제일 크고 제일 느리다', () => {
    const sizes = SPECIES_ORDER.map((k) => SPECIES[k].size)
    const speeds = SPECIES_ORDER.map((k) => SPECIES[k].speed)
    expect(SPECIES.whale.size).toBe(Math.max(...sizes))
    expect(SPECIES.whale.speed).toBe(Math.min(...speeds))
  })
})

describe('collect', () => {
  it('더한다', () => {
    expect(collect([], 'white')).toEqual(['white'])
  })

  it('같은 종을 두 번 안 넣는다', () => {
    expect(collect(['white'], 'white')).toEqual(['white'])
  })

  it('없는 종은 안 넣는다 — 도감이 오염되면 「다 모았다」가 영영 안 온다', () => {
    expect(collect(['white'], '가짜상어')).toEqual(['white'])
  })
})

describe('pickSpecies', () => {
  const rng = (values) => {
    let i = 0
    return () => values[i++ % values.length]
  }

  it('아직 도감에 없는 종을 준다', () => {
    // 이미 다섯을 모았으면 남은 하나가 나와야 한다. 안 그러면 마지막 한 종이
    // 운에 맡겨져서 도감이 안 채워진다.
    const collected = ['white', 'tiger', 'hammer', 'thresher', 'saw']
    for (const r of [0, 0.3, 0.7, 0.99]) {
      expect(pickSpecies(rng([r]), collected)).toBe('whale')
    }
  })

  it('다 모았으면 아무거나 준다', () => {
    const all = [...SPECIES_ORDER]
    expect(SPECIES_ORDER).toContain(pickSpecies(rng([0.5]), all))
  })

  it('아무것도 없으면 여섯 중 하나', () => {
    expect(SPECIES_ORDER).toContain(pickSpecies(rng([0.8]), []))
  })
})

describe('isComplete', () => {
  it('여섯을 다 모아야 끝이다', () => {
    expect(isComplete([])).toBe(false)
    expect(isComplete(SPECIES_ORDER.slice(0, 5))).toBe(false)
    expect(isComplete([...SPECIES_ORDER])).toBe(true)
  })
})

describe('엔진과 종', () => {
  it('종마다 몸 길이가 다르다', () => {
    const full = STAGE_THRESHOLDS[5]
    const whale = createEngine({ eaten: full, species: 'whale', bounds, now: 0 })
    const saw = createEngine({ eaten: full, species: 'saw', bounds, now: 0 })
    expect(lengthNow(whale)).toBeGreaterThan(lengthNow(saw))
    expect(lengthNow(whale) / lengthNow(saw)).toBeCloseTo(SPECIES.whale.size / SPECIES.saw.size, 6)
  })

  it('고래상어가 백상아리보다 느리게 헤엄친다', () => {
    const run = (species) => {
      let e = createEngine({ eaten: 0, lastFedAt: 0, species, seed: 3, bounds, now: 0 })
      let now = 0
      let travelled = 0
      let previous = { ...e.swimmer }
      for (let i = 0; i < 60 * 60; i += 1) {
        now += DT * 1000
        e = step(e, now, DT)
        travelled += Math.hypot(e.swimmer.x - previous.x, e.swimmer.y - previous.y)
        previous = { ...e.swimmer }
      }
      return travelled
    }
    expect(run('whale')).toBeLessThan(run('white'))
  })

  it('6단계에 닿으면 도감에 저절로 오른다', () => {
    // 따로 누를 것이 없어야 한다 — 다 키운 것을 알아채지 못하면 도감이 안 찬다.
    let e = createEngine({ eaten: STAGE_THRESHOLDS[5] - 1, species: 'tiger', bounds, now: 0 })
    expect(e.collected).toEqual([])

    e = { ...e, eaten: STAGE_THRESHOLDS[5] }
    e = step(e, 1000, DT)
    expect(e.collected).toEqual(['tiger'])
  })

  it('덜 자랐으면 도감에 안 오른다', () => {
    let e = createEngine({ eaten: STAGE_THRESHOLDS[5] - 1, species: 'tiger', bounds, now: 0 })
    e = step(e, 1000, DT)
    expect(e.collected).toEqual([])
  })

  it('snapshot 이 종과 도감을 함께 준다', () => {
    const e = createEngine({ species: 'hammer', collected: ['white'], bounds, now: 0 })
    const snap = snapshot(e)
    expect(snap.species).toBe('hammer')
    expect(snap.collected).toEqual(['white'])
  })
})

describe('releaseAndNext', () => {
  it('놓아주면 도감에 남고 누적은 0 이 된다', () => {
    const e = createEngine({
      eaten: STAGE_THRESHOLDS[5], species: 'white', seed: 9, bounds, now: 0,
    })
    const next = releaseAndNext(e, 5000)

    expect(next.collected).toContain('white')
    expect(next.eaten).toBe(0)
    expect(next.food).toEqual([])
    // 새 상어는 배부른 채로 온다 — 맞이하자마자 굶주려 있으면 인사가 안 된다.
    expect(next.lastFedAt).toBe(5000)
  })

  it('놓아준 종이 또 오지 않는다', () => {
    let e = createEngine({ eaten: STAGE_THRESHOLDS[5], species: 'white', seed: 4, bounds, now: 0 })
    const seen = ['white']

    // 다섯 번 놓아주면 여섯 종을 다 만나야 한다.
    for (let i = 0; i < 5; i += 1) {
      e = releaseAndNext({ ...e, eaten: STAGE_THRESHOLDS[5] }, 0)
      expect(seen, `${i}번째`).not.toContain(e.species)
      seen.push(e.species)
    }
    expect(isComplete(seen)).toBe(true)
  })

  it('밀린 줄도 비운다 — 놓아준 상어의 점수가 새 상어에 얹히면 안 된다', () => {
    const e = { ...createEngine({ species: 'white', bounds, now: 0 }), pending: 40 }
    expect(releaseAndNext(e, 0).pending).toBe(0)
  })
})
