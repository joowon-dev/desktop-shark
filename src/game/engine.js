// 게임 전체를 한 스텝 굴린다. **그리는 법은 모른다.**
//
// 고정 타임스텝이다. 프레임 시간을 그대로 적분하면 기계마다 상어가 다른 속도로 헤엄친다.
// 벽시계(`now`)는 밖에서 받는다 — 순수 모듈은 Date.now() 를 부르지 않는다.

import {
  DT, EAT_REACH, TAIL_BASE_RATE, TAIL_BASE_SWING, TAIL_MAX_SWING,
  TAIL_SPEED_RATE, TAIL_SPEED_SWING, TYPE_FEED_INTERVAL,
} from './constants.js'
import { createBrain, intent, stepBrain } from './brain.js'
import { canEat, dropFood, nearestFood, removeFood, stepFood } from './food.js'
import { range } from './rng.js'
import { hungerAt } from './hunger.js'
import { lengthOf, stageOf, visibility } from './growth.js'
import { FIRST_SPECIES, collect, pickSpecies, speciesOf } from './species.js'
import { makeRng } from './rng.js'
import { createSwimmer, step as swimStep } from './swim.js'
import { enqueueFeed } from './sync.js'

/**
 * @param {{eaten?: number, lastFedAt?: number|null, seed?: number, bounds?: {w,h}, now?: number}} options
 */
export function createEngine(options = {}) {
  const bounds = options.bounds ?? { w: 16 / 9, h: 1 }
  const rng = makeRng(options.seed ?? 1)
  return {
    rng,
    bounds,
    // 처음부터 화면 안에 있다. 밖에서 들어오게 두면 첫 밥을 줘도 한참을 기다린다.
    swimmer: createSwimmer(bounds.w * 0.25, bounds.h * 0.5, 0, 0),
    brain: createBrain(rng),
    food: [],
    nextFoodId: 1,
    eaten: options.eaten ?? 0,
    lastFedAt: options.lastFedAt ?? null,
    /** 지금 키우는 상어의 종. 한 마리가 사는 동안 안 바뀐다. */
    species: options.species ?? FIRST_SPECIES,
    /** 6단계까지 키워 본 종들. 도감이다. */
    collected: options.collected ?? [],
    now: options.now ?? 0,
    /**
     * 밥 주기. **기본이 켜짐이다** — 앱을 띄우면 늘 상어가 먹고 있고,
     * 남이 화면을 볼 때만 끈다. 켜져 있어도 클릭은 밑의 앱으로 그대로 간다.
     */
    gameMode: options.gameMode ?? true,
    /** 서버에 아직 못 올린 먹이 수. */
    pending: 0,
    /** 이번 스텝에 먹었는가 — 그리는 쪽이 물살을 터뜨리는 데 쓴다. */
    justAte: false,
    /** 마지막으로 타자 밥이 떨어진 시각(elapsed 기준). 연타를 막는 데 쓴다. */
    lastTypedAt: -Infinity,
    /** 누적 시간. */
    elapsed: 0,
    /**
     * 꼬리가 저은 각도. **매 스텝 쌓는다** — 시간 × 빠르기로 구하면 속력이 바뀌는
     * 순간 지나간 시간 전체가 다시 계산되어 꼬리가 순간이동한다.
     */
    tailPhase: 0,
  }
}

/** 화면 크기가 바뀌었다. */
export function setBounds(engine, bounds) {
  return { ...engine, bounds }
}

export function setGameMode(engine, on) {
  return { ...engine, gameMode: !!on }
}

/**
 * 클릭한 자리에 **큰 밥**. 밥 주기가 꺼져 있으면 아무 일도 없다.
 *
 * 셸이 전역으로 클릭을 엿들어 부른다 — 창이 클릭을 삼키지 않으므로
 * 누르던 앱은 그대로 눌린다.
 */
export function feedAt(engine, x, y, kind = 'big') {
  if (!engine.gameMode) return engine
  const food = dropFood(engine.food, engine.nextFoodId, x, y, kind, engine.bounds)
  if (food === engine.food) return engine // 가득 찼다
  return { ...engine, food, nextFoodId: engine.nextFoodId + 1 }
}

/**
 * 타자 한 번에 **작은 밥 하나가 아무 데나**.
 *
 * **연타로 화면을 채우지 않는다.** 사람은 1 분에 400 타도 치므로 그대로 받으면
 * 밥이 순식간에 가득 차고 상어가 쫓을 것을 고르지 못한다. TYPE_FEED_INTERVAL 마다
 * 하나만 받는다 — 넘치는 입력은 **조용히 버린다**(줄을 세우면 손을 뗀 뒤에도
 * 한참 떨어져서 「내가 친 것」이라는 느낌이 끊긴다).
 */
export function feedTyped(engine) {
  if (!engine.gameMode) return engine
  if (engine.elapsed - engine.lastTypedAt < TYPE_FEED_INTERVAL) return engine

  // 화면 가장자리는 피한다 — 구석에 떨어지면 상어가 오가는 데만 한참 걸린다.
  const x = range(engine.rng, engine.bounds.w * 0.08, engine.bounds.w * 0.92)
  const y = range(engine.rng, engine.bounds.h * 0.12, engine.bounds.h * 0.88)

  const food = dropFood(engine.food, engine.nextFoodId, x, y, 'small', engine.bounds)
  if (food === engine.food) return engine
  return { ...engine, food, nextFoodId: engine.nextFoodId + 1, lastTypedAt: engine.elapsed }
}

