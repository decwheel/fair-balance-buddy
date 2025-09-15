import { parseBillWithAI } from './billAi';

// Utility: timebox async work to avoid indefinite spinners if a step stalls
async function withTimeout<T>(p: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  let t: any;
  const timeout = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error(`${label}_timeout`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(t);
  }
}

export interface DiscountRules {
  unitRatePercent?: number;         // e.g., 0.10 for 10% off unit rates
  standingChargePercent?: number;   // e.g., 0.10 for 10% off standing charge
  welcomeCredit?: number;           // € applied once (if applicable)
  untilDate?: string;               // ISO yyyy-mm-dd when discounts end
}

export interface TariffRates {
  supplier: string;
  plan: string;
  meterType: '24HR' | 'DAY_NIGHT' | 'SMART_TOU';
  standingChargeDaily: number; // € per day
  vatRate: number; // e.g., 0.135 for 13.5%
  rates: {
    [bandName: string]: number; // € per kWh
  };
  billingPeriodDays?: number;
  nextDueDate?: string;        // ISO yyyy-mm-dd if detected from bill
  lastBillPeriodEnd?: string;  // ISO yyyy-mm-dd, end of the last billed period
  confidence: number; // 0-1 confidence in extraction
  discounts?: DiscountRules;    // optional bill discounts inferred from last bill
  fitRate?: number;             // optional Feed-in Tariff €/kWh
}

export interface BillPdfParseResult {
  tariff: TariffRates | null;
  billTotal?: number;
  billingPeriod?: {
    start: string;
    end: string;
    days: number;
  };
  meterReadings?: {
    start: number;
    end: number;
    usage: number;
  };
  errors: string[];
}

// Mock PDF text extraction for MVP
export async function extractBillPdfText(file: File): Promise<string> {
  const run = async (): Promise<string> => {
    try {
      const lower = file.name.toLowerCase();
      const isPdf = file.type.includes('pdf') || lower.endsWith('.pdf');

      if (!isPdf) {
        // Not a PDF: try to read as text (may be empty for images)
        try {
          return await file.text();
        } catch {
          return '';
        }
      }

      // Read PDF bytes
      const data = await file.arrayBuffer();

      // Lazy-load pdf.js to keep bundle light
      const pdfjs: any = await import('pdfjs-dist');

      // Try to spin up a dedicated worker (Vite supports ?worker import)
      try {
        const PdfWorker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?worker')).default;
        if (pdfjs?.GlobalWorkerOptions) {
          pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
        }
      } catch (_) {
        // Fallback: rely on default worker
      }

      const loadingTask = pdfjs.getDocument({ data });
      const pdf = await loadingTask.promise;

      let fullText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const text = content.items
          .map((it: any) => (typeof it?.str === 'string' ? it.str : typeof it === 'string' ? it : ''))
          .join(' ');
        fullText += `\n${text}`;
      }

      return fullText.trim();
    } catch (e) {
      // Final fallback: return empty string to let AI fallback handle it
      return '';
    }
  };

  // Timebox PDF extraction to avoid UI hanging indefinitely (e.g., worker issues)
  return await withTimeout(run(), 20_000, 'pdf_text_extract');
}

export async function parseBillPdf(file: File): Promise<BillPdfParseResult> {
  try {
    const lower = file.name.toLowerCase();
    const isPdf = file.type.includes('pdf') || lower.endsWith('.pdf');
    const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|heic|webp)$/i.test(lower);

    // Helper to convert image to data URL
    const toDataUrl = (f: File) => new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(f);
    });

    // 1) If image: try AI vision first
    if (isImage) {
      try {
        const dataUrl = await toDataUrl(file);
        const aiVision = await parseBillWithAI({ imageBase64: dataUrl, filename: file.name });
        if (aiVision && aiVision.tariff) return aiVision;
      } catch (_) {
        // continue to text path
      }
    }

    // 2) Extract real PDF text then try AI text parsing
    const text = await extractBillPdfText(file);
    try {
      const aiText = await parseBillWithAI({ text, filename: file.name });
      if (aiText && aiText.tariff) return aiText;
    } catch (_) {
      // fall back to local regex parser
    }

    // 3) Fallback: local regex parser
    return parseBillText(text);
  } catch (error) {
    return {
      tariff: null,
      errors: [`Failed to parse PDF: ${error instanceof Error ? error.message : 'Unknown error'}`]
    };
  }
}

