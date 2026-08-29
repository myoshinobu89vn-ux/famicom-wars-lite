'use strict';

// 防御側タイプ -> 効果抜群となる攻撃側タイプの一覧（ポケモンGO仕様）
const TYPE_CHART = {
  'ノーマル': ['かくとう'],
  'ほのお': ['みず', 'じめん', 'いわ'],
  'みず': ['でんき', 'くさ'],
  'でんき': ['じめん'],
  'くさ': ['ほのお', 'こおり', 'どく', 'ひこう', 'むし'],
  'こおり': ['ほのお', 'かくとう', 'いわ', 'はがね'],
  'かくとう': ['ひこう', 'エスパー', 'フェアリー'],
  'どく': ['じめん', 'エスパー'],
  'じめん': ['みず', 'くさ', 'こおり'],
  'ひこう': ['でんき', 'こおり', 'いわ'],
  'エスパー': ['むし', 'ゴースト', 'あく'],
  'むし': ['ほのお', 'ひこう', 'いわ'],
  'いわ': ['みず', 'くさ', 'かくとう', 'じめん', 'はがね'],
  'ゴースト': ['ゴースト', 'あく'],
  'ドラゴン': ['こおり', 'ドラゴン', 'フェアリー'],
  'あく': ['かくとう', 'むし', 'フェアリー'],
  'はがね': ['ほのお', 'かくとう', 'じめん'],
  'フェアリー': ['どく', 'はがね'],
};

const ALL_TYPES = Object.keys(TYPE_CHART);

// 覚え方のヒント：防御側タイプ -> 攻撃側タイプ -> 一言で理由を説明する文
const MNEMONIC_HINTS = {
  'ノーマル': {
    'かくとう': 'ノーマルは無属性、格闘家の直接攻撃に弱い。',
  },
  'ほのお': {
    'みず': '水をかけられたら火は消えてしまう。',
    'じめん': '土に埋もれると燃え広がれない。',
    'いわ': '硬い岩には火が通らず押し潰される。',
  },
  'みず': {
    'でんき': '水は電気をよく通してしまう。',
    'くさ': '草の根に水を吸われて弱る。',
  },
  'でんき': {
    'じめん': '地面に流れて電気が逃げてしまう。',
  },
  'くさ': {
    'ほのお': '火はあっという間に燃え広がる。',
    'こおり': '凍らされると枯れてしまう。',
    'どく': '毒に侵されて内側から弱る。',
    'ひこう': '上空からの攻撃は防げない。',
    'むし': '虫に葉を食べられてしまう。',
  },
  'こおり': {
    'ほのお': '熱で一瞬にして溶けてしまう。',
    'かくとう': '格闘家の一撃で砕け散る。',
    'いわ': '硬い岩にぶつかると割れる。',
    'はがね': '鋼の硬さに氷は砕かれる。',
  },
  'かくとう': {
    'ひこう': '空中の敵（ひこう）には届かない。',
    'エスパー': '肉体戦は精神攻撃（エスパー）に弱い。',
    'フェアリー': 'フェアリーは"優しさ"で格闘を無力化する。',
  },
  'どく': {
    'じめん': '毒は地面に落ちると弱くなる。',
    'エスパー': '精神攻撃（エスパー）は毒を制御できる。',
  },
  'じめん': {
    'みず': '水に流されて地面が緩んでしまう。',
    'くさ': '草は地面を覆って弱める。',
    'こおり': '氷は地面を固めて割る。',
  },
  'ひこう': {
    'でんき': '電気は空中の敵を撃ち落とす。',
    'こおり': '氷は翼を凍らせる。',
    'いわ': '岩は重くて飛行を妨害する。',
  },
  'エスパー': {
    'むし': 'むしは本能で精神を乱す。',
    'ゴースト': '形のない霊の攻撃は防げない。',
    'あく': '悪は心の闇で精神をかき消す。',
  },
  'むし': {
    'ほのお': '炎に焼かれてひとたまりもない。',
    'ひこう': '飛行は虫を吹き飛ばす。',
    'いわ': '岩は虫を押し潰す。',
  },
  'いわ': {
    'みず': '水に削られて崩れてしまう。',
    'くさ': '根に割られてひびが入る。',
    'かくとう': '格闘家のパワーで叩き割られる。',
    'じめん': '地面の力で崩されてしまう。',
    'はがね': '鋼の硬さには岩も砕かれる。',
  },
  'ゴースト': {
    'ゴースト': '同じ霊の力には抗えない。',
    'あく': '闇（あく）の力に弱い。',
  },
  'ドラゴン': {
    'こおり': '極寒の冷気には耐えられない。',
    'ドラゴン': '同格の竜の力とぶつかり合う。',
    'フェアリー': '伝説の力も妖精には通じない。',
  },
  'あく': {
    'かくとう': '正義感あふれる格闘家に弱い。',
    'むし': '虫の本能には裏をかけない。',
    'フェアリー': '妖精の力に浄化されてしまう。',
  },
  'はがね': {
    'ほのお': '高温の炎に溶かされてしまう。',
    'かくとう': '格闘家のパワーで叩き曲げられる。',
    'じめん': '地中深くに埋められ錆びてしまう。',
  },
  'フェアリー': {
    'どく': '毒には浄化の力が及ばない。',
    'はがね': '鋼の硬さには魔法も効かない。',
  },
};

