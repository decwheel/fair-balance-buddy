import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EsbCsvUpload } from '@/components/energy/EsbCsvUpload';
import { LastBillUpload } from '@/components/energy/LastBillUpload';
import { useAnnounce } from '@/components/accessibility/LiveAnnouncer';
import { track } from '@/lib/analytics';
import type { EsbReading } from '@/services/esbCsv';
import type { TariffRates } from '@/services/billPdf';
import { toast } from 'sonner';

export function ElectricityUpload({ onDone }: { onDone: (data: { readings: EsbReading[]; tariff?: TariffRates }) => void }) {
  const [readings, setReadings] = React.useState<EsbReading[]>([]);
  const [tariff, setTariff] = React.useState<TariffRates | undefined>(undefined);
  const { announce } = useAnnounce();

  // Keep parent state in sync whenever either input changes
  React.useEffect(() => {
    onDone({ readings, tariff });
  }, [readings, tariff]);

  // UX feedback hooks
  React.useEffect(() => {
    if (readings.length) {
      track('electricity_uploaded', { readings: readings.length });
      announce(`Electricity data uploaded: ${readings.length} readings`);
      toast.success(`Electricity CSV uploaded (${readings.length} readings)`);
    }
  }, [readings]);

  React.useEffect(() => {
    if (tariff) {
      toast.success(`Tariff parsed: ${tariff.supplier} • ${tariff.plan}`);
    }
  }, [tariff]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Predict from</CardTitle>
        <CardDescription>Smart-meter CSV + last bill / 6 bills / Some bills</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <EsbCsvUpload onReadingsLoaded={setReadings} />
        <LastBillUpload onTariffExtracted={(t)=> setTariff(t)} />
        {(readings.length > 0) && (
          <div className="col-span-1 md:col-span-2 flex flex-wrap gap-2">
            <Badge variant="secondary">{readings.length.toLocaleString()} readings</Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