export function parseBillText(text: string): BillPdfParseResult {
  const errors: string[] = [];
  let confidence = 0;
  const confidencePoints = {
    supplier: 10,
    meterType: 15,
    standingCharge: 20,
    rates: 30,
    vat: 10,
    billingPeriod: 15
  };

  // Extract supplier
  let supplier = 'Unknown';
  if (text.toLowerCase().includes('esb')) {
    supplier = 'ESB';
    confidence += confidencePoints.supplier;
  } else if (text.toLowerCase().includes('electric ireland')) {
    supplier = 'Electric Ireland';
    confidence += confidencePoints.supplier;
  } else if (text.toLowerCase().includes('bord gais')) {
    supplier = 'Bord Gais';
    confidence += confidencePoints.supplier;
  }

  // Extract meter type
  let meterType: '24HR' | 'DAY_NIGHT' | 'SMART_TOU' = '24HR';
  if (text.toLowerCase().includes('smart') || text.toLowerCase().includes('tou')) {
    meterType = 'SMART_TOU';
    confidence += confidencePoints.meterType;
  } else if (text.toLowerCase().includes('day') && text.toLowerCase().includes('night')) {
    meterType = 'DAY_NIGHT';
    confidence += confidencePoints.meterType;
  } else if (text.toLowerCase().includes('24') || text.toLowerCase().includes('standard')) {
    meterType = '24HR';
    confidence += confidencePoints.meterType;
  }

  // Extract standing charge
  let standingChargeDaily = 0.285; // Default Irish rate
  const standingChargeMatch = text.match(/standing.*?charge.*?[€]?(\d+\.?\d*)/i);
  if (standingChargeMatch) {
    standingChargeDaily = parseFloat(standingChargeMatch[1]);
    confidence += confidencePoints.standingCharge;
  }

  // Extract VAT rate
  let vatRate = 0.135; // Default Irish VAT
  const vatMatch = text.match(/vat.*?(\d+\.?\d*)%/i);
  if (vatMatch) {
    vatRate = parseFloat(vatMatch[1]) / 100;
    confidence += confidencePoints.vat;
  }

// Extract billing period (robust)
let billingPeriod: { start: string; end: string; days: number } | undefined;
const periodMatch = text.match(/(\d{1,2}\/\d{1,2}\/\d{4}).*?(\d{1,2}\/\d{1,2}\/\d{4}).*?\((\d+)\s*days?\)/i);

// Helper date parser supporting multiple formats
const parseDate = (s: string): Date | null => {
  const t = s.trim();
  const m = t.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (m) {
    const d = parseInt(m[1], 10), mo = parseInt(m[2], 10), y = parseInt(m[3], 10);
    const Y = y < 100 ? 2000 + y : y;
    return new Date(Y, mo - 1, d);
  }
  const d2 = new Date(t);
  return isNaN(d2.getTime()) ? null : d2;
};
const toIso = (d: Date) => d.toISOString().split('T')[0];

if (periodMatch) {
// normalise to ISO
const ps = parseDate(periodMatch[1]);
const pe = parseDate(periodMatch[2]);
billingPeriod = ps && pe ? {
  start: toIso(ps),
  end: toIso(pe),
  days: parseInt(periodMatch[3], 10)
} : undefined;
  confidence += confidencePoints.billingPeriod;
} else {
  // Look for two dates without explicit "(xx days)"
  const pairPatterns = [
    /(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})\s*(?:to|-)\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i,
    /(\d{1,2}\s*[A-Za-z]{3,9}\s*\d{4})\s*(?:to|-)\s*(\d{1,2}\s*[A-Za-z]{3,9}\s*\d{4})/i,
  ];
  for (const rx of pairPatterns) {
    const m = text.match(rx);
    if (m) {
      const s = parseDate(m[1]);
      const e = parseDate(m[2]);
      if (s && e) {
        const days = Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1);
        billingPeriod = { start: toIso(s), end: toIso(e), days };
        confidence += confidencePoints.billingPeriod;
        break;
      }
    }
  }
}

  // Extract rates based on meter type
  const rates: { [bandName: string]: number } = {};
  
  if (meterType === 'SMART_TOU') {
    // Look for peak/day/night rates
    const peakMatch = text.match(/peak.*?[€]?(\d+\.?\d*)\s*per\s*kwh/i);
    const dayMatch = text.match(/day.*?[€]?(\d+\.?\d*)\s*per\s*kwh/i);
    const nightMatch = text.match(/night.*?[€]?(\d+\.?\d*)\s*per\s*kwh/i);
    
    if (peakMatch) rates.peak = parseFloat(peakMatch[1]);
    if (dayMatch) rates.day = parseFloat(dayMatch[1]);
    if (nightMatch) rates.night = parseFloat(nightMatch[1]);
    
    if (Object.keys(rates).length > 0) {
      confidence += confidencePoints.rates;
    }
  } else if (meterType === 'DAY_NIGHT') {
    const dayMatch = text.match(/day.*?[€]?(\d+\.?\d*)\s*per\s*kwh/i);
    const nightMatch = text.match(/night.*?[€]?(\d+\.?\d*)\s*per\s*kwh/i);
    
    if (dayMatch) rates.day = parseFloat(dayMatch[1]);
    if (nightMatch) rates.night = parseFloat(nightMatch[1]);
    
    if (Object.keys(rates).length > 0) {
      confidence += confidencePoints.rates;
    }
  } else {
    // 24HR - single rate
    const rateMatch = text.match(/[€]?(\d+\.?\d*)\s*per\s*kwh/i);
    if (rateMatch) {
      rates.standard = parseFloat(rateMatch[1]);
      confidence += confidencePoints.rates;
    }
  }

  // Extract bill total
  let billTotal;
  const totalMatch = text.match(/total.*?amount.*?[€]?(\d+\.?\d*)/i);
  if (totalMatch) {
    billTotal = parseFloat(totalMatch[1]);
  }

