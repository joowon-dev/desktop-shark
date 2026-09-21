// 상태기계 — 「지금 무엇을 하고 싶은가」와 「그래서 어디로 가고 싶은가」.
//
// **어떻게 헤엄치는지는 모른다.** 목표점과 원하는 속력만 내놓고, 거기까지 가는 길은
// swim.js 가 정한다. 둘을 갈라 놓아서 상어가 밥을 지나쳤다가 크게 돌아 오는 움직임이
// 공짜로 나온다 — brain 은 그냥 계속 밥을 가리키고, swim 이 못 꺾을 뿐이다.
//
// 좌표는 화면 짧은 변을 1 로 본 정규 좌표. bounds = { w, h } 로 화면 크기를 받는다.

import {
  CRUISE_SPEED, DASH_MULTIPLIER, DASH_TURN_RATE, EAT_DURATION, HIDE_MAX, HIDE_MIN,
  PROWL_SPEED, SATED_DURATION, SATED_SPEED, TURN_RATE,
} from './constants.js'
import { isHungry } from './hunger.js'
import { bestFood } from './food.js'
import { range } from './rng.js'

export const STATES = ['hidden', 'cruise', 'prowl', 'dash', 'eat', 'sated']

/** 화면 밖으로 이만큼 나가면 「사라졌다」로 본다. */
const OFF_SCREEN = 0.35

export function createBrain(rng) {
  return {
    state: 'hidden',
    timer: range(rng, HIDE_MIN, HIDE_MAX),
    /** 에워쌀 때 도는 각도. 상태가 이어지는 동안만 뜻이 있다. */
    prowlAngle: range(rng, 0, Math.PI * 2),
    /** 숨었을 때 물러나 있는 방향. */
    hideAngle: range(rng, 0, Math.PI * 2),
  }
}

/**
 * 지금 가고 싶은 곳과 속력.
 *
 * @returns {{target: {x,y}, speed: number, turnRate: number}}
 */
export function intent(brain, ctx) {
  const { swimmer, food, bounds } = ctx
  const center = { x: bounds.w / 2, y: bounds.h / 2 }

  switch (brain.state) {
    case 'hidden': {
      // 화면 밖 먼 곳. 실제로 거기 닿을 일은 없고, 방향만 쓴다.
      const far = Math.max(bounds.w, bounds.h) * 1.5
      return {
        target: {
          x: center.x + Math.cos(brain.hideAngle) * far,
          y: center.y + Math.sin(brain.hideAngle) * far,
        },
        speed: CRUISE_SPEED * 0.7,
        turnRate: TURN_RATE,
      }
    }

    case 'cruise': {
      // 반대편으로 가로지른다. 지금 향한 쪽의 화면 밖 한 점.
      const far = Math.max(bounds.w, bounds.h) * 1.2
      return {
        target: {
          x: swimmer.x + Math.cos(swimmer.heading) * far,
          y: swimmer.y + Math.sin(swimmer.heading) * far,
        },
        speed: CRUISE_SPEED,
        turnRate: TURN_RATE,
      }
    }

    case 'prowl': {
      // 화면 가장자리를 따라 도는 큰 원. 보채는 것이 보이도록 화면 안에 머문다.
      const radius = Math.min(bounds.w, bounds.h) * 0.42
      return {
        target: {
          x: center.x + Math.cos(brain.prowlAngle) * radius,
          y: center.y + Math.sin(brain.prowlAngle) * radius,
        },
        speed: PROWL_SPEED,
        turnRate: TURN_RATE,
      }
    }

    case 'dash': {
      const prey = bestFood(food, swimmer)
      // 밥이 방금 사라졌다면 제자리를 가리킨다 — 다음 스텝에서 상태가 바뀐다.
      return {
        target: prey ? { x: prey.x, y: prey.y } : { x: swimmer.x, y: swimmer.y },
        speed: CRUISE_SPEED * DASH_MULTIPLIER,
        turnRate: DASH_TURN_RATE,
      }
    }

    case 'eat':
      return { target: { x: swimmer.x, y: swimmer.y }, speed: 0, turnRate: TURN_RATE }

    case 'sated':
    default:
      return {
        target: {
          x: center.x + Math.cos(brain.prowlAngle) * Math.min(bounds.w, bounds.h) * 0.25,
          y: center.y + Math.sin(brain.prowlAngle) * Math.min(bounds.w, bounds.h) * 0.25,
        },
        speed: SATED_SPEED,
        turnRate: TURN_RATE,
      }
  }
}

/**
 * 한 스텝. 전이만 한다 — 상어를 움직이지 않는다.
 *
 * @param {object} brain
 * @param {{swimmer, food, hunger, bounds, ateThisStep: boolean, rng}} ctx
 * @param {number} dt
 * @returns {object} 새 brain
 */
export function stepBrain(brain, ctx, dt) {
  const { food, hunger, swimmer, bounds, ateThisStep, rng } = ctx
  const next = { ...brain, timer: brain.timer - dt }

  // 도는 각도는 상태와 상관없이 흐른다. 원 위의 목표점이 앞서 가야 상어가 쫓아 돈다.
  next.prowlAngle = brain.prowlAngle + dt * 0.5

  // 먹은 순간은 어떤 규칙보다 먼저다.
  if (ateThisStep) {
    return { ...next, state: 'eat', timer: EAT_DURATION }
  }

  switch (brain.state) {
    case 'eat':
      if (next.timer <= 0) return { ...next, state: 'sated', timer: SATED_DURATION }
      return next

    case 'dash':
      // 쫓던 밥이 사라졌다(수명이 다했거나). 숨는다.
      if (food.length === 0) return { ...next, state: 'hidden', timer: hideDelay(rng), hideAngle: awayAngle(swimmer, bounds) }
      return next

    case 'sated':
      if (food.length > 0) return { ...next, state: 'dash' }
      if (next.timer <= 0) return { ...next, state: 'hidden', timer: hideDelay(rng), hideAngle: awayAngle(swimmer, bounds) }
      return next

    case 'prowl':
      if (food.length > 0) return { ...next, state: 'dash' }
      if (!isHungry(hunger)) return { ...next, state: 'hidden', timer: hideDelay(rng), hideAngle: awayAngle(swimmer, bounds) }
      return next

    case 'cruise':
      if (food.length > 0) return { ...next, state: 'dash' }
      if (isHungry(hunger)) return { ...next, state: 'prowl' }
      if (isOffScreen(swimmer, bounds)) return { ...next, state: 'hidden', timer: hideDelay(rng), hideAngle: awayAngle(swimmer, bounds) }
      return next

    case 'hidden':
    default:
      if (food.length > 0) return { ...next, state: 'dash' }
      if (isHungry(hunger)) return { ...next, state: 'prowl' }
      if (next.timer <= 0) return { ...next, state: 'cruise', timer: 0 }
      return next
  }
}

export function hideDelay(rng) {
  return range(rng, HIDE_MIN, HIDE_MAX)
}

/** 화면 밖으로 충분히 나갔는가. */
export function isOffScreen(point, bounds) {
  return point.x < -OFF_SCREEN || point.x > bounds.w + OFF_SCREEN
    || point.y < -OFF_SCREEN || point.y > bounds.h + OFF_SCREEN
}

/** 숨을 때 물러날 방향 — 화면 중심의 반대쪽. 나갔던 쪽으로 계속 나간다. */
function awayAngle(point, bounds) {
  return Math.atan2(point.y - bounds.h / 2, point.x - bounds.w / 2)
}
