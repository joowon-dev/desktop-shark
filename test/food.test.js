import { describe, expect, it } from 'vitest'
import {
  EAT_RADIUS, FOOD_KINDS, FOOD_LIFETIME, FOOD_SINK_SPEED, MAX_FOOD,
} from '../src/game/constants.js'
import {
  bestFood, canEat, createFood, dropFood, foodAlpha, nearestFood, removeFood, stepFood,
} from '../src/game/food.js'

describe('dropFood', () => {
  it(`동시에 ${MAX_FOOD} 개까지만`, () => {
    let list = []
    for (let i = 1; i <= MAX_FOOD; i += 1) list = dropFood(list, i, 0.5, 0.5)
    expect(list).toHaveLength(MAX_FOOD)

    const full = dropFood(list, 99, 0.1, 0.1)
    expect(full).toHaveLength(MAX_FOOD)
    // **오래된 것을 밀어내지 않는다** — 상어가 쫓던 밥이 발밑에서 사라지면 안 된다.
    expect(full.map((f) => f.id)).toEqual(list.map((f) => f.id))
  })

  it('가득 차지 않았으면 뒤에 붙는다', () => {
    const list = dropFood([createFood(1, 0.1, 0.1)], 2, 0.9, 0.9)
    expect(list.map((f) => f.id)).toEqual([1, 2])
  })
})

describe('stepFood', () => {
  it('가라앉는다', () => {
    const [food] = stepFood([createFood(1, 0.5, 0.5)], 1)
    expect(food.y).toBeCloseTo(0.5 + FOOD_SINK_SPEED, 9)
  })

  it(`${FOOD_LIFETIME}초에 사라진다 — 값을 못 박는다`, () => {
    expect(FOOD_LIFETIME).toBe(20)

    let list = [createFood(1, 0.5, 0)]
    const dt = 1 / 60
    let seconds = 0
    while (list.length > 0 && seconds < 60) {
      list = stepFood(list, dt)
      seconds += dt
    }
    expect(seconds).toBeGreaterThan(FOOD_LIFETIME - 0.1)
    expect(seconds).toBeLessThan(FOOD_LIFETIME + 0.1)
  })

  it('화면 아래로 충분히 내려가면 수명 전에도 사라진다', () => {
    const list = stepFood([{ id: 1, x: 0.5, y: 1.19, age: 0 }], 1)
    expect(list).toHaveLength(0)
  })
})

describe('createFood', () => {
  it('종류에 따라 값과 크기가 달라진다', () => {
    expect(createFood(1, 0, 0, 'big').value).toBe(FOOD_KINDS.big.value)
    expect(createFood(1, 0, 0, 'small').value).toBe(FOOD_KINDS.small.value)
    expect(createFood(1, 0, 0, 'big').radius).toBeGreaterThan(createFood(1, 0, 0, 'small').radius)
  })

  it('기본은 큰 밥이다', () => {
    expect(createFood(1, 0, 0).kind).toBe('big')
  })

  it('가라앉아도 종류와 값이 남는다', () => {
    const [f] = stepFood([createFood(1, 0.5, 0.5, 'small')], 1)
    expect(f.kind).toBe('small')
    expect(f.value).toBe(FOOD_KINDS.small.value)
  })
})

describe('bestFood', () => {
  it('거의 같은 거리면 큰 밥을 고른다', () => {
    // 거리만 보면 타자로 흩뿌려진 작은 밥에 밀려 큰 밥을 영영 안 먹는다.
    const list = [createFood(1, 0.30, 0.5, 'small'), createFood(2, 0.32, 0.5, 'big')]
    expect(bestFood(list, { x: 0, y: 0.5 }).id).toBe(2)
  })

  it('그래도 아주 멀면 큰 밥을 포기한다', () => {
    const list = [createFood(1, 0.10, 0.5, 'small'), createFood(2, 1.50, 0.5, 'big')]
    expect(bestFood(list, { x: 0, y: 0.5 }).id).toBe(1)
  })

  it('없으면 null', () => {
    expect(bestFood([], { x: 0, y: 0 })).toBe(null)
  })
})

describe('nearestFood', () => {
  it('가장 가까운 것을 준다', () => {
    const list = [createFood(1, 0, 0), createFood(2, 0.4, 0.4), createFood(3, 1, 1)]
    expect(nearestFood(list, { x: 0.45, y: 0.45 }).id).toBe(2)
  })

  it('없으면 null', () => {
    expect(nearestFood([], { x: 0, y: 0 })).toBe(null)
  })
})

describe('canEat', () => {
  it(`입에서 ${EAT_RADIUS} 안이면 먹는다`, () => {
    const mouth = { x: 0.5, y: 0.5 }
    expect(canEat(createFood(1, 0.5, 0.5 + EAT_RADIUS * 0.9), mouth)).toBe(true)
    expect(canEat(createFood(1, 0.5, 0.5 + EAT_RADIUS * 1.1), mouth)).toBe(false)
  })

  it('밥이 없으면 못 먹는다', () => {
    expect(canEat(null, { x: 0, y: 0 })).toBe(false)
  })
})

describe('removeFood', () => {
  it('그 하나만 뺀다', () => {
    const list = [createFood(1, 0, 0), createFood(2, 0, 0), createFood(3, 0, 0)]
    expect(removeFood(list, 2).map((f) => f.id)).toEqual([1, 3])
  })
})

describe('foodAlpha', () => {
  it('마지막 3초에 흐려진다', () => {
    expect(foodAlpha({ age: 0 })).toBe(1)
    expect(foodAlpha({ age: FOOD_LIFETIME - 3 })).toBe(1)
    expect(foodAlpha({ age: FOOD_LIFETIME - 1.5 })).toBeCloseTo(0.5, 6)
    expect(foodAlpha({ age: FOOD_LIFETIME })).toBe(0)
  })
})
