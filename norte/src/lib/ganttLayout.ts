import type { LifecycleRange } from '../../shared/delivery-lifecycle.mjs';
import type { ScheduleGroup, ScheduleTask } from './schedulePlanning';
import type { Language } from './types';

export const DAY = 86_400_000;
export const utcTime = (date: string) => {
  const time = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN;
  return Number.isFinite(time) ? time : null;
};

export type GanttWindow = { start: number; end: number; span: number };
export type GanttPlacement = { task: ScheduleTask; from: number; to: number; level: number; labelOutside: boolean };
export type GanttLane = {
  id: string;
  phase: LifecycleRange | null;
  title: string;
  tasks: ScheduleTask[];
  reviews: GanttPlacement[];
  activities: GanttPlacement[];
  undated: ScheduleTask[];
  outside: number;
  reviewLevels: number;
  activityLevels: number;
  height: number;
};

export const LANE_ROW = 24,
  LANE_PAD = 10,
  LANE_MIN = 54;
const CHAR = 6.4;
const textWidth = (text: string) => Math.min(240, Math.ceil(text.length * CHAR));
export const reviewCode = (task: ScheduleTask) => task.reviewCode || task.title.split(/\s*[·:]\s*/)[0].trim();

/** First row whose last item ends before this one starts; rows beyond the limit share the last one. */
function stack(spans: { left: number; right: number }[], limit: number) {
  const ends: number[] = [];
  return spans.map(span => {
    let level = ends.findIndex(end => span.left > end);
    if (level < 0) level = ends.length < limit ? ends.length : limit - 1;
    ends[level] = Math.max(ends[level] ?? -Infinity, span.right);
    return level;
  });
}

/**
 * One lane per phase (plus unassigned work). Reviews sit on the first rows and activities below them,
 * stacked so neither the markers nor their labels overlap at the measured width.
 */
export function layoutLanes(groups: readonly ScheduleGroup[], window: GanttWindow, width: number): GanttLane[] {
  const px = (time: number) => ((time - window.start) / window.span) * width;
  return groups.map(group => {
    const undated: ScheduleTask[] = [];
    let outside = 0;
    const reviews: { task: ScheduleTask; from: number; to: number; left: number; right: number }[] = [];
    const activities: {
      task: ScheduleTask;
      from: number;
      to: number;
      left: number;
      right: number;
      labelOutside: boolean;
    }[] = [];
    for (const task of group.tasks) {
      const due = utcTime(task.dueDate),
        start = utcTime(task.startDate);
      if (due === null && start === null) {
        undated.push(task);
        continue;
      }
      if (task.kind === 'review') {
        const at = (due ?? start)!;
        if (at < window.start || at > window.end) {
          outside++;
          continue;
        }
        const x = px(at);
        reviews.push({ task, from: at, to: at, left: x - 9, right: x + 14 + textWidth(reviewCode(task)) + 30 });
      } else {
        let from = (start ?? due)!,
          to = (due ?? start)! + DAY;
        if (to <= from) [from, to] = [to - DAY, from + DAY];
        if (to < window.start || from > window.end) {
          outside++;
          continue;
        }
        const left = Math.max(0, px(from)),
          right = Math.min(width, Math.max(left + 8, px(to)));
        const labelOutside = right - left < textWidth(task.title) + 18;
        activities.push({
          task,
          from,
          to,
          left,
          right: labelOutside ? right + 8 + textWidth(task.title) : right,
          labelOutside,
        });
      }
    }
    reviews.sort((a, b) => a.from - b.from);
    activities.sort((a, b) => a.from - b.from || a.to - b.to);
    const reviewRows = stack(reviews, 3),
      activityRows = stack(activities, 8);
    const reviewLevels = reviews.length ? Math.max(...reviewRows) + 1 : 0,
      activityLevels = activities.length ? Math.max(...activityRows) + 1 : 0;
    const height = Math.max(
      LANE_MIN,
      LANE_PAD * 2 + (reviewLevels + activityLevels) * LANE_ROW + (reviewLevels && activityLevels ? 4 : 0),
    );
    return {
      id: group.id,
      phase: group.phase,
      title: group.title,
      tasks: group.tasks,
      undated,
      outside,
      reviewLevels,
      activityLevels,
      height,
      reviews: reviews.map((item, index) => ({
        task: item.task,
        from: item.from,
        to: item.to,
        level: reviewRows[index],
        labelOutside: false,
      })),
      activities: activities.map((item, index) => ({
        task: item.task,
        from: item.from,
        to: item.to,
        level: activityRows[index],
        labelOutside: item.labelOutside,
      })),
    };
  });
}

