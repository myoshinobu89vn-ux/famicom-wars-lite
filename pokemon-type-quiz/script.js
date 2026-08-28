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

  // 解答前に解説文を先に描画しておくことで、回答後もレイアウトの高さが変わらないようにする
  const effectiveTypes = TYPE_CHART[currentType];
  const effectiveList = effectiveTypes.join('、');
  resultDetail.innerHTML = [
    `「${currentType}」タイプに効果抜群な攻撃タイプ：${effectiveList}`,
    `「${correctAnswer}」は「${currentType}」に効果抜群です。`,
  ].map((line) => `<p>${line}</p>`).join('');
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
