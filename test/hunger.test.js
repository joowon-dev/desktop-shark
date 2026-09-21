import { describe, expect, it } from 'vitest'
import { HUNGER_FULL_SECONDS, PROWL_THRESHOLD } from '../src/game/constants.js'
import { hungerAt, hungerLabel, isHungry } from '../src/game/hunger.js'

const HOUR = 60 * 60 * 1000

describe('hungerAt', () => {
  it('6시간에 1.0 에 닿는다 — 값을 못 박는다', () => {
    expect(HUNGER_FULL_SECONDS).toBe(6 * 60 * 60)
    expect(hungerAt(0, 6 * HOUR)).toBe(1)
  })

  it('방금 먹였으면 0', () => {
    expect(hungerAt(1000, 1000)).toBe(0)
  })

  it('절반 지나면 0.5', () => {
    expect(hungerAt(0, 3 * HOUR)).toBeCloseTo(0.5, 6)
  })

  it('한 번도 안 먹인 상어는 배고픈 채로 만난다', () => {
    // 첫 밥이 사건이 되려면 처음부터 배고파야 한다.
    expect(hungerAt(null, 0)).toBe(1)
  })

  it('넘어가도 1 을 안 넘는다', () => {
    expect(hungerAt(0, 100 * HOUR)).toBe(1)
  })

  it('앱이 꺼져 있던 시간도 흐른다', () => {
    // 프레임에서 누적하면 껐다 켠 시간이 사라진다. 벽시계에서 재는지 본다.
    const fed = 0
    expect(hungerAt(fed, 24 * HOUR)).toBe(1)
    expect(hungerAt(fed, 1 * HOUR)).toBeCloseTo(1 / 6, 6)
  })
})

describe('isHungry', () => {
  it(`${PROWL_THRESHOLD} 이상이면 배고프다`, () => {
    expect(isHungry(PROWL_THRESHOLD)).toBe(true)
    expect(isHungry(PROWL_THRESHOLD - 1e-9)).toBe(false)
    expect(isHungry(1)).toBe(true)
    expect(isHungry(0)).toBe(false)
  })
})

describe('hungerLabel', () => {
  it('구간마다 다른 말을 한다', () => {
    expect(hungerLabel(0)).toBe('배부름')
    expect(hungerLabel(0.34)).toBe('배부름')
    expect(hungerLabel(0.35)).toBe('출출함')
    expect(hungerLabel(0.7)).toBe('배고픔')
    expect(hungerLabel(1)).toBe('굶주림')
  })

  it('보채기 시작하는 순간과 「배고픔」이 같은 지점이다', () => {
    expect(hungerLabel(PROWL_THRESHOLD)).toBe('배고픔')
    expect(hungerLabel(PROWL_THRESHOLD - 0.001)).toBe('출출함')
  })
})
