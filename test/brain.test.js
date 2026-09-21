import { describe, expect, it } from 'vitest'
import {
  createBrain, intent, isOffScreen, keepInside, STATES, stepBrain,
} from '../src/game/brain.js'
import { createFood } from '../src/game/food.js'
import { EAT_DURATION, PROWL_THRESHOLD, SATED_DURATION } from '../src/game/constants.js'
import { makeRng } from '../src/game/rng.js'

const bounds = { w: 16 / 9, h: 1 }
const rng = () => makeRng(7)

function ctx(over = {}) {
  return {
    swimmer: { x: 0.8, y: 0.5, heading: 0, speed: 0.1 },
    food: [],
    hunger: 0,
    bounds,
    ateThisStep: false,
    rng: rng(),
    ...over,
  }
}

describe('밥이 떨어지면 무조건 돌진', () => {
  // 이것이 게임의 약속이다. 어느 상태에서 시작하든 예외가 없어야 한다.
  const food = [createFood(1, 0.5, 0.5)]

  for (const state of STATES.filter((s) => s !== 'eat' && s !== 'dash')) {
    it(`${state} 에서도 돌진으로 간다`, () => {
      const brain = { ...createBrain(rng()), state, timer: 99 }
      const next = stepBrain(brain, ctx({ food }), 1 / 60)
      expect(next.state).toBe('dash')
    })
  }

  it('먹는 중(eat)에는 안 끊긴다 — 한 입은 끝까지 문다', () => {
    const brain = { ...createBrain(rng()), state: 'eat', timer: EAT_DURATION }
    const next = stepBrain(brain, ctx({ food }), 1 / 60)
    expect(next.state).toBe('eat')
  })
})

describe('배고픔 경계', () => {
  it(`배고픔이 ${PROWL_THRESHOLD} 에 닿으면 에워싼다`, () => {
    const brain = { ...createBrain(rng()), state: 'lurk', timer: 99 }
    expect(stepBrain(brain, ctx({ hunger: PROWL_THRESHOLD }), 1 / 60).state).toBe('prowl')
  })

  it('경계 바로 아래에서는 안 에워싼다', () => {
    const brain = { ...createBrain(rng()), state: 'lurk', timer: 99 }
    expect(stepBrain(brain, ctx({ hunger: PROWL_THRESHOLD - 0.001 }), 1 / 60).state).toBe('lurk')
  })

  it('배가 부르면 에워싸기를 그만둔다', () => {
    const brain = { ...createBrain(rng()), state: 'prowl', timer: 99 }
    expect(stepBrain(brain, ctx({ hunger: 0 }), 1 / 60).state).toBe('lurk')
  })

  it('순찰 중에 배가 고파지면 에워싼다', () => {
    const brain = { ...createBrain(rng()), state: 'cruise', timer: 99 }
    expect(stepBrain(brain, ctx({ hunger: 0.9 }), 1 / 60).state).toBe('prowl')
  })
})

describe('먹고 나서', () => {
  it('먹으면 어떤 상태에서든 eat 로 간다', () => {
    const brain = { ...createBrain(rng()), state: 'cruise', timer: 99 }
    const next = stepBrain(brain, ctx({ ateThisStep: true }), 1 / 60)
    expect(next.state).toBe('eat')
    expect(next.timer).toBe(EAT_DURATION)
  })

  it(`eat 는 ${EAT_DURATION}초 뒤 sated 로 간다`, () => {
    let brain = { ...createBrain(rng()), state: 'eat', timer: EAT_DURATION }
    const dt = 1 / 60
    let steps = 0
    while (brain.state === 'eat' && steps < 1000) {
      brain = stepBrain(brain, ctx(), dt)
      steps += 1
    }
    expect(brain.state).toBe('sated')
    expect(steps * dt).toBeCloseTo(EAT_DURATION, 1)
  })

  it(`sated 는 ${SATED_DURATION}초 뒤 숨는다`, () => {
    let brain = { ...createBrain(rng()), state: 'sated', timer: SATED_DURATION }
    const dt = 1 / 60
    let steps = 0
    while (brain.state === 'sated' && steps < 10000) {
      brain = stepBrain(brain, ctx(), dt)
      steps += 1
    }
    expect(brain.state).toBe('lurk')
    expect(steps * dt).toBeCloseTo(SATED_DURATION, 1)
  })
})

describe('숨음 ↔ 순찰', () => {
  it('타이머가 다하면 순찰을 나간다', () => {
    const brain = { ...createBrain(rng()), state: 'lurk', timer: 0.01 }
    expect(stepBrain(brain, ctx(), 1 / 60).state).toBe('cruise')
  })

  it('순찰은 시간이 다하면 끝난다 — 화면 밖으로 나가서 끝나지 않는다', () => {
    const brain = { ...createBrain(rng()), state: 'cruise', timer: 0.01 }
    expect(stepBrain(brain, ctx(), 1 / 60).state).toBe('lurk')
  })

  it('시간이 남아 있으면 계속 순찰한다', () => {
    const brain = { ...createBrain(rng()), state: 'cruise', timer: 99 }
    expect(stepBrain(brain, ctx(), 1 / 60).state).toBe('cruise')
  })
})

