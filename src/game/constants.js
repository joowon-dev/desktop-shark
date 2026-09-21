// 튜닝 값 전부. 흩어 두면 손볼 때 못 찾는다.
//
// **「손맛」이라고 적힌 값은 계산에서 나온 것이 아니다.** 눈으로 보고 정한 값이라
// 바꿔도 아무 테스트가 안 깨질 수 있다. 4구의 DRAW_GAIN 이 그랬다.

/** 고정 타임스텝. 프레임 시간을 그대로 적분하면 기계마다 결과가 달라진다. */
export const DT = 1 / 60

// MARK: 헤엄

/** 순찰 속력 (화면 짧은 변 대비 비율/초). 손맛. */
export const CRUISE_SPEED = 0.10
/** 돌진은 순찰의 몇 배인가. 손맛 — 2.2 아래로는 「달려온다」는 느낌이 안 난다. */
export const DASH_MULTIPLIER = 2.2
/** 만족·에워쌈은 느긋하다. 손맛. */
export const SATED_SPEED = 0.06
export const PROWL_SPEED = 0.08

/**
 * 초당 최대 선회 각도(라디안). **이 앱에서 제일 중요한 한 값이다** —
 * 상어가 제자리에서 홱 도는 순간 물고기가 아니라 커서가 된다.
 * 1.6 rad/s ≈ 92°/s. 손맛.
 */
export const TURN_RATE = 1.6
/** 돌진 중에는 조금 더 꺾는다. 손맛. */
export const DASH_TURN_RATE = 2.4

/** 속력이 목표 속력에 붙는 빠르기(1/초). 손맛. */
export const SPEED_LERP = 3.0

// MARK: 밥

/** 화면에 동시에 떠 있는 밥의 최대 개수. */
export const MAX_FOOD = 5
/** 밥이 사라지기까지(초). */
export const FOOD_LIFETIME = 20
/** 밥이 가라앉는 속도(화면 짧은 변 대비 비율/초). 손맛. */
export const FOOD_SINK_SPEED = 0.02
/** 상어 입이 밥에 이만큼 가까우면 먹은 것으로 친다(화면 짧은 변 대비). 손맛. */
export const EAT_RADIUS = 0.025

// MARK: 배고픔

/** 배고픔이 1.0 에 닿기까지(초). 6 시간. 손맛 — 하루 한두 번 들여다보는 리듬. */
export const HUNGER_FULL_SECONDS = 6 * 60 * 60
/** 이 위로 올라가면 에워싼다. 손맛. */
export const PROWL_THRESHOLD = 0.7

// MARK: 상태 시간

/** 숨어 있다 순찰을 나가기까지(초). 이 사이에서 무작위. 손맛. */
export const HIDE_MIN = 20
export const HIDE_MAX = 45
/** 먹는 동안 멈칫하는 시간(초). */
export const EAT_DURATION = 0.25
/** 먹고 나서 느긋하게 도는 시간(초). */
export const SATED_DURATION = 6

// MARK: 성장

/** 단계 문턱. 누적 먹이가 이 값 이상이면 그 단계다. **서버의 shark_stage 와 같아야 한다.** */
export const STAGE_THRESHOLDS = [0, 5, 15, 35, 70, 120]

/** 단계별 몸 길이 (화면 짧은 변 대비 비율). 손맛. */
export const STAGE_LENGTHS = [0.06, 0.09, 0.13, 0.18, 0.24, 0.32]

/** 단계별 기본 선명도. 많이 먹일수록 또렷해진다. 손맛. */
export const STAGE_ALPHAS = [0.18, 0.24, 0.31, 0.39, 0.47, 0.55]

// MARK: 가시성

/** 상태별 선명도 배율. */
export const STATE_ALPHA = {
  hidden: 0,
  cruise: 1,
  prowl: 1.3,
  dash: 1.8,
  eat: 1.8,
  sated: 1.2,
}

/** 게임모드에서는 상어도 더 잘 보인다. 손맛. */
export const GAME_MODE_ALPHA = 1.6

/** 아무리 진해도 여기까지. 바탕화면을 가리면 안 된다. 손맛. */
export const MAX_ALPHA = 0.85
