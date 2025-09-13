import { useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Upload, FileText, AlertCircle, CheckCircle } from 'lucide-react';
import { parseEsbCsv, validateEsbReadings, EsbReading } from '@/services/esbCsv';
import { formatCurrency } from '@/utils/dateUtils';

interface EsbCsvUploadProps {
  onReadingsLoaded: (readings: EsbReading[]) => void;
  isLoading?: boolean;
}

export function EsbCsvUpload({ onReadingsLoaded, isLoading = false, compact = false }: EsbCsvUploadProps & { compact?: boolean }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadResult, setUploadResult] = useState<{
    success: boolean;
    readings: EsbReading[];
    errors: string[];
    stats?: {
      totalReadings: number;
      dateRange: { start: string; end: string } | null;
      totalKwh: number;
    };
  } | null>(null);

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setUploadResult({
        success: false,
        readings: [],
        errors: ['Please upload a CSV file']
      });
      return;
    }

    setIsProcessing(true);
    
    try {
      const result = await parseEsbCsv(file);
      const validation = validateEsbReadings(result.readings);
      
      const allErrors = [...result.errors, ...validation.issues];
      const success = result.readings.length > 0 && validation.isValid;
      
      const stats = result.readings.length > 0 ? {
        totalReadings: result.readings.length,
        dateRange: result.dateRange,
        totalKwh: result.readings.reduce((sum, r) => sum + r.kwh, 0)
      } : undefined;

      setUploadResult({
        success,
        readings: result.readings,
        errors: allErrors,
        stats
      });

      if (success) {
        onReadingsLoaded(result.readings);
      }
    } catch (error) {
      setUploadResult({
        success: false,
        readings: [],
        errors: [`Failed to process file: ${error instanceof Error ? error.message : 'Unknown error'}`]
      });
    } finally {
      setIsProcessing(false);
    }
  }, [onReadingsLoaded]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFile(files[0]);
    }
  }, [handleFile]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      handleFile(files[0]);
    }
  }, [handleFile]);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-accent" />
          Upload ESB Smart Meter Data
        </CardTitle>
        <CardDescription>
          Upload your ESB CSV export to analyze electricity usage patterns and predict future bills.
          Download your data from ESB Networks online account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isProcessing && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              Processing your electricity data...
            </div>
            <Progress value={undefined} className="w-full" />
          </div>
        )}

        {!uploadResult && !isProcessing && (
          <div
            className={`
              border-2 border-dashed rounded-lg p-8 text-center space-y-4 transition-colors
              ${isDragOver ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/50'}
              ${isLoading ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}
            `}
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onClick={() => document.getElementById('csv-file-input')?.click()}
          >
            <Upload className="w-12 h-12 mx-auto text-muted-foreground" />
            <div>
              <p className="text-lg font-medium">Drop your ESB CSV file here</p>
              <p className="text-sm text-muted-foreground">or click to browse</p>
            </div>
            <Button variant="outline" disabled={isLoading}>
              Select File
            </Button>
            <input
              id="csv-file-input"
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileInput}
              disabled={isLoading}
            />
          </div>
        )}

        {uploadResult && !compact && (
          <div className="space-y-4">
            <Alert className={uploadResult.success ? 'border-success' : 'border-destructive'}>
              <div className="flex items-center gap-2">
                {uploadResult.success ? (
                  <CheckCircle className="w-4 h-4 text-success" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-destructive" />
                )}
                <AlertDescription>
                  {uploadResult.success ? (
                    <div className="space-y-2">
                      <p>Successfully processed your electricity data!</p>
                      {uploadResult.stats && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          <Badge variant="secondary">
                            {uploadResult.stats.totalReadings.toLocaleString()} readings
                          </Badge>
                          <Badge variant="secondary">
                            {uploadResult.stats.totalKwh.toFixed(1)} kWh total
                          </Badge>
                          {uploadResult.stats.dateRange && (
                            <Badge variant="secondary">
                              {uploadResult.stats.dateRange.start} to {uploadResult.stats.dateRange.end}
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    'Failed to process electricity data'
                  )}
                </AlertDescription>
              </div>
            </Alert>

            {uploadResult.errors.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-destructive">Issues found:</p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  {uploadResult.errors.map((error, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-destructive">•</span>
                      {error}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Button 
              variant="outline" 
              onClick={() => {
                setUploadResult(null);
                const input = document.getElementById('csv-file-input') as HTMLInputElement;
                if (input) input.value = '';
              }}
            >
              Upload Different File
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
