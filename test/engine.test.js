import { describe, expect, it } from 'vitest'
import {
  createEngine, feedAt, feedTyped, mouthOf, setGameMode, snapshot, step,
} from '../src/game/engine.js'
import { DT, FOOD_KINDS, MAX_FOOD, TYPE_FEED_INTERVAL } from '../src/game/constants.js'

const bounds = { w: 16 / 9, h: 1 }

/** 상어가 밥을 먹을 때까지 굴린다. 못 먹으면 null. */
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

describe('밥을 주면 달려와서 먹는다', () => {
  it('화면 한가운데 떨어뜨리면 결국 먹는다', () => {
    // **이 게임의 핵심 약속이다.** 이게 깨지면 나머지가 다 맞아도 게임이 아니다.
    let e = createEngine({ eaten: 0, lastFedAt: 0, seed: 3, bounds, now: 0 })
    e = feedAt(e, bounds.w / 2, 0.5)

    const eaten = runUntilEaten(e)
    expect(eaten).not.toBe(null)
    expect(eaten.eaten).toBe(FOOD_KINDS.big.value)
    expect(eaten.food).toHaveLength(0)
  })

  it('화면 구석에 떨어뜨려도 먹는다', () => {
    for (const [x, y] of [[0.1, 0.1], [bounds.w - 0.1, 0.1], [0.1, 0.9], [bounds.w - 0.1, 0.9]]) {
      let e = createEngine({ eaten: 0, lastFedAt: 0, seed: 11, bounds, now: 0 })
      e = feedAt(e, x, y)
      expect(runUntilEaten(e), `(${x}, ${y})`).not.toBe(null)
    }
  })

  it('먹으면 배고픔 시계가 0 으로 돌아간다', () => {
    const start = 10 * 60 * 60 * 1000 // 굶은 지 오래
    let e = createEngine({ eaten: 0, lastFedAt: 0, seed: 5, bounds, now: start })
    expect(snapshot(e).hunger).toBe(1)

    e = feedAt(e, bounds.w / 2, 0.5)
    const eaten = runUntilEaten(e)
    expect(eaten).not.toBe(null)
    expect(snapshot(eaten).hunger).toBe(0)
  })

  it('먹은 만큼 서버에 올릴 줄이 는다', () => {
    let e = createEngine({ eaten: 0, lastFedAt: 0, seed: 5, bounds, now: 0 })
    expect(e.pending).toBe(0)
    e = feedAt(e, bounds.w / 2, 0.5)
    const eaten = runUntilEaten(e)
    expect(eaten.pending).toBe(FOOD_KINDS.big.value)
  })
})

describe('밥 두 종류', () => {
  it('큰 밥이 작은 밥보다 값지다 — 클릭은 일부러, 타자는 무심코', () => {
    // 값이 같으면 타이핑만으로 몇 분 만에 다 커서 키우는 일이 사라진다.
    expect(FOOD_KINDS.big.value).toBeGreaterThan(FOOD_KINDS.small.value)
    expect(FOOD_KINDS.big.value).toBe(3)
    expect(FOOD_KINDS.small.value).toBe(1)
  })

  it('큰 밥을 먹으면 3, 작은 밥을 먹으면 1 오른다', () => {
    for (const [kind, gain] of [['big', 3], ['small', 1]]) {
      let e = createEngine({ eaten: 0, lastFedAt: 0, seed: 3, bounds, now: 0 })
      e = feedAt(e, bounds.w / 2, 0.5, kind)
      const eaten = runUntilEaten(e)
      expect(eaten, kind).not.toBe(null)
      expect(eaten.eaten, kind).toBe(gain)
    }
  })

  it('클릭은 큰 밥, 타자는 작은 밥이다', () => {
    let e = createEngine({ seed: 1, bounds, now: 0 })
    e = feedAt(e, 0.5, 0.5)
    expect(e.food[0].kind).toBe('big')

    e = feedTyped(e)
    expect(e.food[1].kind).toBe('small')
  })
})

