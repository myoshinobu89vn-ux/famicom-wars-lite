(() => {
  'use strict';

  const LOOKAHEAD_MIN = 15; // 一覧に表示する範囲(現在時刻から何分以内に発車するか)
  const SKIP_SEARCH_MIN = 60; // 「見送り」比較で後続電車を探す範囲(分)

  const nowTimeEl = document.getElementById('now-time');
  const nowDaytypeEl = document.getElementById('now-daytype');
  const holidayNoticeEl = document.getElementById('holiday-notice');
  const listEl = document.getElementById('train-list');
  const emptyMessageEl = document.getElementById('empty-message');
  const dataUpdatedAtEl = document.getElementById('data-updated-at');

  dataUpdatedAtEl.textContent = TIMETABLE_DATA.updatedAt;

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

  function buildUpcomingTrains(now) {
    const dayType = getDayType(now);
    const { rows, isFallback } = getActiveDataset(dayType);

    const trains = rows
      .filter(([, , dest]) => !TIMETABLE_DATA.notReachingShinjuku.has(dest))
      .map(([time, type, dest]) => {
        const [hh, mm] = time.split(':').map(Number);
        const departure = nextOccurrence(now, hh, mm);
        const durationMin = TIMETABLE_DATA.durationMin[type];
        const arrival = new Date(departure.getTime() + durationMin * 60000);
        return { time, type, dest, departure, arrival, durationMin };
      })
      .sort((a, b) => a.departure - b.departure);

    return { trains, dayType, isFallback };
  }

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

  function destArrivalLabel(dest) {
    if (dest === 'shinjuku') return '新宿';
    if (dest === 'shinsen_shinjuku') return '新線新宿';
    // 本八幡・大島方面の電車は新線新宿経由で都営新宿線へ直通するため、
    // 新宿方面への到着目安として新線新宿の到着予定を表示する
    return '新線新宿';
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

    const fastestArrival = upcoming.reduce(
      (min, item) => (item.train.arrival < min ? item.train.arrival : min),
      upcoming[0].train.arrival
    );

    listEl.innerHTML = upcoming
      .map(({ train, index }) => {
        const isFastest = train.arrival.getTime() === fastestArrival.getTime();
        const alt = findBestAlternative(trains, index);

        let skipLine;
        if (alt && alt.arrival < train.arrival) {
          const diffMin = Math.round((train.arrival - alt.arrival) / 60000);
          skipLine = `見送って ${formatHM(alt.departure)}発 ${TIMETABLE_DATA.typeLabel[alt.type]} に乗ると ${destArrivalLabel(alt.dest)} ${formatHM(alt.arrival)}着(${diffMin}分早い)`;
        } else if (alt) {
          const diffMin = Math.round((alt.arrival - train.arrival) / 60000);
          skipLine = `見送ると ${formatHM(alt.departure)}発 ${TIMETABLE_DATA.typeLabel[alt.type]} で ${destArrivalLabel(alt.dest)} ${formatHM(alt.arrival)}着(${diffMin}分遅くなります)`;
        } else {
          skipLine = 'この時間帯では見送り後の比較対象がありません';
        }

        const destNote = train.dest === 'shinjuku' || train.dest === 'shinsen_shinjuku'
          ? ''
          : `<span class="dest-note">${TIMETABLE_DATA.destLabel[train.dest]}方面</span>`;

        return `
          <article class="train-card${isFastest ? ' fastest' : ''}" data-type="${train.type}">
            ${isFastest ? '<div class="fastest-badge">最速</div>' : ''}
            <div class="train-main">
              <div class="train-dep">
                <span class="dep-time">${formatHM(train.departure)}</span>
                <span class="type-badge type-${train.type}">${TIMETABLE_DATA.typeLabel[train.type]}</span>
              </div>
              <div class="train-countdown">${formatCountdown(train.departure - now)}</div>
            </div>
            <div class="train-arrival">
              ${destArrivalLabel(train.dest)}着予定 <strong>${formatHM(train.arrival)}</strong>
              <span class="duration-note">(所要${train.durationMin}分)</span>
              ${destNote}
            </div>
            <div class="skip-line">${skipLine}</div>
          </article>
        `;
      })
      .join('');
  }

  render();
  setInterval(render, 1000);
})();
