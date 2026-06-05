import { StudyTime } from "./types";

export function totalMinutes(time: StudyTime) {
  return (
    time.readingMinutes +
    time.exerciseMinutes +
    time.practiceMinutes +
    time.extensionMinutes
  );
}

export function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}