describe('돌진 중에 밥이 사라지면', () => {
  it('숨는다 — 없는 밥을 계속 쫓지 않는다', () => {
    const brain = { ...createBrain(rng()), state: 'dash', timer: 99 }
    expect(stepBrain(brain, ctx({ food: [] }), 1 / 60).state).toBe('lurk')
  })
})

describe('intent', () => {
  it('돌진의 목표는 가장 가까운 밥이다', () => {
    const brain = { ...createBrain(rng()), state: 'dash' }
    const food = [createFood(1, 0.2, 0.2), createFood(2, 0.85, 0.52)]
    const swimmer = { x: 0.8, y: 0.5, heading: 0, speed: 0.1 }
    const want = intent(brain, { swimmer, food, bounds })
    expect(want.target).toEqual({ x: 0.85, y: 0.52 })
  })

  it('**쫓기로 한 밥만 본다** — 더 나은 밥이 나타나도 안 갈아탄다', () => {
    // 매 프레임 「제일 나은 밥」을 다시 고르면, 타자로 밥이 흩뿌려질 때 목표가
    // 수백 번 뒤바뀌어 상어가 그 사이를 맴돌기만 하고 아무것도 못 먹는다.
    const swimmer = { x: 0.8, y: 0.5, heading: 0, speed: 0.22 }
    const chasing = createFood(1, 1.4, 0.5, 'small')      // 멀고 작은, 쫓던 밥
    const tempting = createFood(2, 0.84, 0.5, 'big')      // 코앞의 큰 밥
    const brain = { ...createBrain(rng()), state: 'dash', targetId: 1 }

    const { target } = intent(brain, { swimmer, food: [chasing, tempting], bounds })
    expect(target.x).toBeCloseTo(chasing.x, 6)
    expect(target.y).toBeCloseTo(chasing.y, 6)
  })

  it('쫓던 밥이 사라지면 그때는 새로 고른다', () => {
    const swimmer = { x: 0.8, y: 0.5, heading: 0, speed: 0.22 }
    const other = createFood(2, 0.84, 0.5, 'big')
    const brain = { ...createBrain(rng()), state: 'dash', targetId: 99 } // 없는 id
    const { target } = intent(brain, { swimmer, food: [other], bounds })
    expect(target.x).toBeCloseTo(other.x, 6)
  })

  it('돌진이 순찰보다 빠르다', () => {
    const swimmer = { x: 0.8, y: 0.5, heading: 0, speed: 0.1 }
    const food = [createFood(1, 0.5, 0.5)]
    const dash = intent({ ...createBrain(rng()), state: 'dash' }, { swimmer, food, bounds })
    const cruise = intent({ ...createBrain(rng()), state: 'cruise' }, { swimmer, food: [], bounds })
    expect(dash.speed).toBeGreaterThan(cruise.speed * 2)
  })

  it('에워쌀 때의 목표는 화면 안에 있다 — 보채는 게 보여야 한다', () => {
    for (let i = 0; i < 40; i += 1) {
      const brain = { ...createBrain(rng()), state: 'prowl', prowlAngle: (i / 40) * Math.PI * 2 }
      const swimmer = { x: 0.8, y: 0.5, heading: 0, speed: 0.1 }
      const { target } = intent(brain, { swimmer, food: [], bounds })
      expect(isOffScreen(target, bounds)).toBe(false)
      expect(target.y).toBeGreaterThan(0)
      expect(target.y).toBeLessThan(bounds.h)
    }
  })

  it('숨을 때도 목표는 화면 안이다 — 안 보일 뿐 나가지는 않는다', () => {
    for (let i = 0; i < 24; i += 1) {
      const brain = { ...createBrain(rng()), state: 'lurk', lurkAngle: (i / 24) * Math.PI * 2 }
      const swimmer = { x: 0.8, y: 0.5, heading: 0, speed: 0.1 }
      const { target } = intent(brain, { swimmer, food: [], bounds })
      expect(isOffScreen(target, bounds)).toBe(false)
    }
  })

  it('밥은 가장자리에 있어도 그대로 노린다 — 벽 보정을 걸면 못 먹는다', () => {
    const brain = { ...createBrain(rng()), state: 'dash' }
    const food = [createFood(1, bounds.w - 0.02, 0.02)]
    const swimmer = { x: 0.5, y: 0.5, heading: 0, speed: 0.1 }
    const { target } = intent(brain, { swimmer, food, bounds })
    expect(target).toEqual({ x: bounds.w - 0.02, y: 0.02 })
  })
})

describe('keepInside', () => {
  it('가장자리 밖의 목표를 화면 안으로 접는다', () => {
    const swimmer = { x: 0.5, y: 0.5, heading: 0, speed: 0.1 }
    const inside = keepInside({ x: bounds.w + 5, y: -5 }, swimmer, bounds)
    expect(isOffScreen(inside, bounds)).toBe(false)
    expect(inside.x).toBeLessThan(bounds.w)
    expect(inside.y).toBeGreaterThan(0)
  })

  it('상어가 벽에 붙어 있으면 반대쪽으로 더 민다', () => {
    const atLeftWall = { x: 0.02, y: 0.5, heading: Math.PI, speed: 0.1 }
    const middle = { x: bounds.w / 2, y: 0.5, heading: Math.PI, speed: 0.1 }
    const straight = { x: 0.0, y: 0.5 }
    expect(keepInside(straight, atLeftWall, bounds).x)
      .toBeGreaterThan(keepInside(straight, middle, bounds).x)
  })
})