/** Lane heights that fill the visible height: spare room is shared equally, up to a cap, so few phases do not tower. */
export function fitLanes(heights: readonly number[], available: number, cap = 150) {
  const sizes = [...heights];
  let free = available - sizes.reduce((sum, size) => sum + size, 0);
  while (free > 0.5) {
    const open = sizes.flatMap((size, index) => (size < cap ? [index] : []));
    if (!open.length) break;
    const share = free / open.length;
    for (const index of open) {
      const add = Math.min(share, cap - sizes[index]);
      sizes[index] += add;
      free -= add;
    }
  }
  return sizes.map(Math.floor);
}

export type AxisSegment = { key: string; label: string; left: number; width: number };
/** Two tiers that adapt to the zoom: years over months (or quarters), or months over weeks. Positions are percentages. */
export function axisTiers(window: GanttWindow, width: number, language: Language) {
  const locale = language === 'pt' ? 'pt-BR' : 'en',
    pxPerDay = width / (window.span / DAY);
  const percent = (time: number) => ((time - window.start) / window.span) * 100;
  const segment = (key: string, label: string, from: number, to: number): AxisSegment => {
    const left = Math.max(0, percent(from)),
      right = Math.min(100, percent(to));
    return { key, label, left, width: Math.max(0, right - left) };
  };
  const monthName = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }),
    monthLong = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const first = new Date(window.start),
    top: AxisSegment[] = [],
    bottom: AxisSegment[] = [];
  let unit: 'weeks' | 'months' | 'quarters';
  if (pxPerDay * 7 >= 30) {
    unit = 'weeks';
    for (
      let year = first.getUTCFullYear(), month = first.getUTCMonth();
      Date.UTC(year, month, 1) < window.end;
      month++
    ) {
      const from = Date.UTC(year, month, 1),
        to = Date.UTC(year, month + 1, 1);
      top.push(segment(`m${from}`, monthLong.format(from), from, to));
    }
    const monday = window.start - ((new Date(window.start).getUTCDay() + 6) % 7) * DAY;
    for (let from = monday; from < window.end; from += 7 * DAY)
      bottom.push(segment(`w${from}`, String(new Date(from).getUTCDate()).padStart(2, '0'), from, from + 7 * DAY));
  } else {
    unit = pxPerDay * 30.4 >= 18 ? 'months' : 'quarters';
    for (let year = first.getUTCFullYear(); Date.UTC(year, 0, 1) < window.end; year++)
      top.push(segment(`y${year}`, String(year), Date.UTC(year, 0, 1), Date.UTC(year + 1, 0, 1)));
    const step = unit === 'months' ? 1 : 3,
      initials = pxPerDay * 30.4 < 34;
    for (
      let year = first.getUTCFullYear(),
        month = unit === 'months' ? first.getUTCMonth() : Math.floor(first.getUTCMonth() / 3) * 3;
      Date.UTC(year, month, 1) < window.end;
      month += step
    ) {
      const from = Date.UTC(year, month, 1),
        to = Date.UTC(year, month + step, 1),
        index = new Date(from).getUTCMonth();
      const name = monthName.format(from).replace('.', '');
      bottom.push(
        segment(
          `u${from}`,
          unit === 'quarters'
            ? `${language === 'pt' ? 'T' : 'Q'}${Math.floor(index / 3) + 1}`
            : initials
              ? name.charAt(0).toUpperCase()
              : name,
          from,
          to,
        ),
      );
    }
  }
  // Partial periods at the edges keep their grid line but drop a label that would not fit.
  const fit = (items: AxisSegment[], minimum: number) =>
    items
      .filter(item => item.width > 0)
      .map(item => ((item.width / 100) * width < minimum ? { ...item, label: '' } : item));
  return { unit, top: fit(top, unit === 'weeks' ? 70 : 34), bottom: fit(bottom, 16) };
}
