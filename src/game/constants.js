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

/** 화면에 동시에 떠 있는 밥의 최대 개수. 타자로도 떨어지므로 넉넉하다. */
export const MAX_FOOD = 10

/**
 * 밥 두 종류.
 *
 * **클릭은 드물고 일부러 하는 것, 타자는 잦고 무심코 하는 것**이라 값이 열 배 다르다.
 * 비슷하면 타이핑만으로 며칠 만에 다 커 버려서 키우는 일이 사라진다 — 타자는 「조금씩
 * 쌓이는 배경」이고 클릭이 「먹이는 행위」다.
 *
 * 크기는 작다. 바탕화면 위에 늘 떠 있는 것이라 눈에 띄면 일하는 데 거슬린다 —
 * 상어가 먹으러 오는 것이 보이면 충분하다. 둘 다 손맛이다.
 */
export const FOOD_KINDS = {
  big: { value: 10, radius: 0.0075 },
  small: { value: 1, radius: 0.0035 },
}

/**
 * 타자로 밥이 떨어지는 최소 간격(초). 연타로 화면을 채우지 않게 막는다.
 * 손맛 — 0.6 초면 빠르게 쳐도 1 분에 100 개 언저리다.
 */
export const TYPE_FEED_INTERVAL = 0.6
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

/** 한 번 순찰하는 시간(초). 이 사이에서 무작위. 손맛. */
export const CRUISE_MIN = 10
export const CRUISE_MAX = 22

/**
 * 가장자리에서 되돌아 나오기 시작하는 거리(화면 짧은 변 대비).
 *
 * **상어는 화면 밖으로 나가지 않는다.** 나가 버리면 「바탕화면에 산다」가 아니라
 * 「가끔 지나간다」가 되고, 밥을 줘도 한참을 기다려야 한다. 이 띠 안에 들어오면
 * 목표를 화면 안쪽으로 끌어와서 스스로 크게 선회해 돌아 나온다.
 */
export const WALL_MARGIN = 0.18
/** 먹는 동안 멈칫하는 시간(초). */
export const EAT_DURATION = 0.25
/** 먹고 나서 느긋하게 도는 시간(초). */
export const SATED_DURATION = 6

// MARK: 성장

/**
 * 단계 문턱. 누적 먹이가 이 값 이상이면 그 단계다. **서버의 shark_stage 와 같아야 한다.**
 *
 * 큰 밥이 10 점이므로 클릭 100 번이면 다 큰다. 하루에 몇십 번 눌러 주면 한두 주,
 * 타자만 치면 훨씬 오래 걸린다 — 그 간격이 이 게임의 속도다.
 */
export const STAGE_THRESHOLDS = [0, 30, 100, 250, 550, 1000]

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
