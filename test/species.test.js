import { describe, expect, it } from 'vitest'
import {
  FIRST_SPECIES, FULL_GROWN, isComplete, isUnlocked, nextUnlock, SPECIES, SPECIES_ORDER,
  speciesOf, unlockedSpecies,
} from '../src/game/species.js'
import {
  chooseSpecies, createEngine, feedAt, lengthNow, pinStage, setFrozen, snapshot, step,
} from '../src/game/engine.js'
import { DT, FOOD_KINDS, SPECIES_UNLOCK, STAGE_THRESHOLDS } from '../src/game/constants.js'

/** 상어가 밥을 먹을 때까지 굴린다. */
function runUntilEaten(engine, seconds = 60) {
  let e = engine
  let now = e.now
  for (let i = 0; i < seconds * 60; i += 1) {
    now += DT * 1000
    e = step(e, now, DT)
    if (e.justAte) return e
  }
  return null
}

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

describe('종 해금 — 자물쇠가 둘이다', () => {
  const full = {}
  for (const key of SPECIES_ORDER) full[key] = FULL_GROWN

  it('문턱이 SPECIES_ORDER 와 자리가 맞고 갈수록 커진다', () => {
    expect(SPECIES_UNLOCK).toHaveLength(SPECIES_ORDER.length)
    expect(SPECIES_UNLOCK[0]).toBe(0)
    for (let i = 1; i < SPECIES_UNLOCK.length; i += 1) {
      expect(SPECIES_UNLOCK[i]).toBeGreaterThan(SPECIES_UNLOCK[i - 1])
    }
  })

  it('처음에는 백상아리 하나뿐이다', () => {
    expect(unlockedSpecies(0, {})).toEqual(['white'])
  })

  it('**점수만 쌓아서는 안 열린다** — 앞 종을 다 키워야 한다', () => {
    // 아무리 많이 먹여도 백상아리를 안 키웠으면 뱀상어는 안 열린다.
    expect(unlockedSpecies(999999, {})).toEqual(['white'])
    expect(unlockedSpecies(999999, { white: FULL_GROWN - 1 })).toEqual(['white'])
  })

  it('**다 키우기만 해서도 안 열린다** — 점수 문턱도 넘어야 한다', () => {
    expect(unlockedSpecies(SPECIES_UNLOCK[1] - 1, { white: FULL_GROWN })).toEqual(['white'])
    expect(unlockedSpecies(SPECIES_UNLOCK[1], { white: FULL_GROWN })).toEqual(['white', 'tiger'])
  })

  it('**건너뛰기가 없다** — 앞이 막히면 뒤도 다 막힌다', () => {
    // 귀상어를 아무리 키워 두었어도 뱀상어를 안 키웠으면 거기서 끊긴다.
    const skipped = { white: FULL_GROWN, hammer: FULL_GROWN, thresher: FULL_GROWN }
    expect(unlockedSpecies(999999, skipped)).toEqual(['white', 'tiger'])
  })

  it('앞 종을 차례로 다 키우면 하나씩 열린다', () => {
    const grown = {}
    for (let i = 1; i < SPECIES_ORDER.length; i += 1) {
      grown[SPECIES_ORDER[i - 1]] = FULL_GROWN
      expect(unlockedSpecies(999999, grown), `${i}번째`).toHaveLength(i + 1)
    }
  })

  it('isUnlocked 가 목록과 어긋나지 않는다', () => {
    for (const [total, grown] of [[0, {}], [999999, {}], [999999, full], [SPECIES_UNLOCK[2], full]]) {
      const list = unlockedSpecies(total, grown)
      for (const key of SPECIES_ORDER) {
        expect(isUnlocked(key, total, grown), `${total}점 ${key}`).toBe(list.includes(key))
      }
    }
  })

  it('다음 종에 **무엇이 모자란지** 둘 다 알려 준다', () => {
    // 「왜 안 열리지」를 화면에서 답할 수 있어야 한다.
    expect(nextUnlock(0, {})).toEqual({
      species: 'tiger', raiseSpecies: 'white', raise: FULL_GROWN, score: SPECIES_UNLOCK[1],
    })
    // 점수는 됐고 키우기만 남았을 때
    expect(nextUnlock(SPECIES_UNLOCK[1], { white: FULL_GROWN - 500 }))
      .toMatchObject({ species: 'tiger', raise: 500, score: 0 })
    // 키우기는 됐고 점수만 남았을 때
    expect(nextUnlock(SPECIES_UNLOCK[1] - 300, { white: FULL_GROWN }))
      .toMatchObject({ species: 'tiger', raise: 0, score: 300 })
    // 다 열었으면 null
    expect(nextUnlock(999999, full)).toBe(null)
  })

  it('다 열리는 데 한 주 남짓이다', () => {
    // 앞 종을 다 키워야 하므로 최소 필요 점수는 (종 수 - 1) × 한 마리 값이다.
    // 보통 리듬에서 시간당 5~6천 점, 하루 세 시간(실제로 재 봤다).
    const need = Math.max(SPECIES_UNLOCK[5], (SPECIES_ORDER.length - 1) * FULL_GROWN)
    const days = need / 5500 / 3
    expect(days).toBeGreaterThan(4)
    expect(days).toBeLessThan(11)
  })

  it('isComplete 는 여섯 종이 다 열렸을 때다', () => {
    expect(isComplete(0, {})).toBe(false)
    expect(isComplete(999999, {})).toBe(false)
    expect(isComplete(999999, full)).toBe(true)
  })
})

