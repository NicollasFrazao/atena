/**
 * Unit conversion constants shared by the API: time units (for duration arithmetic and windows)
 * and the percent scale. The composite durations are built from the base units so that every
 * conversion reads as a chain of named factors.
 */

/** Milliseconds in one second. */
export const MS_PER_SECOND = 1000;

/** Seconds in one minute. */
export const SECONDS_PER_MINUTE = 60;

/** Minutes in one hour. */
export const MINUTES_PER_HOUR = 60;

/** Hours in one day. */
export const HOURS_PER_DAY = 24;

/** Days in one week. */
export const DAYS_PER_WEEK = 7;

/** Seconds in one hour. */
export const SECONDS_PER_HOUR = MINUTES_PER_HOUR * SECONDS_PER_MINUTE;

/** Milliseconds in one minute. */
export const MS_PER_MINUTE = SECONDS_PER_MINUTE * MS_PER_SECOND;

/** Milliseconds in one hour. */
export const MS_PER_HOUR = MINUTES_PER_HOUR * MS_PER_MINUTE;

/** Milliseconds in one day. */
export const MS_PER_DAY = HOURS_PER_DAY * MS_PER_HOUR;

/** A whole expressed in percent: multiplies a fraction (`0.66`) into a percentage (`66`). */
export const HUNDRED_PERCENT = 100;
