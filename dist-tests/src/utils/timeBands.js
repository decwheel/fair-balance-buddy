import { toZonedTime, format as formatTZ } from 'date-fns-tz';
const DUBLIN_TZ = 'Europe/Dublin';
export function resolveBand(tsISO, rules) {
    // Convert to Dublin timezone (handles DST automatically)
    const dublinTime = toZonedTime(new Date(tsISO), DUBLIN_TZ);
    const timeStr = formatTZ(dublinTime, 'HH:mm', { timeZone: DUBLIN_TZ });
    const dayOfWeek = dublinTime.getDay();
    const month = dublinTime.getMonth() + 1; // 1-12
    // Determine season (simplified: Oct-Mar = winter, Apr-Sep = summer)
    const season = (month >= 4 && month <= 9) ? 'summer' : 'winter';
    // Default bands for different meter types
    if (rules.meterType === '24HR') {
        return 'standard';
    }
    if (rules.meterType === 'DAY_NIGHT') {
        // Standard Irish day/night: Night 11pm-8am, Day 8am-11pm
        const hour = parseInt(timeStr.split(':')[0]);
        return (hour >= 23 || hour < 8) ? 'night' : 'day';
    }
    if (rules.meterType === 'SMART_TOU') {
        // Check custom bands from rules
        for (const [bandName, bandRule] of Object.entries(rules.bands)) {
            // Check day of week
            if (bandRule.days && !bandRule.days.includes(dayOfWeek)) {
                continue;
            }
            // Check season
            if (bandRule.seasons && !bandRule.seasons.includes(season)) {
                continue;
            }
            // Check time range
            if (isTimeInRange(timeStr, bandRule.start, bandRule.end)) {
                return bandName;
            }
        }
        // Default fallback for SMART_TOU
        return 'standard';
    }
    return 'standard';
}
function isTimeInRange(time, start, end) {
    const timeMinutes = timeToMinutes(time);
    const startMinutes = timeToMinutes(start);
    const endMinutes = timeToMinutes(end);
    if (startMinutes <= endMinutes) {
        // Normal range (e.g., 08:00-18:00)
        return timeMinutes >= startMinutes && timeMinutes < endMinutes;
    }
    else {
        // Overnight range (e.g., 23:00-07:00)
        return timeMinutes >= startMinutes || timeMinutes < endMinutes;
    }
}
function timeToMinutes(time) {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
}
export const STANDARD_IRISH_BANDS = {
    meterType: 'SMART_TOU',
    bands: {
        peak: {
            start: '17:00',
            end: '19:00',
            days: [1, 2, 3, 4, 5], // Mon-Fri
            seasons: ['winter']
        },
        day: {
            start: '08:00',
            end: '23:00',
            seasons: ['summer', 'winter']
        },
        night: {
            start: '23:00',
            end: '08:00',
            seasons: ['summer', 'winter']
        }
    }
};