describe('종마다 따로 키운다', () => {
  it('지금 데리고 있는 종만 자란다', () => {
    let e = createEngine({ species: 'white', bounds, now: 0 })
    e = feedAt(e, bounds.w / 2, 0.5)
    const after = runUntilEaten(e)

    expect(after.grown.white).toBe(FOOD_KINDS.big.value)
    expect(after.grown.tiger).toBeUndefined()
    expect(after.total).toBe(FOOD_KINDS.big.value)
  })

  it('종을 바꾸면 그 종의 단계로 보인다 — **되돌아갈 수 있다**', () => {
    const e = createEngine({
      total: 200000,
      grown: { white: 18000, tiger: 1200 },
      species: 'white', bounds, now: 0,
    })
    expect(snapshot(e).stage).toBe(6)
    expect(snapshot(chooseSpecies(e, 'tiger')).stage).toBe(2)
    // 고래상어는 아직 안 열렸다 — 앞 종들을 다 키우지 않았으니 바뀌지 않는다.
    expect(chooseSpecies(e, 'whale').species).toBe('white')
  })

  it('안 키운 종을 데려오면 1단계부터다', () => {
    const grown = {}
    for (const key of SPECIES_ORDER) grown[key] = FULL_GROWN
    // 고래상어만 아직 안 키웠다.
    delete grown.whale
    const e = createEngine({ total: 999999, grown, species: 'white', bounds, now: 0 })
    expect(snapshot(chooseSpecies(e, 'whale')).stage).toBe(1)
  })

  it('안 열린 종으로는 못 바꾼다', () => {
    const e = createEngine({ total: 0, species: 'white', bounds, now: 0 })
    expect(chooseSpecies(e, 'whale').species).toBe('white')
  })
})

describe('고정', () => {
  it('고정하면 그 종은 안 자란다', () => {
    let e = setFrozen(createEngine({ species: 'white', bounds, now: 0 }), true)
    e = feedAt(e, bounds.w / 2, 0.5)
    const after = runUntilEaten(e)
    expect(after.grown.white ?? 0).toBe(0)
  })

  it('**고정해도 전체 누적은 쌓인다** — 다음 종은 계속 열린다', () => {
    let e = setFrozen(createEngine({ species: 'white', bounds, now: 0 }), true)
    e = feedAt(e, bounds.w / 2, 0.5)
    const after = runUntilEaten(e)
    expect(after.total).toBe(FOOD_KINDS.big.value)
  })

  it('풀면 다시 자란다', () => {
    let e = setFrozen(createEngine({ species: 'white', bounds, now: 0 }), true)
    e = setFrozen(e, false)
    e = feedAt(e, bounds.w / 2, 0.5)
    expect(runUntilEaten(e).grown.white).toBe(FOOD_KINDS.big.value)
  })
})

describe('단계 못 박기', () => {
  const grown6 = () => createEngine({
    total: 200000, grown: { white: 18000 }, species: 'white', bounds, now: 0,
  })

  it('지나온 단계로 돌아갈 수 있다', () => {
    for (let stage = 1; stage <= 6; stage += 1) {
      expect(snapshot(pinStage(grown6(), stage)).stage).toBe(stage)
    }
  })

  it('**안 키운 단계는 못 본다** — 미리 보기가 아니다', () => {
    const baby = createEngine({ total: 200000, grown: { white: 0 }, species: 'white', bounds, now: 0 })
    // 못 박는 자리에서 한 번, 보여 주는 자리에서 한 번 — 두 군데 다 막는다.
    expect(pinStage(baby, 6).pinnedStage).toBe(1)
    expect(snapshot(pinStage(baby, 6)).stage).toBe(1)
    // 저장값이 낡아서 곧바로 높은 단계가 들어와도 안 뚫린다.
    expect(snapshot({ ...baby, pinnedStage: 6 }).stage).toBe(1)
  })

  it('풀면 키운 만큼 보여 준다', () => {
    const e = pinStage(grown6(), 2)
    expect(snapshot(e).stage).toBe(2)
    expect(snapshot(pinStage(e, null)).stage).toBe(6)
  })

  it('종을 바꾸면 못 박기가 풀린다 — 종마다 키운 만큼이 다르다', () => {
    const e = pinStage(createEngine({
      total: 200000, grown: { white: 18000, tiger: 10500 }, species: 'white', bounds, now: 0,
    }), 2)
    expect(chooseSpecies(e, 'tiger').pinnedStage).toBe(null)
  })
})