// 主なポケモン名：タイプ -> 代表的なポケモン3〜4体
const TYPE_POKEMON = {
  'ノーマル': ['カビゴン', 'イーブイ', 'ポリゴン', 'ラッタ'],
  'ほのお': ['リザードン', 'ブースター', 'ウインディ', 'バクフーン'],
  'みず': ['カメックス', 'シャワーズ', 'ギャラドス', 'ラプラス'],
  'でんき': ['ピカチュウ', 'サンダース', 'ライチュウ', 'エレブー'],
  'くさ': ['フシギバナ', 'ナッシー', 'キノガッサ', 'モンジャラ'],
  'こおり': ['フリーザー', 'ジュゴン', 'パルシェン', 'オニゴーリ'],
  'かくとう': ['カイリキー', 'サワムラー', 'エビワラー', 'ローブシン'],
  'どく': ['ベトベトン', 'マタドガス', 'アーボック', 'ドガース'],
  'じめん': ['ダグトリオ', 'サンド', 'ガブリアス', 'ドリュウズ'],
  'ひこう': ['ピジョット', 'ファイヤー', 'エアームド', 'チルタリス'],
  'エスパー': ['フーディン', 'ミュウ', 'ユンゲラー', 'ケーシィ'],
  'むし': ['カイロス', 'ストライク', 'バタフリー', 'ヘラクロス'],
  'いわ': ['イワーク', 'ゴローン', 'サイドン', 'イシツブテ'],
  'ゴースト': ['ゲンガー', 'ゴースト', 'ムウマ', 'ミカルゲ'],
  'ドラゴン': ['カイリュー', 'ボーマンダ', 'ミニリュウ', 'キバゴ'],
  'あく': ['バンギラス', 'ヘルガー', 'ヤミラミ', 'サザンドラ'],
  'はがね': ['ハガネール', 'メタグロス', 'ジバコイル', 'ダンバル'],
  'フェアリー': ['ピクシー', 'マリルリ', 'ニンフィア', 'ミミッキュ'],
};

const questionArea = document.getElementById('question-type');
const choicesArea = document.getElementById('choices');
const resultArea = document.getElementById('result-area');
const resultJudge = document.getElementById('result-judge');
const resultDetail = document.getElementById('result-detail');
const nextButton = document.getElementById('next-button');
const streakScore = document.getElementById('streak-score');
const totalScore = document.getElementById('total-score');

let currentType = null;
let previousType = null;
let currentCorrectAnswer = null;
let answered = false;
let streakCount = 0;
let totalCorrect = 0;
let totalQuestions = 0;

function pickRandom(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function shuffle(array) {
  const result = array.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function pickQuestionType() {
  let type;
  do {
    type = pickRandom(ALL_TYPES);
  } while (type === previousType && ALL_TYPES.length > 1);
  return type;
}

function buildChoices(questionType) {
  const effectiveTypes = TYPE_CHART[questionType];
  const correctAnswer = pickRandom(effectiveTypes);

  const incorrectPool = ALL_TYPES.filter((type) => !effectiveTypes.includes(type));
  const shuffledIncorrect = shuffle(incorrectPool);
  const incorrectAnswers = shuffledIncorrect.slice(0, 2);

  return {
    correctAnswer,
    choices: shuffle([correctAnswer, ...incorrectAnswers]),
  };
}

function renderQuestion() {
  answered = false;
  currentType = pickQuestionType();
  previousType = currentType;

  const { correctAnswer, choices } = buildChoices(currentType);
  currentCorrectAnswer = correctAnswer;

  questionArea.textContent = currentType;
  questionArea.className = 'type-display type-' + currentType;

  choicesArea.innerHTML = '';
  choices.forEach((type) => {
    const button = document.createElement('button');
    button.className = 'choice-button type-' + type;
    button.textContent = type;
    button.addEventListener('click', () => handleAnswer(type, button));
    choicesArea.appendChild(button);
  });

  // 解答前に解説・ヒント・代表ポケモンを先に描画しておくことで、回答後もレイアウトの高さが変わらないようにする
  const effectiveTypes = TYPE_CHART[currentType];
  const effectiveList = effectiveTypes.join('、');
  const hint = MNEMONIC_HINTS[currentType][correctAnswer];
  const pokemonList = TYPE_POKEMON[correctAnswer].join('、');

  resultDetail.innerHTML = [
    { cls: 'detail-line', text: `「${currentType}」タイプに効果抜群な攻撃タイプ：${effectiveList}` },
    { cls: 'detail-line', text: `「${correctAnswer}」は「${currentType}」に効果抜群です。` },
    { cls: 'hint-line', text: `💡 覚え方のヒント：${hint}` },
    { cls: 'pokemon-line', text: `📌 「${correctAnswer}」の主なポケモン：${pokemonList}` },
  ].map(({ cls, text }) => `<p class="${cls}">${text}</p>`).join('');
  resultJudge.innerHTML = '&nbsp;';

  resultArea.className = 'result-area invisible';
  nextButton.classList.add('invisible');
  nextButton.disabled = true;
}

function handleAnswer(selectedType, selectedButton) {
  if (answered) return;
  answered = true;

  const isCorrect = selectedType === currentCorrectAnswer;
  totalQuestions++;
  if (isCorrect) {
    totalCorrect++;
    streakCount++;
  } else {
    streakCount = 0;
  }
  updateScoreDisplay();

  Array.from(choicesArea.children).forEach((button) => {
    button.disabled = true;
    if (button.textContent === currentCorrectAnswer) {
      button.classList.add('correct');
    } else if (button === selectedButton) {
      button.classList.add('incorrect');
    }
  });

  resultArea.className = 'result-area ' + (isCorrect ? 'result-correct' : 'result-incorrect');
  resultJudge.textContent = isCorrect ? '正解！' : '不正解…';

  nextButton.classList.remove('invisible');
  nextButton.disabled = false;
}

function updateScoreDisplay() {
  streakScore.textContent = streakCount;
  totalScore.textContent = `${totalCorrect} / ${totalQuestions}`;
}

nextButton.addEventListener('click', renderQuestion);

updateScoreDisplay();
renderQuestion();
