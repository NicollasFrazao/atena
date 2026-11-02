/** Milliseconds in one second. */
export const MS_PER_SECOND = 1000;

/** Seconds in one minute. */
export const SECONDS_PER_MINUTE = 60;

/** Minutes in one hour. */
export const MINUTES_PER_HOUR = 60;

/** Hours in one day. */
export const HOURS_PER_DAY = 24;

/** Seconds in one hour. */
export const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR;

/** Seconds in one day. */
export const SECONDS_PER_DAY = SECONDS_PER_HOUR * HOURS_PER_DAY;

/** Milliseconds in one minute. */
export const MS_PER_MINUTE = MS_PER_SECOND * SECONDS_PER_MINUTE;

/** Milliseconds in one day. */
export const MS_PER_DAY = MS_PER_SECOND * SECONDS_PER_DAY;

/** The whole of a percentage: a 0–1 fraction times this is the 0–100 value, and the cap of a percent. */
export const PERCENT_SCALE = 100;
