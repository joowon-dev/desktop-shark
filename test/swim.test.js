import { describe, expect, it } from 'vitest'
import { TURN_RATE } from '../src/game/constants.js'
import { createSwimmer, distance, step, wrapAngle } from '../src/game/swim.js'

describe('wrapAngle', () => {
  it('접어서 (-π, π] 안에 넣는다', () => {
    // 값을 못 박는다. 자기 자신하고 비교하면 어떤 식을 넣어도 통과한다.
    expect(wrapAngle(0)).toBeCloseTo(0, 10)
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 10)
    expect(wrapAngle(-Math.PI * 3)).toBeCloseTo(Math.PI, 10)
    expect(wrapAngle(Math.PI * 1.5)).toBeCloseTo(-Math.PI * 0.5, 10)
  })
})

describe('step — 선회 반경', () => {
  it('한 스텝에 turnRate × dt 보다 많이 못 돈다', () => {
    const dt = 1 / 60
    // 정확히 반대쪽을 가리킨다. 상한이 없으면 한 스텝에 180° 를 돈다.
    const swimmer = createSwimmer(0.5, 0.5, 0, 0.1)
    const next = step(swimmer, { x: -10, y: 0.5 }, 0.1, dt, TURN_RATE)

    const turned = Math.abs(wrapAngle(next.heading - swimmer.heading))
    expect(turned).toBeLessThanOrEqual(TURN_RATE * dt + 1e-9)
    // 그리고 실제로 상한까지는 돈다 — 안 돌면 이 테스트는 아무것도 안 지킨다.
    expect(turned).toBeCloseTo(TURN_RATE * dt, 9)
  })

  it('180° 를 도는 데 최소 π / turnRate 초가 걸린다', () => {
    const dt = 1 / 60
    let swimmer = createSwimmer(0.5, 0.5, 0, 0.1)
    const target = { x: -10, y: 0.5 }

    let steps = 0
    while (Math.abs(wrapAngle(Math.PI - swimmer.heading)) > 0.02 && steps < 10000) {
      swimmer = step(swimmer, target, 0.1, dt, TURN_RATE)
      steps += 1
    }

    const seconds = steps * dt
    expect(seconds).toBeGreaterThanOrEqual(Math.PI / TURN_RATE - 0.05)
  })
})

describe('step — 목표에 닿는다', () => {
  it('등을 돌린 채 시작해도 결국 목표에 닿는다', () => {
    const dt = 1 / 60
    const target = { x: 1.2, y: 0.5 }
    let swimmer = createSwimmer(0.5, 0.5, Math.PI, 0) // 반대쪽을 보고 있다

    let best = Infinity
    for (let i = 0; i < 60 * 30; i += 1) {
      swimmer = step(swimmer, target, 0.2, dt, TURN_RATE)
      best = Math.min(best, distance(swimmer, target))
    }

    expect(best).toBeLessThan(0.03)
  })

  it('속력이 0 에서 시작해도 목표 속력에 붙는다', () => {
    const dt = 1 / 60
    let swimmer = createSwimmer(0, 0.5, 0, 0)
    for (let i = 0; i < 60; i += 1) swimmer = step(swimmer, { x: 10, y: 0.5 }, 0.2, dt)
    expect(swimmer.speed).toBeGreaterThan(0.19)
    expect(swimmer.speed).toBeLessThanOrEqual(0.2)
  })
})