/** 이 상어의 몸 길이. 종마다 배율이 다르다. */
export function lengthNow(engine) {
  return lengthOf(stageOf(engine.eaten)) * speciesOf(engine.species).size
}

/** 상어의 입 — 코끝. 밥을 먹었는지는 몸통이 아니라 여기로 잰다. */
export function mouthOf(engine) {
  const half = lengthNow(engine) / 2
  return {
    x: engine.swimmer.x + Math.cos(engine.swimmer.heading) * half,
    y: engine.swimmer.y + Math.sin(engine.swimmer.heading) * half,
  }
}

/**
 * 한 스텝.
 *
 * @param {object} engine
 * @param {number} now 벽시계 (ms)
 * @param {number} dt 초. 기본은 고정 타임스텝
 */
export function step(engine, now, dt = DT) {
  const hunger = hungerAt(engine.lastFedAt, now)

  // 1. 밥이 가라앉고 늙는다.
  let food = stepFood(engine.food, dt, engine.bounds)

  // 2. 입이 닿았는가. 먹는 중일 때는 다시 물지 않는다.
  const mouth = mouthOf(engine)
  const prey = nearestFood(food, mouth)
  const ateThisStep = engine.brain.state !== 'eat'
    && canEat(prey, mouth, lengthNow(engine) * EAT_REACH)

  let { eaten, lastFedAt, pending } = engine
  if (ateThisStep) {
    // 큰 밥은 작은 밥보다 값지다. 클릭은 일부러 하는 것이고 타자는 무심코 하는 것이다.
    const value = prey.value ?? 1
    food = removeFood(food, prey.id)
    eaten += value
    lastFedAt = now
    pending = enqueueFeed(pending, value)
  }

  // 3. 머리가 상태를 정한다. **먹은 뒤의 배고픔으로 판단한다** — 방금 먹었는데
  //    「배고파서 에워쌈」으로 넘어가면 우스워진다.
  const hungerNow = ateThisStep ? 0 : hunger
  const brain = stepBrain(engine.brain, {
    swimmer: engine.swimmer,
    food,
    hunger: hungerNow,
    bounds: engine.bounds,
    ateThisStep,
    rng: engine.rng,
  }, dt)

  // 4. 몸이 그쪽으로 헤엄친다. 종마다 속력이 다르다.
  const want = intent(brain, { swimmer: engine.swimmer, food, bounds: engine.bounds })
  const pace = speciesOf(engine.species).speed
  const swimmer = swimStep(engine.swimmer, want.target, want.speed * pace, dt, want.turnRate)

  // 5. 다 크면 도감에 오른다. **키우는 동안 저절로 오른다** — 따로 누를 것이 없다.
  const collected = stageOf(eaten) >= 6 ? collect(engine.collected, engine.species) : engine.collected

  return {
    ...engine,
    collected,
    // 꼬리는 빠를수록 자주 젓는다. **더한다** — 곱하지 않는다.
    tailPhase: engine.tailPhase + (TAIL_BASE_RATE + Math.abs(swimmer.speed) * TAIL_SPEED_RATE) * dt,
    food,
    swimmer,
    brain,
    eaten,
    lastFedAt,
    pending,
    now,
    justAte: ateThisStep,
    elapsed: engine.elapsed + dt,
  }
}

/**
 * 다 큰 상어를 놓아주고 **새 종의 아기상어**를 맞이한다.
 *
 * 도감은 그대로 두고 누적만 0 으로 돌린다. 이미 도감에 있는 종은 피해서 고른다 —
 * 다 모으기 전에 같은 종이 또 오면 모으는 일이 운에 맡겨진다.
 */
export function releaseAndNext(engine, now) {
  const collected = collect(engine.collected, engine.species)
  return {
    ...engine,
    collected,
    species: pickSpecies(engine.rng, collected),
    eaten: 0,
    lastFedAt: now,
    pending: 0,
    food: [],
  }
}

/** 그리는 쪽이 알고 싶어 하는 것만 모아 준다. */
export function snapshot(engine) {
  const stage = stageOf(engine.eaten)
  return {
    stage,
    eaten: engine.eaten,
    hunger: hungerAt(engine.lastFedAt, engine.now),
    state: engine.brain.state,
    alpha: visibility(stage, engine.brain.state, engine.gameMode),
    length: lengthNow(engine),
    species: engine.species,
    collected: engine.collected,
    swimmer: engine.swimmer,
    food: engine.food,
    gameMode: engine.gameMode,
    elapsed: engine.elapsed,
    tailPhase: engine.tailPhase,
    /** 꼬리가 젓는 폭. 빠를수록 크게, 여기까지만. */
    tailSwing: Math.min(
      TAIL_MAX_SWING,
      TAIL_BASE_SWING + Math.abs(engine.swimmer.speed) * TAIL_SPEED_SWING,
    ),
    justAte: engine.justAte,
  }
}