// Extract due date (if present)
let nextDueDateIso: string | undefined;
const duePatterns = [
  /due\s*date[: ]*\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i,
  /(payment\s*due|due\s*by)[: ]*\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i,
  /(due\s*date|payment\s*due|direct\s*debit\s*on)[: ]*\s*(\d{1,2}\s*[A-Za-z]{3,9}\s*\d{4})/i,
];
let dueText: string | undefined;
for (const rx of duePatterns) {
  const m = text.match(rx);
  if (m) { dueText = (m[1] || m[2]) as string; break; }
}
if (dueText) {
  const d = parseDate(dueText);
  if (d) nextDueDateIso = d.toISOString().split('T')[0];
}

  const finalConfidence = confidence / 100;

  if (finalConfidence < 0.6) {
    errors.push('Low confidence in bill parsing - please review extracted values');
  }

  if (Object.keys(rates).length === 0) {
    errors.push('Could not extract electricity rates from bill');
  }

  const tariff: TariffRates = {
    supplier,
    plan: 'Extracted from Bill',
    meterType,
    standingChargeDaily,
    vatRate,
    rates,
    billingPeriodDays: billingPeriod?.days,
    lastBillPeriodEnd: billingPeriod?.end,
    nextDueDate: nextDueDateIso,
    confidence: finalConfidence
  };

  return {
    tariff: Object.keys(rates).length > 0 ? tariff : null,
    billTotal,
    billingPeriod,
    errors
  };
}
