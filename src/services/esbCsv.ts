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
  const lines = text.trim().split('\n');
  const readings: EsbReading[] = [];
  const errors: string[] = [];
  
  // Skip header if present
  const dataLines = lines[0].toLowerCase().includes('date') || lines[0].toLowerCase().includes('time') 
    ? lines.slice(1) 
    : lines;
  
  for (let i = 0; i < dataLines.length; i++) {
    const line = dataLines[i].trim();
    if (!line) continue;
    
    try {
      const reading = parseEsbCsvLine(line, i + 1);
      if (reading) {
        readings.push(reading);
      }
    } catch (error) {
      errors.push(`Line ${i + 1}: ${error instanceof Error ? error.message : 'Parse error'}`);
    }
  }
  
  // Sort by timestamp
  readings.sort((a, b) => new Date(a.tsISO).getTime() - new Date(b.tsISO).getTime());
  
  const dateRange = readings.length > 0 ? {
    start: readings[0].tsISO,
    end: readings[readings.length - 1].tsISO
  } : null;
  
  return {
    readings,
    errors,
    totalReadings: readings.length,
    dateRange
  };
}

function parseEsbCsvLine(line: string, lineNumber: number): EsbReading | null {
  // Expected formats:
  // "2024-01-15 00:30:00,1.25"
  // "15/01/2024 00:30,1.25" 
  // "2024-01-15T00:30:00,1.25"
  
  const parts = line.split(',');
  if (parts.length < 2) {
    throw new Error('Invalid CSV format - expected date,kwh');
  }
  
  const dateTimeStr = parts[0].trim().replace(/"/g, '');
  const kwhStr = parts[1].trim().replace(/"/g, '');
  
  // Parse kWh value
  const kwh = parseFloat(kwhStr);
  if (isNaN(kwh) || kwh < 0) {
    throw new Error(`Invalid kWh value: ${kwhStr}`);
  }
  
  // Parse datetime - try multiple formats
  let date: Date;
  
  try {
    if (dateTimeStr.includes('T')) {
      // ISO format
      date = new Date(dateTimeStr);
    } else if (dateTimeStr.includes('/')) {
      // DD/MM/YYYY HH:mm format
      date = parse(dateTimeStr, 'dd/MM/yyyy HH:mm', new Date());
    } else {
      // YYYY-MM-DD HH:mm:ss format
      date = parse(dateTimeStr, 'yyyy-MM-dd HH:mm:ss', new Date());
    }
    
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid date format: ${dateTimeStr}`);
    }
  } catch (error) {
    throw new Error(`Could not parse date: ${dateTimeStr}`);
  }
  
  // Convert to Dublin timezone ISO string (handles DST)
  const dublinTime = toZonedTime(date, DUBLIN_TZ);
  const tsISO = fromZonedTime(dublinTime, DUBLIN_TZ).toISOString();
  
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