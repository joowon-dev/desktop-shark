// 떨어진 밥들. **상어의 상태를 모른다.** 가라앉고, 늙고, 먹히면 사라진다.

import { EAT_RADIUS, FOOD_LIFETIME, FOOD_SINK_SPEED, MAX_FOOD } from './constants.js'

/** 밥 하나. id 는 그리는 쪽이 흔들림 위상을 고정하는 데 쓴다. */
export function createFood(id, x, y) {
  return { id, x, y, age: 0 }
}

/**
 * 밥을 하나 떨어뜨린다. 이미 가득이면 **안 떨어뜨린다** —
 * 오래된 것을 밀어내면 상어가 쫓던 밥이 발밑에서 사라진다.
 */
export function dropFood(list, id, x, y) {
  if (list.length >= MAX_FOOD) return list
  return [...list, createFood(id, x, y)]
}

/** 한 스텝. 가라앉히고 늙히고, 수명이 다한 것을 버린다. */
export function stepFood(list, dt) {
  return list
    .map((f) => ({ ...f, y: f.y + FOOD_SINK_SPEED * dt, age: f.age + dt }))
    .filter((f) => f.age < FOOD_LIFETIME && f.y < 1.2)
}

/** 상어에게 제일 가까운 밥. 없으면 null. */
export function nearestFood(list, point) {
  let best = null
  let bestDistance = Infinity
  for (const f of list) {
    const d = Math.hypot(f.x - point.x, f.y - point.y)
    if (d < bestDistance) {
      bestDistance = d
      best = f
    }
  }
  return best
}

/** 입이 닿았는가. */
export function canEat(food, mouth) {
  if (!food) return false
  return Math.hypot(food.x - mouth.x, food.y - mouth.y) <= EAT_RADIUS
}

/** 먹었다. 그 하나만 뺀다. */
export function removeFood(list, id) {
  return list.filter((f) => f.id !== id)
}

/** 사라지기 직전에는 흐려진다. 마지막 3초. */
export function foodAlpha(food) {
  const left = FOOD_LIFETIME - food.age
  if (left >= 3) return 1
  return Math.max(0, left / 3)
}
