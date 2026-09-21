// 게임 전체를 한 스텝 굴린다. **그리는 법은 모른다.**
//
// 고정 타임스텝이다. 프레임 시간을 그대로 적분하면 기계마다 상어가 다른 속도로 헤엄친다.
// 벽시계(`now`)는 밖에서 받는다 — 순수 모듈은 Date.now() 를 부르지 않는다.

import { DT } from './constants.js'
import { createBrain, intent, stepBrain } from './brain.js'
import { canEat, dropFood, nearestFood, removeFood, stepFood } from './food.js'
import { hungerAt } from './hunger.js'
import { lengthOf, stageOf, visibility } from './growth.js'
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
    // 처음에는 화면 밖 왼쪽에서 들어온다.
    swimmer: createSwimmer(-0.3, bounds.h * 0.5, 0, 0),
    brain: createBrain(rng),
    food: [],
    nextFoodId: 1,
    eaten: options.eaten ?? 0,
    lastFedAt: options.lastFedAt ?? null,
    now: options.now ?? 0,
    gameMode: false,
    /** 서버에 아직 못 올린 먹이 수. */
    pending: 0,
    /** 이번 스텝에 먹었는가 — 그리는 쪽이 물살을 터뜨리는 데 쓴다. */
    justAte: false,
    /** 누적 시간. 흔들림 위상에 쓴다. */
    elapsed: 0,
  }
}

/** 화면 크기가 바뀌었다. */
export function setBounds(engine, bounds) {
  return { ...engine, bounds }
}

export function setGameMode(engine, on) {
  return { ...engine, gameMode: !!on }
}

/** 클릭한 자리에 밥. 게임모드가 아니면 아무 일도 없다 — 애초에 클릭이 안 온다. */
export function feedAt(engine, x, y) {
  const food = dropFood(engine.food, engine.nextFoodId, x, y)
  if (food === engine.food) return engine // 가득 찼다
  return { ...engine, food, nextFoodId: engine.nextFoodId + 1 }
}

/** 상어의 입 — 코끝. 밥을 먹었는지는 몸통이 아니라 여기로 잰다. */
export function mouthOf(engine) {
  const half = lengthOf(stageOf(engine.eaten)) / 2
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
  let food = stepFood(engine.food, dt)

  // 2. 입이 닿았는가. 먹는 중일 때는 다시 물지 않는다.
  const mouth = mouthOf(engine)
  const prey = nearestFood(food, mouth)
  const ateThisStep = engine.brain.state !== 'eat' && canEat(prey, mouth)

  let { eaten, lastFedAt, pending } = engine
  if (ateThisStep) {
    food = removeFood(food, prey.id)
    eaten += 1
    lastFedAt = now
    pending = enqueueFeed(pending)
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

  // 4. 몸이 그쪽으로 헤엄친다.
  const want = intent(brain, { swimmer: engine.swimmer, food, bounds: engine.bounds })
  const swimmer = swimStep(engine.swimmer, want.target, want.speed, dt, want.turnRate)

  return {
    ...engine,
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

/** 그리는 쪽이 알고 싶어 하는 것만 모아 준다. */
export function snapshot(engine) {
  const stage = stageOf(engine.eaten)
  return {
    stage,
    eaten: engine.eaten,
    hunger: hungerAt(engine.lastFedAt, engine.now),
    state: engine.brain.state,
    alpha: visibility(stage, engine.brain.state, engine.gameMode),
    length: lengthOf(stage),
    swimmer: engine.swimmer,
    food: engine.food,
    gameMode: engine.gameMode,
    elapsed: engine.elapsed,
    justAte: engine.justAte,
  }
}
