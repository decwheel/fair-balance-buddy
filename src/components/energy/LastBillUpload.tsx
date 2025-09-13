import { useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Upload, FileText, AlertCircle, CheckCircle } from 'lucide-react';
import { parseBillPdf, TariffRates } from '@/services/billPdf';
import { parseBillWithAI, checkAiStatus as getAiStatus } from '@/services/billAi';
import { formatCurrency } from '@/utils/dateUtils';

interface LastBillUploadProps {
  onTariffExtracted: (tariff: TariffRates) => void;
  isLoading?: boolean;
}

export function LastBillUpload({ onTariffExtracted, isLoading = false }: LastBillUploadProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadResult, setUploadResult] = useState<{
    success: boolean;
    tariff: TariffRates | null;
    errors: string[];
  } | null>(null);
  const [aiStatus, setAiStatus] = useState<{ state: 'idle' | 'checking' | 'ok' | 'error'; message?: string }>({ state: 'idle' });

  const checkAiStatus = useCallback(async () => {
    try {
      setAiStatus({ state: 'checking' });
      const result: any = await getAiStatus();
      const hasKey = !!(result && result.hasOpenAIKey);
      setAiStatus({ state: 'ok', message: hasKey ? 'Edge Function ✓ • OpenAI key detected' : 'Edge Function ✓ • Missing OPENAI_API_KEY' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setAiStatus({ state: 'error', message });
    }
  }, []);
  const handleFile = useCallback(async (file: File) => {
    const lower = file.name.toLowerCase();
    const isPdf = file.type.includes('pdf') || lower.endsWith('.pdf');
    const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|heic|webp)$/i.test(lower);
    if (!isPdf && !isImage) {
      setUploadResult({
        success: false,
        tariff: null,
        errors: ['Please upload a PDF or image (jpg, jpeg, png, heic, webp)']
      });
      return;
    }

    setIsProcessing(true);
    
    try {
      const result = await parseBillPdf(file);
      
      const success = result.tariff !== null && result.tariff.confidence > 0.5;
      
      setUploadResult({
        success,
        tariff: result.tariff,
        errors: result.errors
      });

      if (success && result.tariff) {
        onTariffExtracted(result.tariff);
      }
    } catch (error) {
      setUploadResult({
        success: false,
        tariff: null,
        errors: [`Failed to process file: ${error instanceof Error ? error.message : 'Unknown error'}`]
      });
    } finally {
      setIsProcessing(false);
    }
  }, [onTariffExtracted]);

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
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-warning" />
            Upload Your Last Electricity Bill
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={checkAiStatus} disabled={aiStatus.state === 'checking'}>
              {aiStatus.state === 'checking' ? 'Checking…' : 'Check AI status'}
            </Button>
            {aiStatus.state !== 'idle' && (
              <span className={`text-xs ${aiStatus.state === 'ok' ? 'text-green-600' : aiStatus.state === 'error' ? 'text-red-600' : 'text-muted-foreground'}`}>
                {aiStatus.message || (aiStatus.state === 'ok' ? 'OK' : '')}
              </span>
            )}
          </div>
        </CardTitle>
        <CardDescription>
          Upload your most recent electricity bill PDF or clear photo to extract tariff rates and billing information.
          This helps us predict future bills more accurately.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isProcessing && (
          <div className="space-y-2" aria-live="polite">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              Extracting tariff information...
            </div>
          </div>
        )}

        {!uploadResult && !isProcessing && (
          <div
            className={`
              border-2 border-dashed rounded-lg p-8 text-center space-y-4 transition-colors
              ${isDragOver ? 'border-warning bg-warning/5' : 'border-border hover:border-warning/50'}
              ${isLoading ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}
            `}
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onClick={() => document.getElementById('bill-file-input')?.click()}
          >
            <Upload className="w-12 h-12 mx-auto text-muted-foreground" />
            <div>
              <p className="text-lg font-medium">Drop your electricity bill PDF here</p>
              <p className="text-sm text-muted-foreground">or click to browse</p>
            </div>
            <Button variant="outline" disabled={isLoading}>
              Select PDF File
            </Button>
            <input
              id="bill-file-input"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.heic,.webp"
              className="hidden"
              onChange={handleFileInput}
              disabled={isLoading}
            />
          </div>
        )}

        {uploadResult && (
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
                      <p>Successfully extracted tariff information!</p>
                      {uploadResult.tariff && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          <Badge variant="secondary">
                            {uploadResult.tariff.supplier}
                          </Badge>
                          <Badge variant="secondary">
                            {uploadResult.tariff.meterType}
                          </Badge>
                          <Badge variant="secondary">
                            Standing: {formatCurrency(uploadResult.tariff.standingChargeDaily)}/day
                          </Badge>
                          <Badge variant="secondary">
                            {Math.round(uploadResult.tariff.confidence * 100)}% confidence
                          </Badge>
                        </div>
                      )}
                    </div>
                  ) : (
                    'Failed to extract tariff information'
                  )}
                </AlertDescription>
              </div>
            </Alert>

            {uploadResult.tariff && (
              <div className="space-y-3">
                <h4 className="font-medium">Extracted Rates:</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {Object.entries(uploadResult.tariff.rates).map(([band, rate]) => (
                    <div key={band} className="flex justify-between items-center p-2 bg-secondary/50 rounded">
                      <span className="capitalize font-medium">{band}:</span>
                      <span>{formatCurrency(rate)}/kWh</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
                const input = document.getElementById('bill-file-input') as HTMLInputElement;
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
