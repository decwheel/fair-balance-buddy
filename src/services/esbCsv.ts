import { format, parse } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

export interface EsbReading {
  tsISO: string; // ISO timestamp in Dublin timezone with DST
  kwh: number;
}

export interface EsbCsvParseResult {
  readings: EsbReading[];
  errors: string[];
  totalReadings: number;
  dateRange: {
    start: string;
    end: string;
  } | null;
}

const DUBLIN_TZ = 'Europe/Dublin';

export async function parseEsbCsv(file: File): Promise<EsbCsvParseResult> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const result = processEsbCsvText(text);
      resolve(result);
    };
    
    reader.onerror = () => {
      resolve({
        readings: [],
        errors: ['Failed to read file'],
        totalReadings: 0,
        dateRange: null
      });
    };
    
    reader.readAsText(file);
  });
}

function processEsbCsvText(text: string): EsbCsvParseResult {
  const lines = text.trim().split(/\r?\n/);
  const readings: EsbReading[] = [];
  const errors: string[] = [];

  if (!lines.length) {
    return { readings: [], errors: ['Empty file'], totalReadings: 0, dateRange: null };
  }

  // Header detection (supports: "Read Date, Read Value, Read Type" or simple "DateTime,kWh")
  const headerCells = lines[0].split(/[,;]+/).map(h => h.trim().toLowerCase());
  const idx = (prefix: string) => headerCells.findIndex(h => h.startsWith(prefix));
  const hasStructuredHeader =
    idx('read date') >= 0 ||
    idx('datetime') >= 0 ||
    (headerCells.length === 2 && headerCells[1].includes('kwh'));

  // Use semicolon if found anywhere in the first few lines to avoid decimal-comma issues
  const detectDelimiter = () => {
    for (let i = 0; i < Math.min(lines.length, 5); i++) {
      if (lines[i].includes(';')) return ';';
    }
    return ',';
  };
  const delimiter = detectDelimiter();

  if (hasStructuredHeader) {
    const iDate = idx('read date') >= 0 ? idx('read date') : idx('datetime');
    const iVal  = idx('read value') >= 0 ? idx('read value') : idx('kwh');
    const iType = idx('read type');
    const simple2 = headerCells.length === 2 && headerCells[1].includes('kwh');

    let prevImportTS: Date | null = null;

    for (let r = 1; r < lines.length; r++) {
      const rawLine = lines[r];
      if (!rawLine || !rawLine.trim()) continue;
      const cells = rawLine.split(delimiter);
      if (cells.length < 2) continue;

      // Timestamp
      const rawTS = (simple2 ? cells[0] : cells[iDate] || '').trim();
      let ts: Date;
      try {
        if (/^\d{2}-\d{2}-\d{4}/.test(rawTS)) {
          ts = new Date(rawTS.replace(/(\d{2})-(\d{2})-(\d{4})/, '$3-$2-$1'));
        } else if (/^\d{2}\/\d{2}\/\d{4}/.test(rawTS)) {
          const [d, m, y, rest] = rawTS.split(/[\/ ]/);
          ts = new Date(`${y}-${m}-${d}${rest ? ' ' + rest : ''}`);
        } else {
          ts = new Date(rawTS); // ISO or other
        }
      } catch {
        errors.push(`Line ${r}: invalid date`);
        continue;
      }
      if (isNaN(ts as unknown as number) || isNaN(ts.getTime())) {
        errors.push(`Line ${r}: invalid date`);
        continue;
      }

      // Value (handle decimal commas when semicolon-delimited)
      let valStr = (simple2 ? cells[1] : cells[iVal] || '').replace(/"/g, '').trim();
      if (delimiter === ';') valStr = valStr.replace(',', '.');
      const val = parseFloat(valStr);
      if (isNaN(val)) { errors.push(`Line ${r}: invalid kWh value`); continue; }

      // Type & export filter
      const typ = (simple2 ? 'import' : (cells[iType] || '')).toLowerCase();
      const nextCell = cells[iVal + 1] || '';
      const isExport = typ.includes('export') || /export/i.test(nextCell);
      if (isExport) {
        // Ignore export for now; only import is used for billing
        continue;
      }

      // kW vs kWh detection
      const headerValCell = headerCells[iVal] || '';
      const isKw = !simple2 && (typ.includes('(kw)') || /\(kw\)/i.test(headerValCell));

      let kwh = val;
      if (isKw) {
        let intervalMins = 30;
        if (prevImportTS) {
          const diff = Math.abs(ts.getTime() - prevImportTS.getTime()) / 60000;
          if (diff > 0 && diff <= 90) intervalMins = diff;
        }
        kwh = val * (intervalMins / 60);
        prevImportTS = ts;
      }

      readings.push({ tsISO: ts.toISOString(), kwh });
      if (!isKw) prevImportTS = ts; // keep for next diff if needed
    }
  } else {
    // Fallback: old simple line-by-line parser
    const dataLines = headerCells[0]?.includes('date') || headerCells[0]?.includes('time')
      ? lines.slice(1)
      : lines;

    for (let i = 0; i < dataLines.length; i++) {
      const line = dataLines[i].trim();
      if (!line) continue;
      try {
        const reading = parseEsbCsvLine(line, i + 1);
        if (reading) readings.push(reading);
      } catch (error) {
        errors.push(`Line ${i + 1}: ${error instanceof Error ? error.message : 'Parse error'}`);
      }
    }
  }

  // Sort by timestamp
  readings.sort((a, b) => new Date(a.tsISO).getTime() - new Date(b.tsISO).getTime());

  const dateRange = readings.length > 0 ? {
    start: readings[0].tsISO,
    end: readings[readings.length - 1].tsISO
  } : null;

  return { readings, errors, totalReadings: readings.length, dateRange };
}

function parseEsbCsvLine(line: string, lineNumber: number): EsbReading | null {
  // Expected formats:
  // "2024-01-15 00:30:00,1.25"
  // "15/01/2024 00:30,1.25" 
  // "2024-01-15T00:30:00,1.25"
  // Also support numeric timestamps (seconds/ms/µs/ns) and Excel serial dates

  // Detect delimiter (prefer ';' if present to avoid decimal-comma split)
  const hasSemicolon = line.includes(';');
  const delimiter = hasSemicolon ? ';' : ',';

  const parts = line.split(delimiter);
  if (parts.length < 2) {
    throw new Error('Invalid CSV format - expected date,kwh');
  }

  const dateTimeStr = parts[0].trim().replace(/"/g, '');
  let kwhStr = parts[1].trim().replace(/"/g, '');
  if (delimiter === ';') {
    // If semicolon-delimited, commas inside numbers are likely decimals
    kwhStr = kwhStr.replace(',', '.');
  }

  // Parse kWh value
  const kwh = parseFloat(kwhStr);
  if (isNaN(kwh) || kwh < 0) {
    throw new Error(`Invalid kWh value: ${kwhStr}`);
  }

  // Helpers
  const excelSerialToDate = (serial: number): Date => {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const ms = serial * 24 * 60 * 60 * 1000;
    return new Date(excelEpoch.getTime() + ms);
  };

  const plausible = (d: Date) => {
    if (isNaN(d.getTime())) return false;
    const min = new Date('2000-01-01T00:00:00Z').getTime();
    const max = new Date();
    max.setFullYear(max.getFullYear() + 1);
    return d.getTime() >= min && d.getTime() <= max.getTime();
  };

  const bestOf = (cands: Date[], naiveLocal = false): { date: Date; naiveLocal: boolean } => {
    for (const c of cands) if (plausible(c)) return { date: c, naiveLocal };
    const now = Date.now();
    let best = cands[0];
    for (const c of cands) if (Math.abs(c.getTime() - now) < Math.abs(best.getTime() - now)) best = c;
    return { date: best, naiveLocal };
  };

  // Parse datetime - try multiple formats
  let date: Date;
  let isNaiveLocal = false;

  if (/^\d+$/.test(dateTimeStr)) {
    const n = Number(dateTimeStr);
    const cands: Date[] = [];
    cands.push(new Date(n)); // ms
    cands.push(new Date(n * 1000)); // sec
    cands.push(new Date(Math.floor(n / 1000))); // µs -> ms
    cands.push(new Date(Math.floor(n / 1_000_000))); // ns -> ms
    if (n > 20000 && n < 300000) cands.push(excelSerialToDate(n)); // Excel days
    ({ date } = bestOf(cands));
  } else if (dateTimeStr.includes('T')) {
    date = new Date(dateTimeStr);
  } else if (dateTimeStr.includes('/')) {
    const cands = [
      parse(dateTimeStr, 'dd/MM/yyyy HH:mm:ss', new Date()),
      parse(dateTimeStr, 'dd/MM/yyyy HH:mm', new Date())
    ];
    ({ date } = bestOf(cands, true));
    isNaiveLocal = true;
  } else {
    const cands = [
      parse(dateTimeStr, 'yyyy-MM-dd HH:mm:ss', new Date()),
      parse(dateTimeStr, 'yyyy-MM-dd HH:mm', new Date())
    ];
    ({ date } = bestOf(cands, true));
    isNaiveLocal = true;
  }

  if (isNaN(date.getTime())) {
    throw new Error(`Could not parse date: ${dateTimeStr}`);
  }

  const tsISO = isNaiveLocal ? fromZonedTime(date, DUBLIN_TZ).toISOString() : date.toISOString();

  if (lineNumber <= 3) {
    // eslint-disable-next-line no-console
    console.debug('[ESB CSV] row', lineNumber, { raw: dateTimeStr, delimiter, tsISO, kwh });
  }

  return {
    tsISO,
    kwh
  };
}

export function validateEsbReadings(readings: EsbReading[]): {
  isValid: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  
  if (readings.length === 0) {
    issues.push('No readings found');
    return { isValid: false, issues };
  }
  
  // Check for reasonable date range (not older than 3 years)
  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
  
  const oldReadings = readings.filter(r => new Date(r.tsISO) < threeYearsAgo);
  if (oldReadings.length > 0) {
    issues.push(`${oldReadings.length} readings are older than 3 years`);
  }
  
  // Check for future dates
  const futureReadings = readings.filter(r => new Date(r.tsISO) > new Date());
  if (futureReadings.length > 0) {
    issues.push(`${futureReadings.length} readings are in the future`);
  }
  
  // Check for unreasonable kWh values (typical home: 0-10 kWh per 30min)
  const highReadings = readings.filter(r => r.kwh > 10);
  if (highReadings.length > 0) {
    issues.push(`${highReadings.length} readings have unusually high kWh values (>10)`);
  }
  
  // Check for consistent interval (most should be 30min apart)
  if (readings.length > 1) {
    const intervals = [];
    for (let i = 1; i < Math.min(readings.length, 100); i++) {
      const prev = new Date(readings[i - 1].tsISO);
      const curr = new Date(readings[i].tsISO);
      const intervalMin = (curr.getTime() - prev.getTime()) / (1000 * 60);
      intervals.push(intervalMin);
    }
    
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    if (Math.abs(avgInterval - 30) > 5) {
      issues.push(`Average reading interval is ${avgInterval.toFixed(1)} minutes (expected ~30)`);
    }
  }
  
  return {
    isValid: issues.length === 0,
    issues
  };
}