describe('feedTyped', () => {
  it('타자 밥은 화면 안 아무 데나 떨어진다', () => {
    let e = createEngine({ seed: 7, bounds, now: 0 })
    const spots = []
    for (let i = 0; i < 20; i += 1) {
      e = feedTyped({ ...e, lastTypedAt: -Infinity })
      const last = e.food[e.food.length - 1]
      if (last) spots.push(last)
      e = { ...e, food: [] } // 자리만 보려고 비운다
    }
    expect(spots.length).toBeGreaterThan(5)
    for (const f of spots) {
      expect(f.x).toBeGreaterThan(0)
      expect(f.x).toBeLessThan(bounds.w)
      expect(f.y).toBeGreaterThan(0)
      expect(f.y).toBeLessThan(bounds.h)
    }
    // 매번 같은 자리면 「아무 데나」가 아니다.
    expect(new Set(spots.map((f) => `${f.x.toFixed(3)},${f.y.toFixed(3)}`)).size).toBeGreaterThan(5)
  })

  it(`${TYPE_FEED_INTERVAL}초에 한 번만 받는다 — 연타로 화면을 채우지 않는다`, () => {
    let e = createEngine({ seed: 1, bounds, now: 0 })
    // 같은 순간에 스무 번 친다
    for (let i = 0; i < 20; i += 1) e = feedTyped(e)
    expect(e.food).toHaveLength(1)

    // 간격이 지나면 하나 더 받는다
    e = { ...e, elapsed: TYPE_FEED_INTERVAL + 0.01 }
    e = feedTyped(e)
    expect(e.food).toHaveLength(2)
  })

  it('넘치는 입력은 줄을 세우지 않고 버린다', () => {
    // 줄을 세우면 손을 뗀 뒤에도 한참 떨어져서 「내가 친 것」이라는 느낌이 끊긴다.
    let e = createEngine({ seed: 1, bounds, now: 0 })
    for (let i = 0; i < 50; i += 1) e = feedTyped(e)
    e = { ...e, elapsed: 100 }
    e = feedTyped(e)
    expect(e.food).toHaveLength(2)
  })
})

describe('밥 주기를 끄면', () => {
  it('클릭도 타자도 밥이 안 된다 — 남이 볼 때 쓰는 기능이다', () => {
    let e = setGameMode(createEngine({ seed: 1, bounds, now: 0 }), false)
    e = feedAt(e, 0.5, 0.5)
    e = feedTyped(e)
    expect(e.food).toHaveLength(0)
  })
})

describe('feedAt', () => {
  it('가득 차면 더 안 떨어진다', () => {
    let e = createEngine({ seed: 1, bounds, now: 0 })
    for (let i = 0; i < MAX_FOOD + 3; i += 1) e = feedAt(e, 0.2 + i * 0.05, 0.5)
    expect(e.food).toHaveLength(MAX_FOOD)
  })
})

describe('mouthOf', () => {
  it('입은 몸통 앞쪽 끝이다', () => {
    const e = createEngine({ eaten: 0, seed: 1, bounds, now: 0 })
    const half = snapshot(e).length / 2
    const mouth = mouthOf(e)
    expect(Math.hypot(mouth.x - e.swimmer.x, mouth.y - e.swimmer.y)).toBeCloseTo(half, 9)
  })

  it('상어가 크면 입이 몸통에서 더 멀다', () => {
    const small = createEngine({ eaten: 0, seed: 1, bounds, now: 0 })
    const big = createEngine({ eaten: 120, seed: 1, bounds, now: 0 })
    const reach = (e) => Math.hypot(mouthOf(e).x - e.swimmer.x, mouthOf(e).y - e.swimmer.y)
    expect(reach(big)).toBeGreaterThan(reach(small))
  })
})

describe('snapshot', () => {
  it('밥 주기를 켜면 더 진해진다', () => {
    let e = createEngine({ eaten: 20, lastFedAt: 0, seed: 1, bounds, now: 0 })
    // 숨어 있으면 배율이 0 이라 차이가 안 난다. 순찰로 옮겨 놓고 잰다.
    e = { ...e, brain: { ...e.brain, state: 'cruise' } }
    const off = snapshot(setGameMode(e, false)).alpha
    const on = snapshot(setGameMode(e, true)).alpha
    expect(on).toBeGreaterThan(off)
  })

  it('기본은 켜짐이다 — 앱을 띄우면 늘 상어가 먹고 있다', () => {
    expect(createEngine({ bounds, now: 0 }).gameMode).toBe(true)
  })

  it('먹은 개수가 단계로 이어진다', () => {
    expect(snapshot(createEngine({ eaten: 0, bounds, now: 0 })).stage).toBe(1)
    expect(snapshot(createEngine({ eaten: 35, bounds, now: 0 })).stage).toBe(4)
  })
})

describe('결정론', () => {
  it('같은 씨앗·같은 입력이면 같은 결과다', () => {
    const run = () => {
      let e = createEngine({ eaten: 0, lastFedAt: 0, seed: 42, bounds, now: 0 })
      e = feedAt(e, 1.0, 0.3)
      let now = 0
      for (let i = 0; i < 600; i += 1) {
        now += DT * 1000
        e = step(e, now, DT)
      }
      return { x: e.swimmer.x, y: e.swimmer.y, eaten: e.eaten, state: e.brain.state }
    }
    expect(run()).toEqual(run())
  })
})
