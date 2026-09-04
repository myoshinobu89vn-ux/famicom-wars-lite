(() => {
  'use strict';

  const LOOKAHEAD_MIN = 15; // 一覧に表示する範囲(現在時刻から何分以内に発車するか)
  const SKIP_SEARCH_MIN = 60; // 「見送り」比較・最速判定で後続電車を探す範囲(分)

  // 画面右上に表示するバージョン。変更のたびに更新する。
  const APP_VERSION = 'v1.4';
  const APP_VERSION_NOTE = '乗換マークを追加。ルート側Service Workerのキャッシュ干渉を修正';

  const nowTimeEl = document.getElementById('now-time');
  const nowDaytypeEl = document.getElementById('now-daytype');
  const holidayNoticeEl = document.getElementById('holiday-notice');
  const listEl = document.getElementById('train-list');
  const emptyMessageEl = document.getElementById('empty-message');
  const dataUpdatedAtEl = document.getElementById('data-updated-at');
  const appVersionEl = document.getElementById('app-version');

  dataUpdatedAtEl.textContent = TIMETABLE_DATA.updatedAt;
  appVersionEl.textContent = APP_VERSION;
  appVersionEl.title = APP_VERSION_NOTE;

  function getDayType(date) {
    const day = date.getDay(); // 0:日 6:土
    // 祝日カレンダーは組み込んでいないため、土日のみを「土休日」として扱う
    return day === 0 || day === 6 ? 'holiday' : 'weekday';
  }

  function getActiveDataset(dayType) {
    if (dayType === 'holiday' && TIMETABLE_DATA.holiday) {
      return { rows: TIMETABLE_DATA.holiday, isFallback: false };
    }
    return { rows: TIMETABLE_DATA.weekday, isFallback: dayType === 'holiday' };
  }

  // 指定した「今日のHH:MM」を、nowから見て直近の未来の時刻(Dateオブジェクト)に変換する。
  // 既に過ぎている場合は翌日の同時刻として扱う(深夜0時台の時刻表エントリを正しく繋げるため)。
  function nextOccurrence(now, hh, mm) {
    const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
    if (candidate.getTime() <= now.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate;
  }

  // 千歳烏山発の全電車を、笹塚到着予定時刻つきで組み立てる。
  // 新宿行き以外(本八幡・大島・新線新宿行き)は新宿へ直通しないため、
  // 笹塚での乗り換えを前提に新宿到着予定を別途計算する。
  function buildRawTrains(now, rows) {
    return rows
      .filter(([, , dest]) => !TIMETABLE_DATA.notReachingShinjuku.has(dest))
      .map(([time, type, dest]) => {
        const [hh, mm] = time.split(':').map(Number);
        const departure = nextOccurrence(now, hh, mm);
        const sasazukaArrival = new Date(
          departure.getTime() + TIMETABLE_DATA.durationToSasazukaMin[type] * 60000
        );
        return { time, type, dest, departure, sasazukaArrival };
      })
      .sort((a, b) => a.departure - b.departure);
  }

  function resolveShinjukuArrival(train, shinjukuBoundTrains) {
    if (train.dest === 'shinjuku') {
      return {
        arrival: new Date(train.departure.getTime() + TIMETABLE_DATA.durationMin[train.type] * 60000),
        transfer: null,
      };
    }

    // 笹塚で、自分の笹塚到着より一定時間(乗換バッファ)以上あとに笹塚へ到着する
    // 新宿行き電車の中で、最も早く笹塚に着くものへ乗り換えると仮定する。
    const threshold = train.sasazukaArrival.getTime() + TIMETABLE_DATA.sasazukaTransferBufferMin * 60000;
    const connection = shinjukuBoundTrains.find((t) => t.sasazukaArrival.getTime() >= threshold);

    if (!connection) {
      return { arrival: null, transfer: null };
    }

    const arrival = new Date(
      connection.sasazukaArrival.getTime() + TIMETABLE_DATA.sasazukaToShinjukuMin * 60000
    );
    return {
      arrival,
      transfer: {
        sasazukaArrival: train.sasazukaArrival,
        viaType: connection.type,
        viaSasazukaDeparture: connection.sasazukaArrival,
        viaOriginDeparture: connection.departure,
      },
    };
  }

  function buildUpcomingTrains(now) {
    const dayType = getDayType(now);
    const { rows, isFallback } = getActiveDataset(dayType);

    const rawTrains = buildRawTrains(now, rows);
    const shinjukuBoundTrains = rawTrains
      .filter((t) => t.dest === 'shinjuku')
      .sort((a, b) => a.sasazukaArrival - b.sasazukaArrival);

    const trains = rawTrains
      .map((train) => {
        const { arrival, transfer } = resolveShinjukuArrival(train, shinjukuBoundTrains);
        return { ...train, arrival, transfer };
      })
      .filter((train) => train.arrival !== null)
      .sort((a, b) => a.departure - b.departure);

    return { trains, dayType, isFallback };
  }

  // currentIndex以降(SKIP_SEARCH_MIN以内に発車)で、最も早く新宿へ着く電車を探す。
  function findBestAlternative(trains, currentIndex) {
    const current = trains[currentIndex];
    const limit = new Date(current.departure.getTime() + SKIP_SEARCH_MIN * 60000);
    let best = null;
    for (let i = currentIndex + 1; i < trains.length; i++) {
      const candidate = trains[i];
      if (candidate.departure > limit) break;
      if (!best || candidate.arrival < best.arrival) {
        best = candidate;
      }
    }
    return best;
  }

  function formatClock(date) {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  function formatHM(date) {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }

  function formatCountdown(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `あと${min}分${String(sec).padStart(2, '0')}秒`;
  }

  function render() {
    const now = new Date();
    nowTimeEl.textContent = formatClock(now);
    nowDaytypeEl.textContent = getDayType(now) === 'holiday' ? '土休日' : '平日';

    const { trains, dayType, isFallback } = buildUpcomingTrains(now);
    holidayNoticeEl.classList.toggle('invisible', !(dayType === 'holiday' && isFallback));

    const windowLimit = new Date(now.getTime() + LOOKAHEAD_MIN * 60000);
    const upcoming = [];
    for (let i = 0; i < trains.length; i++) {
      if (trains[i].departure > windowLimit) break;
      upcoming.push({ train: trains[i], index: i });
    }

    if (upcoming.length === 0) {
      listEl.innerHTML = '';
      emptyMessageEl.classList.remove('invisible');
      return;
    }
    emptyMessageEl.classList.add('invisible');

    // 「最速」表示は、SKIP_SEARCH_MIN以内に発車する後続電車に追いつかれない
    // (＝それより早く新宿へ着く電車が存在しない)電車の中で、最も早く着くものにのみ付ける。
    // 後続に追いつかれる電車は、一覧内で到着が最速に見えても強調しない。
    // 「次着」は、それに次いで(異なる時刻に)早く着く、追いつかれない電車。
    const notOvertaken = upcoming.filter(({ train, index }) => {
      const alt = findBestAlternative(trains, index);
      return !(alt && alt.arrival < train.arrival);
    });
    notOvertaken.sort((a, b) => a.train.arrival - b.train.arrival);

    const fastestIndex = notOvertaken.length > 0 ? notOvertaken[0].index : -1;
    const fastestArrival = notOvertaken.length > 0 ? notOvertaken[0].train.arrival : null;
    const secondEntry = notOvertaken.find((item) => item.train.arrival > fastestArrival);
    const secondIndex = secondEntry ? secondEntry.index : -1;

    listEl.innerHTML = upcoming
      .map(({ train, index }) => {
        const isFastest = index === fastestIndex;
        const isSecond = index === secondIndex;
        const alt = findBestAlternative(trains, index);

        let skipLine;
        if (alt && alt.arrival < train.arrival) {
          const diffMin = Math.round((train.arrival - alt.arrival) / 60000);
          skipLine = `見送って ${formatHM(alt.departure)}発 ${TIMETABLE_DATA.typeLabel[alt.type]} に乗ると新宿 ${formatHM(alt.arrival)}着(${diffMin}分早い)`;
        } else if (alt) {
          const diffMin = Math.round((alt.arrival - train.arrival) / 60000);
          skipLine = `見送ると ${formatHM(alt.departure)}発 ${TIMETABLE_DATA.typeLabel[alt.type]} で新宿 ${formatHM(alt.arrival)}着(${diffMin}分遅くなります)`;
        } else {
          skipLine = 'この時間帯では見送り後の比較対象がありません';
        }

        const destNote = train.dest === 'shinjuku'
          ? ''
          : `<span class="dest-note">${TIMETABLE_DATA.destLabel[train.dest]}行き</span>`;

        const transferMark = train.transfer
          ? '<span class="transfer-mark">⇄ 笹塚乗換</span>'
          : '';

        const transferLine = train.transfer
          ? `<div class="transfer-line">笹塚 ${formatHM(train.transfer.sasazukaArrival)}頃着 → ${formatHM(train.transfer.viaSasazukaDeparture)}頃発 ${TIMETABLE_DATA.typeLabel[train.transfer.viaType]}(新宿行き・千歳烏山${formatHM(train.transfer.viaOriginDeparture)}発)に乗り換え</div>`
          : '';

        const cardClass = isFastest ? ' fastest' : isSecond ? ' second-fastest' : '';
        const badge = isFastest
          ? '<div class="fastest-badge">最速</div>'
          : isSecond
            ? '<div class="second-badge">次着</div>'
            : '';

        return `
          <article class="train-card${cardClass}" data-type="${train.type}">
            ${badge}
            <div class="train-main">
              <div class="train-dep">
                <span class="dep-time">${formatHM(train.departure)}</span>
                <span class="type-badge type-${train.type}">${TIMETABLE_DATA.typeLabel[train.type]}</span>
                ${destNote}
                ${transferMark}
              </div>
              <div class="train-countdown">${formatCountdown(train.departure - now)}</div>
            </div>
            <div class="train-arrival">
              新宿着予定 <strong>${formatHM(train.arrival)}</strong>
              <span class="duration-note">(所要${Math.round((train.arrival - train.departure) / 60000)}分)</span>
            </div>
            ${transferLine}
            <div class="skip-line">${skipLine}</div>
          </article>
        `;
      })
      .join('');
  }

  render();
  setInterval(render, 1000);
})();
